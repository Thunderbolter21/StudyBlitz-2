// tokens.test.js — automated WCAG AA contrast audit of the design tokens.
// Parses tokens.css and asserts every text-on-paper pairing meets 4.5:1.
// Change a color → this test tells you immediately if it broke readability.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  fileURLToPath(new URL('./tokens.css', import.meta.url)),
  'utf8'
);

// --name: #rrggbb;
const tokens = {};
for (const [, name, hex] of css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
  tokens[name] = hex;
}

// WCAG relative luminance + contrast ratio.
function luminance(hex) {
  const chan = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(1) + 0.7152 * chan(3) + 0.0722 * chan(5);
}
function ratio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const AA = 4.5;

// Every token that is ever used as TEXT, against every paper surface.
const textTokens = [
  'ink', 'ink-soft', 'graphite', 'pen-red', 'pen-green', 'pen-blue',
  'class-1', 'class-2', 'class-3', 'class-4',
  'class-5', 'class-6', 'class-7', 'class-8',
];

describe('design token contrast (WCAG AA, 4.5:1)', () => {
  for (const name of textTokens) {
    it(`--${name} is readable on --paper and --paper-shade`, () => {
      expect(tokens[name], `token --${name} missing`).toBeTruthy();
      expect(ratio(tokens[name], tokens['paper'])).toBeGreaterThanOrEqual(AA);
      expect(ratio(tokens[name], tokens['paper-shade'])).toBeGreaterThanOrEqual(AA);
    });
  }

  it('paper text on ink (primary buttons) is readable', () => {
    expect(ratio(tokens['paper'], tokens['ink'])).toBeGreaterThanOrEqual(AA);
  });

  it('body text (--ink on --paper) comfortably exceeds AAA', () => {
    expect(ratio(tokens['ink'], tokens['paper'])).toBeGreaterThanOrEqual(7);
  });
});
