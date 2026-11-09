// "Highlighted answer" import: the teacher's file marks each correct answer (highlight, colored text or bold).
// We read the questions, take the marked choice as the key, and never show any of it before the test.
import { strFromU8, unzipSync } from 'fflate';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { openPdf } from './pdf';
import { parseText } from './parser';
import type { Question, Section, Test } from './types';
import { compressImage, LETTERS, uid } from './util';

/** One visual/logical line with a per-character "marked" score for each signal. */
export interface KLine {
  text: string;
  hl: number[];
  color: number[];
  bold: number[];
}

export interface KeyedReport {
  questions: number;
  keyed: number;
  missing: string[];
  byHighlight: number;
  byColor: number;
  byBold: number;
  byText: number;
  figures: number;
  figureWarnings: string[];
  scanned: boolean;
}

const line = (text: string, hl = 0, color = 0, bold = 0): KLine => ({
  text,
  hl: Array(text.length).fill(hl),
  color: Array(text.length).fill(color),
  bold: Array(text.length).fill(bold),
});

function appendTo(l: KLine, text: string, hl: number, color: number, bold: number) {
  l.text += text;
  for (let i = 0; i < text.length; i++) {
    l.hl.push(hl);
    l.color.push(color);
    l.bold.push(bold);
  }
}

// ═════════════════════════ Word (.docx) ═════════════════════════
function kids(el: Element | Document, name?: string): Element[] {
  return Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1 && (!name || (n as Element).localName === name));
}
function kid(el: Element, name: string): Element | undefined {
  return kids(el, name)[0];
}
function attr(el: Element | undefined, name: string): string | null {
  if (!el) return null;
  return el.getAttribute(`w:${name}`) ?? el.getAttribute(name);
}

function isColorful(hex: string | null): boolean {
  if (!hex || hex === 'auto' || !/^[0-9a-f]{6}$/i.test(hex)) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return Math.max(r, g, b) - Math.min(r, g, b) > 60;
}
function isFill(hex: string | null): boolean {
  if (!hex || hex === 'auto' || !/^[0-9a-f]{6}$/i.test(hex)) return false;
  return hex.toUpperCase() !== 'FFFFFF';
}

interface Numbering {
  levels: Map<string, { fmt: string; text: string; start: number }[]>; // numId → levels
  starts: Map<string, Map<number, number>>; // numId → ilvl → startOverride
}

function readNumbering(xml: string | null): Numbering {
  const levels = new Map<string, { fmt: string; text: string; start: number }[]>();
  const starts = new Map<string, Map<number, number>>();
  if (!xml) return { levels, starts };
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  const abstract = new Map<string, { fmt: string; text: string; start: number }[]>();
  for (const a of kids(root, 'abstractNum')) {
    const lv: { fmt: string; text: string; start: number }[] = [];
    for (const l of kids(a, 'lvl')) {
      const i = Number(attr(l, 'ilvl') ?? 0);
      lv[i] = { fmt: attr(kid(l, 'numFmt'), 'val') ?? 'decimal', text: attr(kid(l, 'lvlText'), 'val') ?? `%${i + 1}.`, start: Number(attr(kid(l, 'start'), 'val') ?? 1) };
    }
    abstract.set(attr(a, 'abstractNumId') ?? '', lv);
  }
  for (const n of kids(root, 'num')) {
    const id = attr(n, 'numId') ?? '';
    levels.set(id, abstract.get(attr(kid(n, 'abstractNumId'), 'val') ?? '') ?? []);
    const ov = new Map<number, number>();
    for (const o of kids(n, 'lvlOverride')) {
      const so = kid(o, 'startOverride');
      if (so) ov.set(Number(attr(o, 'ilvl') ?? 0), Number(attr(so, 'val') ?? 1));
    }
    starts.set(id, ov);
  }
  return { levels, starts };
}

function fmtNum(n: number, fmt: string): string {
  const roman = (x: number) => {
    const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let s = '';
    for (const [v, r] of t) while (x >= v) { s += r; x -= v; }
    return s;
  };
  switch (fmt) {
    case 'upperLetter': return String.fromCharCode(64 + ((n - 1) % 26) + 1);
    case 'lowerLetter': return String.fromCharCode(96 + ((n - 1) % 26) + 1);
    case 'upperRoman': return roman(n).toUpperCase();
    case 'lowerRoman': return roman(n);
    case 'bullet': return '•';
    case 'decimalZero': return String(n).padStart(2, '0');
    default: return String(n);
  }
}

export async function docxLines(file: File): Promise<{ lines: KLine[]; figures: string[] }> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const get = (p: string) => (zip[p] ? strFromU8(zip[p]) : null);
  const docXml = get('word/document.xml');
  if (!docXml) throw new Error('This file is not a Word document (.docx).');
  const numbering = readNumbering(get('word/numbering.xml'));
  const rels = new Map<string, string>();
  const relXml = get('word/_rels/document.xml.rels');
  if (relXml) {
    const rd = new DOMParser().parseFromString(relXml, 'application/xml');
    for (const r of Array.from(rd.getElementsByTagName('Relationship'))) rels.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '');
  }
  const doc = new DOMParser().parseFromString(docXml, 'application/xml');
  const body = doc.getElementsByTagNameNS('*', 'body')[0];
  const lines: KLine[] = [];
  const figures: string[] = [];
  const counters = new Map<string, number[]>();
  let lastList: string | null = null;

  const imageFor = async (embed: string) => {
    const target = rels.get(embed);
    if (!target) return null;
    const path = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`;
    const bytes = zip[path];
    const ext = path.split('.').pop()?.toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : null;
    if (!bytes || !mime) return null;
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return compressImage(`data:${mime};base64,${btoa(bin)}`);
  };

  const paragraph = async (p: Element) => {
    const pPr = kid(p, 'pPr');
    const paraFill = isFill(attr(pPr ? kid(pPr, 'shd') : undefined, 'fill')) ? 1 : 0;
    let cur = line('');
    const out: KLine[] = [cur];
    const pendingFigs: number[] = [];

    // automatic list numbering ("1." for questions, "A." for choices) isn't in the text — rebuild it
    const numPr = pPr ? kid(pPr, 'numPr') : undefined;
    const numId = attr(numPr ? kid(numPr, 'numId') : undefined, 'val');
    if (numId && numId !== '0' && numbering.levels.has(numId)) {
      const ilvl = Number(attr(numPr ? kid(numPr, 'ilvl') : undefined, 'val') ?? 0);
      const lv = numbering.levels.get(numId)!;
      const lvl = lv[ilvl] ?? { fmt: 'decimal', text: `%${ilvl + 1}.`, start: 1 };
      const c = counters.get(numId) ?? [];
      const listKey = `${numId}:${ilvl}`;
      const startAt = numbering.starts.get(numId)?.get(ilvl) ?? lvl.start;
      // lettered choice lists restart for every question, even if Word reused the same list
      const restartLetters = /Letter/.test(lvl.fmt) && lastList !== listKey;
      c[ilvl] = c[ilvl] === undefined || restartLetters ? startAt : c[ilvl] + 1;
      c.length = ilvl + 1;
      counters.set(numId, c);
      lastList = listKey;
      if (lvl.fmt !== 'none' && lvl.fmt !== 'bullet') {
        const label = lvl.text.replace(/%(\d)/g, (_, k) => fmtNum(c[Number(k) - 1] ?? startAt, (lv[Number(k) - 1] ?? lvl).fmt));
        appendTo(cur, `${label} `, 0, 0, 0);
      } else if (lvl.fmt === 'bullet') appendTo(cur, '- ', 0, 0, 0);
    } else if (cur.text === '' && kids(p).some((k) => k.localName === 'r')) {
      lastList = null;
    }

    const run = async (r: Element) => {
      const rPr = kid(r, 'rPr');
      const hlEl = rPr ? kid(rPr, 'highlight') : undefined;
      const hl = paraFill || (hlEl && attr(hlEl, 'val') !== 'none') || isFill(attr(rPr ? kid(rPr, 'shd') : undefined, 'fill')) ? 1 : 0;
      const color = isColorful(attr(rPr ? kid(rPr, 'color') : undefined, 'val')) ? 1 : 0;
      const bEl = rPr ? kid(rPr, 'b') : undefined;
      const bold = bEl && !['0', 'false'].includes(attr(bEl, 'val') ?? '') ? 1 : 0;
      for (const c of kids(r)) {
        if (c.localName === 't') appendTo(cur, c.textContent ?? '', hl, color, bold);
        else if (c.localName === 'tab') appendTo(cur, ' ', hl, color, bold);
        else if (c.localName === 'br' || c.localName === 'cr') {
          cur = line('');
          out.push(cur);
        } else if (c.localName === 'drawing' || c.localName === 'pict' || c.localName === 'object') {
          const blip = c.getElementsByTagNameNS('*', 'blip')[0] ?? c.getElementsByTagNameNS('*', 'imagedata')[0];
          const embed = blip?.getAttribute('r:embed') ?? blip?.getAttribute('r:id');
          if (embed) {
            const img = await imageFor(embed);
            if (img) pendingFigs.push(figures.push(img) - 1);
          }
        }
      }
    };

    const walk = async (el: Element) => {
      for (const c of kids(el)) {
        const n = c.localName;
        if (n === 'r') await run(c);
        else if (n === 'oMath' || n === 'oMathPara') appendTo(cur, Array.from(c.getElementsByTagNameNS('*', 't')).map((t) => t.textContent).join(''), 0, 0, 0);
        else if (['hyperlink', 'ins', 'smartTag', 'sdt', 'sdtContent', 'fldSimple', 'customXml'].includes(n)) await walk(c);
      }
    };
    await walk(p);
    for (const l of out) lines.push(l);
    for (const f of pendingFigs) lines.push(line(`[[FIG:${f}]]`));
    lines.push(line(''));
  };

  const table = async (tbl: Element) => {
    lines.push(line(''));
    kids(tbl, 'tr').forEach((tr, i) => {
      const cells = kids(tr, 'tc').map((tc) => Array.from(tc.getElementsByTagNameNS('*', 't')).map((t) => t.textContent).join('').trim() || ' ');
      lines.push(line(`| ${cells.join(' | ')} |`));
      if (i === 0) lines.push(line(`|${cells.map(() => '---').join('|')}|`));
    });
    lines.push(line(''));
  };

  for (const el of kids(body)) {
    if (el.localName === 'p') await paragraph(el);
    else if (el.localName === 'tbl') await table(el);
    else if (el.localName === 'sdt') for (const p of Array.from(el.getElementsByTagNameNS('*', 'p'))) await paragraph(p);
  }
  return { lines, figures };
}

// ═════════════════════════ PDF ═════════════════════════
interface Box { x0: number; y0: number; x1: number; y1: number }

function scoreBox(img: ImageData, b: Box) {
  const x0 = Math.max(0, Math.floor(b.x0));
  const y0 = Math.max(0, Math.floor(b.y0));
  const x1 = Math.min(img.width, Math.ceil(b.x1));
  const y1 = Math.min(img.height, Math.ceil(b.y1));
  let total = 0, bg = 0, ink = 0, inkColor = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i], g = img.data[i + 1], bl = img.data[i + 2];
      const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
      const lum = 0.299 * r + 0.587 * g + 0.114 * bl;
      total++;
      if (lum < 165) {
        ink++;
        if (mx - mn > 60) inkColor++;
      } else if (mx - mn >= 40 && mx >= 160) bg++;
    }
  }
  if (!total) return { hl: 0, color: 0 };
  return { hl: bg / Math.max(1, total - ink), color: ink > 6 ? inkColor / ink : 0 };
}

export async function pdfLines(file: File, onProgress?: (p: number) => void): Promise<{ lines: KLine[]; figures: string[]; scanned: boolean }> {
  const pdfjs = await import('pdfjs-dist');
  const doc = await openPdf(file);
  const lines: KLine[] = [];
  const figures: string[] = [];
  let textChars = 0;
  const SCALE = 1.6;

  for (let pn = 1; pn <= doc.numPages; pn++) {
    const page = await doc.getPage(pn);
    const vp = page.getViewport({ scale: SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const content = await page.getTextContent();
    const items = (content.items as TextItem[]).filter((it) => 'str' in it && it.str.trim() !== '');
    textChars += items.reduce((s, it) => s + it.str.length, 0);

    // PDF highlight annotations (made in Acrobat, Edge, Preview…)
    const annots = (await page.getAnnotations()).filter((a) => ['Highlight', 'Underline', 'Squiggly'].includes(a.subtype));
    const annotBoxes: Box[] = annots.flatMap((a) => {
      const q: number[] | undefined = a.quadPoints ? Array.from(a.quadPoints as ArrayLike<number>) : undefined;
      if (q && q.length >= 8) {
        const out: Box[] = [];
        for (let i = 0; i + 7 < q.length; i += 8) {
          const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]];
          const ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
          out.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
        }
        return out;
      }
      const r = a.rect as number[];
      return r ? [{ x0: r[0], y0: r[1], x1: r[2], y1: r[3] }] : [];
    });

    const fontIsBold = (name: string) => {
      try {
        const f = page.commonObjs.has(name) ? (page.commonObjs.get(name) as { name?: string; bold?: boolean }) : null;
        return !!f && (f.bold === true || /bold|black|heavy|semibold|demi/i.test(f.name ?? ''));
      } catch {
        return false;
      }
    };

    type Part = { x: number; w: number; s: string; hl: number; color: number; bold: number };
    const scored = items.map((it) => {
      const tx = it.transform;
      const h = Math.hypot(tx[2], tx[3]) || it.height || 10;
      const pdfBox: Box = { x0: tx[4], y0: tx[5] - 0.3 * h, x1: tx[4] + it.width, y1: tx[5] + 1.0 * h };
      const [ax, ay] = vp.convertToViewportPoint(pdfBox.x0, pdfBox.y0);
      const [bx, by] = vp.convertToViewportPoint(pdfBox.x1, pdfBox.y1);
      const s = scoreBox(img, { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) });
      const area = (pdfBox.x1 - pdfBox.x0) * (pdfBox.y1 - pdfBox.y0) || 1;
      const annotated = annotBoxes.some((b) => {
        const ix = Math.max(0, Math.min(b.x1, pdfBox.x1) - Math.max(b.x0, pdfBox.x0));
        const iy = Math.max(0, Math.min(b.y1, pdfBox.y1) - Math.max(b.y0, pdfBox.y0));
        return (ix * iy) / area > 0.35;
      });
      return { it, h, hl: annotated ? 1 : s.hl, color: s.color, bold: fontIsBold(it.fontName) ? 1 : 0 };
    });

    // images on the page → candidate figures (skip tiny logos and full-page scans)
    const figAt: { y: number; idx: number }[] = [];
    try {
      const ops = await page.getOperatorList();
      const O = pdfjs.OPS;
      const stack: number[][] = [];
      let m = [1, 0, 0, 1, 0, 0];
      const mul = (a: number[], b: number[]) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
      const pageArea = vp.width * vp.height;
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        if (fn === O.save) stack.push(m);
        else if (fn === O.restore) m = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (fn === O.transform) m = mul(m, ops.argsArray[i] as number[]);
        else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageXObjectRepeat) {
          const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => vp.convertToViewportPoint(m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]));
          const xs = pts.map((p) => p[0]);
          const ys = pts.map((p) => p[1]);
          const b = { x0: Math.max(0, Math.min(...xs)), y0: Math.max(0, Math.min(...ys)), x1: Math.min(vp.width, Math.max(...xs)), y1: Math.min(vp.height, Math.max(...ys)) };
          const w = b.x1 - b.x0;
          const hgt = b.y1 - b.y0;
          if (w < 70 * (SCALE / 1.6) || hgt < 50 * (SCALE / 1.6) || (w * hgt) / pageArea > 0.7) continue;
          const c = document.createElement('canvas');
          c.width = Math.round(w);
          c.height = Math.round(hgt);
          c.getContext('2d')!.drawImage(canvas, b.x0, b.y0, w, hgt, 0, 0, c.width, c.height);
          figAt.push({ y: b.y0, idx: figures.push(c.toDataURL('image/png')) - 1 });
        }
      }
    } catch {
      /* figures are optional */
    }

    // two-column detection (same idea as the plain-text reader)
    const mid = vp.width / SCALE / 2;
    const crossing = scored.filter((s) => s.it.transform[4] < mid - 20 && s.it.transform[4] + s.it.width > mid + 20).length;
    const right = scored.filter((s) => s.it.transform[4] > mid).length;
    const twoCol = scored.length > 20 && right > scored.length * 0.3 && crossing < scored.length * 0.05;
    const columns = twoCol ? [scored.filter((s) => s.it.transform[4] < mid), scored.filter((s) => s.it.transform[4] >= mid)] : [scored];

    for (const col of columns) {
      const rows: { y: number; h: number; parts: Part[] }[] = [];
      for (const s of col) {
        const y = s.it.transform[5];
        let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2.5, s.h * 0.35));
        if (!row) rows.push((row = { y, h: s.h, parts: [] }));
        row.parts.push({ x: s.it.transform[4], w: s.it.width, s: s.it.str, hl: s.hl, color: s.color, bold: s.bold });
      }
      rows.sort((a, b) => b.y - a.y);
      let prev: (typeof rows)[number] | null = null;
      const pageFigs = [...figAt].sort((a, b) => a.y - b.y);
      for (const r of rows) {
        const yTop = vp.convertToViewportPoint(0, r.y + r.h)[1];
        while (pageFigs.length && pageFigs[0].y < yTop && col === columns[0]) {
          lines.push(line(''), line(`[[FIG:${pageFigs.shift()!.idx}]]`), line(''));
        }
        r.parts.sort((a, b) => a.x - b.x);
        if (prev && prev.y - r.y > Math.max(prev.h, r.h) * 1.75) lines.push(line(''));
        const l = line('');
        let lastEnd = -1;
        for (const p of r.parts) {
          if (lastEnd >= 0 && p.x - lastEnd > 1.5 && !l.text.endsWith(' ') && !p.s.startsWith(' ')) appendTo(l, ' ', 0, 0, 0);
          appendTo(l, p.s.replace(/\s+/g, ' '), p.hl, p.color, p.bold);
          lastEnd = p.x + p.w;
        }
        lines.push(l);
        prev = r;
      }
      if (col === columns[0]) for (const f of pageFigs) lines.push(line(''), line(`[[FIG:${f.idx}]]`), line(''));
      lines.push(line(''));
    }
    onProgress?.(pn / doc.numPages);
  }
  return { lines, figures, scanned: textChars < 60 * doc.numPages };
}

// ═════════════════════════ shared: lines → sealed test ═════════════════════════
const alnum = (s: string) => s.toLowerCase().replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/[^a-z0-9]/g, '');

/** alphanumeric-only view of a line, with a map back to the original character positions */
function index(l: KLine) {
  let s = '';
  const map: number[] = [];
  const t = l.text.toLowerCase();
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (/[a-z0-9]/.test(c)) {
      s += c;
      map.push(i);
    }
  }
  return { s, map };
}

const avg = (arr: number[], a: number, b: number, text: string) => {
  let sum = 0, n = 0;
  for (let i = a; i < b; i++) {
    if (text[i] === ' ') continue;
    sum += arr[i] ?? 0;
    n++;
  }
  return n ? sum / n : 0;
};

/** The one clearly-marked choice, or -1. */
function pick(v: number[]): number {
  let m = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > v[m]) m = i;
  const rest = v.filter((_, i) => i !== m);
  const second = rest.length ? Math.max(...rest) : 0;
  return v[m] >= 0.3 && v[m] - second >= 0.25 ? m : -1;
}

export function buildKeyedTest(
  lines: KLine[],
  figures: string[],
  opts: { title: string; source: string; scanned?: boolean },
): { test: Test | null; report: KeyedReport } {
  const report: KeyedReport = { questions: 0, keyed: 0, missing: [], byHighlight: 0, byColor: 0, byBold: 0, byText: 0, figures: 0, figureWarnings: [], scanned: !!opts.scanned };

  // short, fully-marked lines that aren't choices are written answers ("7/2", "Answer: B") — keep them out of the test text
  const candidates: { idx: number; value: string }[] = [];
  const feed = lines.map((l, idx) => {
    const t = l.text.trim();
    const marked = avg(l.hl, 0, l.text.length, l.text) > 0.7 || avg(l.color, 0, l.text.length, l.text) > 0.7;
    const m = t.match(/^(?:(?:correct\s+)?answer\s*[:\-–]?\s*)?(-?[\d.]+(?:\/[\d.]+)?|[A-D])\.?$/i);
    if (marked && m && t.length <= 24 && !/^\(?[A-D]\s*[).:]\s*\S/.test(t)) {
      candidates.push({ idx, value: m[1].toUpperCase() });
      return '';
    }
    return l.text;
  });

  const parsed = parseText(feed.join('\n'));
  report.questions = parsed.questionCount;
  if (!parsed.questionCount) return { test: null, report };

  const byId = new Map<string, Question>();
  parsed.sections.forEach((s) => s.modules.forEach((m) => m.questions.forEach((q) => byId.set(q.id, q))));
  const idx = lines.map(index);
  const anchors: number[] = [];
  let cursor = 0;

  for (const qid of parsed.order) {
    const q = byId.get(qid);
    if (!q) continue;
    if (q.type === 'mcq') {
      const found: { li: number; start: number }[] = [];
      let c = cursor;
      q.choices.forEach((ch, ci) => {
        const key = LETTERS[ci].toLowerCase() + alnum(ch.text).slice(0, 14);
        const limit = Math.min(lines.length, c + 500);
        for (let li = c; li < limit; li++) {
          const pos = idx[li].s.indexOf(key);
          if (pos < 0) continue;
          // the letter must really be a choice marker: "A)", "A.", "(A)", "A:" or "A " at a word start
          const orig = idx[li].map[pos];
          const text = lines[li].text;
          const before = text.slice(Math.max(0, orig - 1), orig);
          const after = text.slice(orig + 1, orig + 3);
          const lead = text.slice(0, orig).trim();
          const explicit = /^\s*[).:]/.test(after) && (orig === 0 || /[\s(]/.test(before));
          const atLineStart = (lead === '' || lead === '(') && /^\s/.test(after);
          if (!explicit && !atLineStart) continue;
          found[ci] = { li, start: orig > 0 && before === '(' ? orig - 1 : orig };
          c = li;
          break;
        }
      });
      if (found[0]) anchors.push(found[0].li);
      if (found.length) cursor = found[found.length - 1]?.li ?? cursor;

      if (!q.answer && found.filter(Boolean).length === q.choices.length) {
        const ranges = found.map((f, i) => {
          const nxt = found[i + 1];
          const end = nxt && nxt.li === f.li ? nxt.start : lines[f.li].text.length;
          const segs: [number, number, number][] = [[f.li, f.start, end]];
          // wrapped choice text continues on the following lines
          if (nxt && nxt.li > f.li) for (let li = f.li + 1; li < nxt.li && li <= f.li + 4; li++) if (lines[li].text.trim() && !lines[li].text.includes('[[FIG')) segs.push([li, 0, lines[li].text.length]);
          return segs;
        });
        const score = (key: 'hl' | 'color' | 'bold') =>
          ranges.map((segs) => {
            let sum = 0, n = 0;
            for (const [li, a, b] of segs) {
              const len = b - a;
              sum += avg(lines[li][key], a, b, lines[li].text) * len;
              n += len;
            }
            return n ? sum / n : 0;
          });
        let choice = pick(score('hl'));
        if (choice >= 0) report.byHighlight++;
        else if ((choice = pick(score('color'))) >= 0) report.byColor++;
        else if ((choice = pick(score('bold'))) >= 0) report.byBold++;
        if (choice >= 0) q.answer = LETTERS[choice];
      } else if (q.answer) report.byText++;
    } else {
      const key = alnum(q.prompt).slice(0, 24);
      for (let li = cursor; key && li < Math.min(lines.length, cursor + 500); li++) {
        if (idx[li].s.includes(key.slice(0, 16))) {
          anchors.push(li);
          cursor = li;
          break;
        }
      }
      if (q.answer) report.byText++;
    }
  }

  // written answers ("7/2" highlighted under a grid-in, or a highlighted letter) belong to the question above them
  const anchored = parsed.order.map((id, i) => ({ q: byId.get(id)!, at: anchors[i] ?? -1 })).filter((x) => x.q && x.at >= 0);
  for (const cand of candidates) {
    let owner: Question | undefined;
    for (const a of anchored) if (a.at <= cand.idx) owner = a.q;
    if (!owner || owner.answer) continue;
    if (owner.type === 'mcq' && /^[A-D]$/.test(cand.value)) owner.answer = cand.value;
    if (owner.type === 'spr' && /\d/.test(cand.value)) {
      owner.answer = cand.value;
      owner.answers = [cand.value];
    }
    if (owner.answer) report.byText++;
  }

  // figures: first one becomes the question's figure, others stay inline
  const FIG = /\[\[FIG:(\d+)\]\]/g;
  const sections: Section[] = parsed.sections.map((s) => ({
    ...s,
    modules: s.modules.map((m) => ({
      ...m,
      questions: m.questions.map((q0) => {
        const q = byId.get(q0.id) ?? q0;
        let image: string | undefined;
        const take = (text: string | undefined) =>
          text?.replace(FIG, (_, n) => {
            const src = figures[Number(n)];
            if (!src) return '';
            if (!image) {
              image = src;
              return '';
            }
            return `\n\n![figure](${src})\n\n`;
          }).trim();
        const passage = take(q.passage);
        const prompt = take(q.prompt) ?? '';
        const choices = q.choices.map((c, i) => ({ ...c, text: (i === q.choices.length - 1 ? take(c.text) : c.text.replace(FIG, (_, n) => (figures[Number(n)] ? `![figure](${figures[Number(n)]})` : ''))) ?? '' }));
        if (image) report.figures++;
        const label = `${s.kind === 'rw' ? 'R&W' : 'Math'} M${m.stage} Q${m.questions.indexOf(q0) + 1}`;
        if (!image && /\b(graph|figure|shown|diagram|scatterplot)\b/i.test(`${passage} ${prompt}`) && !/\|/.test(passage ?? '')) report.figureWarnings.push(label);
        const keyed = q.type === 'mcq' ? !!q.answer : !!(q.answer || q.answers?.length);
        if (keyed) report.keyed++;
        else report.missing.push(label);
        return {
          ...q,
          passage: passage || undefined,
          prompt,
          choices,
          image,
          imagePlacement: image ? (s.kind === 'rw' ? 'passage' : 'question') : undefined,
        } as Question;
      }),
    })),
  }));

  const now = Date.now();
  const test: Test = {
    id: uid('t_'),
    title: opts.title.trim() || 'Mock test',
    description: `From ${opts.source}`,
    createdAt: now,
    updatedAt: now,
    sections,
    breakMinutes: sections.length > 1 ? 10 : 0,
    routingThreshold: 0.6,
    source: 'keyed',
    sealed: true,
  };
  return { test, report };
}
