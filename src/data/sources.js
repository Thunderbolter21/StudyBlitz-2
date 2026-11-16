// sources.js — stores the original source material of a deck so it can be
// REGENERATED later from any device.
//
// File bytes: gzip-compressed, uploaded to the private 'source-files'
// Storage bucket at user_id/deck_id/file_id. Metadata (name, kind, sizes,
// path) lives in the source_files table and syncs like any other rows.
// URLs are metadata-only rows (kind 'url').

import { compressToBase64, decompressFromBase64, base64ToBytes, bytesToBase64 } from '../engine/compress.js';

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

    // Best-effort removal of a deck's stored objects (called on deck delete).
    // Orphans are wasted space, not data loss — never block the UX on this.
    async deleteForDeck(deckId) {
      try {
        const rows = await repos.sourceFiles.listByDeck(deckId);
        const paths = rows.map((r) => r.storagePath).filter(Boolean);
        if (paths.length) await client.storage.from(BUCKET).remove(paths);
      } catch (err) {
        console.warn('source cleanup failed:', err?.message);
      }
    },
  };
}
