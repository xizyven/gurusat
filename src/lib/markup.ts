// Lightweight question markup → HTML.
//
//   $x^2$ or \( x^2 \)   inline math (KaTeX)      $$ ... $$ or \[ ... \]  display math
//   **bold**  *italic*  __underlined__ (SAT "underlined sentence")
//   ______  (3+ underscores) → answer blank
//   | a | b |   markdown tables          - item / • item  → bullet list
//   ![alt](url)  image                   blank line → new paragraph
import katex from 'katex';

const cache = new Map<string, string>();

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMath(tex: string, display: boolean) {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html', strict: 'ignore' });
  } catch {
    return `<code>${esc(tex)}</code>`;
  }
}

function inline(s: string, slots: string[]): string {
  const slot = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;
  // images first (their URLs may contain underscores / asterisks)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => slot(`<img class="mk-img" alt="${esc(alt)}" src="${esc(url)}">`));
  s = esc(s);
  s = s.replace(/_{3,}/g, () => slot('<span class="mk-blank" aria-label="blank"></span>'));
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(.+?)__/g, '<u>$1</u>');
  s = s.replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '$1<em>$2</em>');
  return s;
}

function table(lines: string[], slots: string[]): string {
  const rows = lines
    .filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l))
    .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
  const sep = lines.findIndex((l) => /^\s*\|?\s*:?-{2,}/.test(l));
  const hasHead = sep === 1;
  let html = '<div class="mk-table-wrap"><table class="mk-table">';
  rows.forEach((r, i) => {
    const tag = hasHead && i === 0 ? 'th' : 'td';
    if (hasHead && i === 0) html += '<thead>';
    html += '<tr>' + r.map((c) => `<${tag}>${inline(c, slots)}</${tag}>`).join('') + '</tr>';
    if (hasHead && i === 0) html += '</thead><tbody>';
  });
  html += (hasHead ? '</tbody>' : '') + '</table></div>';
  return html;
}

export function renderMarkup(src: string | undefined): string {
  if (!src) return '';
  const hit = cache.get(src);
  if (hit !== undefined) return hit;

  const slots: string[] = [];
  const slot = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = src.replace(/\r\n?/g, '\n');

  // math first so nothing inside it is touched
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => slot(renderMath(t.trim(), true)));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => slot(renderMath(t.trim(), true)));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => slot(renderMath(t.trim(), false)));
  // $...$ with pandoc's rules so "$5 and $10" stays money
  s = s.replace(/(^|[^\\$])\$(?=\S)([^$\n]*?\S)\$(?!\d)/g, (_, pre, t) => pre + slot(renderMath(t, false)));
  // \$ is a literal dollar sign
  s = s.replace(/\\\$/g, () => slot('$'));

  const blocks = s.split(/\n{2,}/);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*\|/.test(l)) && lines.length >= 1) {
      out.push(table(lines, slots));
      continue;
    }
    // split a block into runs of list items and plain lines
    let buf: string[] = [];
    let list: string[] = [];
    const flushBuf = () => {
      if (buf.length) out.push(`<p>${buf.map((l) => inline(l, slots)).join('<br>')}</p>`);
      buf = [];
    };
    const flushList = () => {
      if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l, slots)}</li>`).join('')}</ul>`);
      list = [];
    };
    for (const l of lines) {
      const m = l.match(/^\s*(?:[-•▪●◦]|\*(?!\*))\s+(.*)$/);
      if (m) {
        flushBuf();
        list.push(m[1]);
      } else if (/^\s*\|/.test(l)) {
        flushBuf();
        flushList();
        out.push(table([l], slots));
      } else {
        flushList();
        buf.push(l);
      }
    }
    flushBuf();
    flushList();
  }

  let html = out.join('');
  // restore slots (they can nest one level: images inside tables etc.)
  for (let i = 0; i < 2; i++) html = html.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[Number(n)] ?? '');
  if (cache.size > 800) cache.clear();
  cache.set(src, html);
  return html;
}

/** Plain-text preview (for lists and tables). */
export function plainText(src: string | undefined, max = 140): string {
  if (!src) return '';
  const t = src
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[image]')
    .replace(/\$\$?([^$]+)\$\$?/g, '$1')
    .replace(/[*_|]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
