// sources.js — stores the original source material of a deck so it can be
// REGENERATED later from any device.
//
// File bytes: gzip-compressed, uploaded to the private 'source-files'
// Storage bucket at user_id/deck_id/file_id. Metadata (name, kind, sizes,
// path) lives in the source_files table and syncs like any other rows.
// URLs are metadata-only rows (kind 'url').

import { compressToBase64, decompressFromBase64, base64ToBytes, bytesToBase64 } from '../engine/compress.js';
import { compressImage } from '../ai/extract-files.js';

const BUCKET = 'source-files';

export function createSourcesService({ client, userId, repos }) {
  return {
    // Persist one deck's sources. `prepared` comes from the builder:
    //   { name, kind: 'image'|'pdf'|'docx'|'pptx', mediaType, data(base64), sizeBytes }
    //   or { kind: 'url', url }
    // Best-effort: a failed upload keeps the metadata row with no path so
    // the UI can show what's missing; generation itself already succeeded.
    async saveForDeck(deckId, prepared, onStatus) {
      let failures = 0;
      for (const [i, src] of prepared.entries()) {
        if (src.kind === 'url') {
          await repos.sourceFiles.create({
            deckId, name: src.url, kind: 'url', sourceUrl: src.url,
          });
          continue;
        }
        onStatus?.(`Storing source ${i + 1} of ${prepared.length}…`);
        const compressed = await compressToBase64(src.data);
        const row = await repos.sourceFiles.create({
          deckId,
          name: src.name,
          kind: src.kind,
          mediaType: src.mediaType,
          sizeBytes: src.sizeBytes,
          originalSize: src.data.length,
        });
        const path = `${userId}/${deckId}/${row.id}`;
        const { error } = await client.storage
          .from(BUCKET)
          .upload(path, new Blob([base64ToBytes(compressed)], { type: 'application/gzip' }), {
            upsert: true,
            contentType: 'application/gzip',
          });
        if (error) {
          console.warn('source upload failed:', error.message);
          failures++;
        } else {
          await repos.sourceFiles.update(row.id, { storagePath: path });
        }
      }
      return { failures };
    },

    // Download + decompress one stored file back to its original base64.
    async loadData(sourceRow) {
      if (!sourceRow.storagePath) return null;
      const { data, error } = await client.storage.from(BUCKET).download(sourceRow.storagePath);
      if (error || !data) {
        console.warn('source download failed:', error?.message);
        return null;
      }
      const compressed = bytesToBase64(new Uint8Array(await data.arrayBuffer()));
      return decompressFromBase64(compressed);
    },

    // ── Per-question source images ──────────────────────────────────────
    // One image per question, stored uncompressed-for-display as JPEG at
    // user_id/qimg/question_id. Path saved on the question row.
    async uploadQuestionImage(questionId, dataUrl) {
      const { data } = await compressImage(dataUrl); // keeps it under the size limit
      const path = `${userId}/qimg/${questionId}`;
      const blob = new Blob([base64ToBytes(data)], { type: 'image/jpeg' });
      const { error } = await client.storage.from(BUCKET).upload(path, blob, {
        upsert: true, contentType: 'image/jpeg',
      });
      if (error) { console.warn('question image upload failed:', error.message); return null; }
      return path;
    },

    // A short-lived signed URL to display a private image.
    async signedUrl(path) {
      if (!path) return null;
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error) { console.warn('signed url failed:', error.message); return null; }
      return data?.signedUrl || null;
    },

    removeObject(path) {
      if (!path) return Promise.resolve();
      return client.storage.from(BUCKET).remove([path]).catch(() => {});
    },

    // Reference-aware cleanup when a deck is deleted. Tombstones the deck's
    // source_files metadata and removes a stored regeneration object ONLY
    // when no OTHER live deck still references that same storagePath (decks
    // made via "Save as new" share paths). Per-question images are unique to
    // a question, so they're always safe to remove.
    // Call this BEFORE repos.decks.remove(deckId), while the deck is live.
    async deleteForDeck(deckId) {
      try {
        // Paths still referenced by other decks' live source_files.
        const referencedElsewhere = new Set();
        for (const d of await repos.decks.list()) {
          if (d.id === deckId) continue;
          for (const sf of await repos.sourceFiles.listByDeck(d.id)) {
            if (sf.storagePath) referencedElsewhere.add(sf.storagePath);
          }
        }

        const toRemove = new Set();

        // Regeneration source files for this deck.
        for (const sf of await repos.sourceFiles.listByDeck(deckId)) {
          await repos.sourceFiles.remove(sf.id); // tombstone metadata
          if (sf.storagePath && !referencedElsewhere.has(sf.storagePath)) {
            toRemove.add(sf.storagePath);
          }
        }

        // Per-question source images (unique to each question → always safe).
        for (const q of await repos.questions.listByDeck(deckId)) {
          if (q.sourceImagePath) toRemove.add(q.sourceImagePath);
        }

        if (toRemove.size) await client.storage.from(BUCKET).remove([...toRemove]);
      } catch (err) {
        console.warn('source cleanup failed:', err?.message);
      }
    },
  };
}
