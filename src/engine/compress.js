// compress.js — gzip compression for stored source files.
// Ported from v1 (reference-v1/src/engine/compress.js). Uses the native
// CompressionStream API; falls back to storing uncompressed if missing.

// base64 in → gzipped base64 out. Storage-only — NEVER send the compressed
// output to an API expecting the original format.
export async function compressToBase64(base64String) {
  if (typeof CompressionStream === 'undefined') {
    console.warn('CompressionStream not supported — storing uncompressed');
    return base64String;
  }
  try {
    const bytes = base64ToBytes(base64String);
    const compressed = await pipeThrough(bytes, new CompressionStream('gzip'));
    return bytesToBase64(compressed);
  } catch (err) {
    console.warn('Compression failed, storing uncompressed:', err?.message || err);
    return base64String;
  }
}

// Reverse of compressToBase64 — byte-identical to the original input.
// If decompression fails (payload was stored uncompressed via the fallback),
// returns the input unchanged.
export async function decompressFromBase64(compressedBase64) {
  if (typeof DecompressionStream === 'undefined') return compressedBase64;
  try {
    const bytes = base64ToBytes(compressedBase64);
    const decompressed = await pipeThrough(bytes, new DecompressionStream('gzip'));
    return bytesToBase64(decompressed);
  } catch (err) {
    console.warn('Decompression failed, treating input as uncompressed:', err?.message || err);
    return compressedBase64;
  }
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── internals ───────────────────────────────────────────────────────────────

export function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Chunked byte→base64 to avoid O(n²) string concat and apply() stack limits
// on multi-megabyte payloads.
export function bytesToBase64(bytes) {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(binary);
}

// Push bytes through a Compression/DecompressionStream and collect output.
// The write promise is kicked off but NOT awaited before reading, so the
// pipeline drains concurrently — otherwise large payloads can deadlock on
// backpressure.
async function pipeThrough(bytes, stream) {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  // Capture write errors instead of letting the promise reject unhandled —
  // when input is invalid the read loop throws first, and this rejection
  // would otherwise be orphaned.
  let writeError = null;
  const writePromise = writer
    .write(bytes)
    .then(() => writer.close())
    .catch((err) => { writeError = err; });

  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await writePromise;
  if (writeError) throw writeError;

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
