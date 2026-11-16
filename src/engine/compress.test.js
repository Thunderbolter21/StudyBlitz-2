// compress.test.js — gzip round-trip must be byte-faithful (regeneration
// sends these bytes back to the API; corruption would be silent poison).

import { describe, it, expect } from 'vitest';
import { compressToBase64, decompressFromBase64, bytesToBase64, base64ToBytes } from './compress.js';

describe('gzip source-file compression', () => {
  it('round-trips base64 byte-for-byte', async () => {
    // Pseudo-random binary payload (seeded, deterministic).
    let seed = 42;
    const bytes = new Uint8Array(50_000).map(() => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % 256;
    });
    const original = bytesToBase64(bytes);

    const compressed = await compressToBase64(original);
    const restored = await decompressFromBase64(compressed);
    expect(restored).toBe(original);
  });

  it('actually compresses compressible data', async () => {
    const original = bytesToBase64(new Uint8Array(100_000)); // all zeros
    const compressed = await compressToBase64(original);
    expect(compressed.length).toBeLessThan(original.length / 10);
  });

  it('decompress treats non-gzip input as already uncompressed', async () => {
    const plain = bytesToBase64(new TextEncoder().encode('not gzipped'));
    expect(await decompressFromBase64(plain)).toBe(plain);
  });

  it('base64 helpers round-trip large payloads without stack issues', () => {
    const bytes = new Uint8Array(1_000_000).fill(65);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});
