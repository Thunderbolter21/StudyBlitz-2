// extract-files.js — turns dropped files into API-ready content.
//
// images → compressed JPEG base64 (under Anthropic's 5 MB limit)
// PDFs   → base64 document blocks
// DOCX   → extracted text (mammoth, lazy-loaded only when needed)
// PPTX   → extracted slide text (jszip + XML parse, lazy-loaded)
//
// The heavy parsers are dynamic imports so they never touch the initial
// JS bundle (performance budget).

export const ACCEPTED_EXTENSIONS = '.png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.pptx';
export const MAX_FILES = 25;
export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB (v1 limit)

export function classifyFile(file) {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/')) return 'image';
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.pptx')) return 'pptx';
  return null; // unsupported
}

export function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// ── Image compression (ported from v1's compressImage) ──────────────────────
// Guarantees output under Anthropic's 5 MB per-image limit: step quality
// down 0.85→0.35, then shrink dimensions. Yields to the browser between
// attempts so the UI can repaint progress.
export async function compressImage(dataUrl, onProgress) {
  const API_MAX = 4.75 * 1024 * 1024;
  const MAX_DIM = 2048;

  const img = await new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = dataUrl;
  });
  if (!img) return { data: dataUrl.split(',')[1], mediaType: 'image/jpeg' };

  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w > MAX_DIM || h > MAX_DIM) {
    const scale = MAX_DIM / Math.max(w, h);
    w = Math.max(1, Math.floor(w * scale));
    h = Math.max(1, Math.floor(h * scale));
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let quality = 0.85;

  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((r) => requestAnimationFrame(r)); // let the UI repaint
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const out = canvas.toDataURL('image/jpeg', quality);
    const b64 = out.split(',')[1];
    const bytes = Math.ceil((b64.length * 3) / 4);
    onProgress?.({ attempt, quality, w, h, bytes, done: bytes <= API_MAX });
    if (bytes <= API_MAX) return { data: b64, mediaType: 'image/jpeg' };

    if (quality > 0.35) {
      quality = Math.max(0.35, quality - 0.15);
    } else {
      const shrink = Math.sqrt(API_MAX / bytes) * 0.95;
      w = Math.max(1, Math.floor(w * shrink));
      h = Math.max(1, Math.floor(h * shrink));
      quality = 0.55;
    }
  }

  // Absolute fallback — lowest quality at current size.
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);
  const b64 = canvas.toDataURL('image/jpeg', 0.3).split(',')[1];
  return { data: b64, mediaType: 'image/jpeg' };
}

// ── DOCX text (mammoth, lazy) ───────────────────────────────────────────────
export async function extractDocxText(arrayBuffer) {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return value.trim();
}

// ── PPTX slide text (jszip + XML, lazy) ─────────────────────────────────────
// Slides are XML files at ppt/slides/slideN.xml; visible text lives in
// <a:t> elements. We join each slide's runs and label the slides.
export async function extractPptxText(arrayBuffer) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));

  const parts = [];
  for (const name of slideNames) {
    const xml = await zip.file(name).async('string');
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((m) => decodeXml(m[1]).trim())
      .filter(Boolean);
    if (texts.length) {
      parts.push(`[Slide ${parts.length + 1}]\n${texts.join('\n')}`);
    }
  }
  return parts.join('\n\n').trim();
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
