// PDF → text (for the smart parser) and page images (for cropping figures/questions).
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api';

let lib: typeof import('pdfjs-dist') | null = null;

async function pdfjs() {
  if (lib) return lib;
  const mod = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  mod.GlobalWorkerOptions.workerSrc = worker.default;
  lib = mod;
  return mod;
}

export async function openPdf(file: File): Promise<PDFDocumentProxy> {
  const p = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  return p.getDocument({ data }).promise;
}

/** Rebuild reading-order lines from positioned text items. Handles 2-column pages. */
export async function pdfText(doc: PDFDocumentProxy, onProgress?: (p: number) => void): Promise<{ text: string; textChars: number }> {
  const pages: string[] = [];
  let chars = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = (content.items as TextItem[]).filter((it) => 'str' in it && it.str.trim() !== '');
    chars += items.reduce((s, it) => s + it.str.length, 0);

    // detect two-column layouts: many items start right of center and few cross it
    const mid = vp.width / 2;
    const crossing = items.filter((it) => it.transform[4] < mid - 20 && it.transform[4] + it.width > mid + 20).length;
    const right = items.filter((it) => it.transform[4] > mid).length;
    const twoCol = items.length > 20 && right > items.length * 0.3 && crossing < items.length * 0.05;
    const columns = twoCol ? [items.filter((it) => it.transform[4] < mid), items.filter((it) => it.transform[4] >= mid)] : [items];

    const colTexts = columns.map((col) => {
      const rows: { y: number; h: number; parts: { x: number; w: number; s: string }[] }[] = [];
      for (const it of col) {
        const y = it.transform[5];
        const h = Math.abs(it.transform[3]) || it.height || 10;
        let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2.5, h * 0.35));
        if (!row) {
          row = { y, h, parts: [] };
          rows.push(row);
        }
        row.parts.push({ x: it.transform[4], w: it.width, s: it.str });
      }
      rows.sort((a, b) => b.y - a.y);
      const lines: string[] = [];
      let prev: (typeof rows)[number] | null = null;
      for (const r of rows) {
        r.parts.sort((a, b) => a.x - b.x);
        let line = '';
        let lastEnd = -1;
        for (const p of r.parts) {
          if (lastEnd >= 0 && p.x - lastEnd > 1.5 && !line.endsWith(' ') && !p.s.startsWith(' ')) line += ' ';
          line += p.s;
          lastEnd = p.x + p.w;
        }
        if (prev && prev.y - r.y > Math.max(prev.h, r.h) * 1.75) lines.push('');
        lines.push(line.replace(/\s+/g, ' ').trim());
        prev = r;
      }
      return lines.join('\n');
    });
    pages.push(colTexts.join('\n\n'));
    onProgress?.(i / doc.numPages);
  }
  return { text: pages.join('\n\n'), textChars: chars };
}

export async function renderPage(doc: PDFDocumentProxy, n: number, scale = 2): Promise<string> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas.toDataURL('image/jpeg', 0.92);
}

/** Crop a region (fractions 0..1 of the page) from a rendered page image. */
export async function cropImage(src: string, r: { x: number; y: number; w: number; h: number }): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  const sx = r.x * img.naturalWidth;
  const sy = r.y * img.naturalHeight;
  const sw = r.w * img.naturalWidth;
  const sh = r.h * img.naturalHeight;
  const scale = Math.min(1, 1400 / sw);
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
