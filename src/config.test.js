// Smoke test — proves the Vitest + Vite toolchain runs and config loads.
import { describe, it, expect } from 'vitest';
import { GENERATION_MODEL_DEFAULT, isSupabaseConfigured } from './config.js';

describe('config', () => {
  it('names the generation model in exactly one place', () => {
    expect(typeof GENERATION_MODEL_DEFAULT).toBe('string');
    expect(GENERATION_MODEL_DEFAULT.length).toBeGreaterThan(0);
  });

  it('reports Supabase configuration as a boolean', () => {
    expect(typeof isSupabaseConfigured()).toBe('boolean');
  });
});
