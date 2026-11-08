// Character-offset highlights that survive re-rendering.
// Offsets are counted over the root element's visible text nodes (KaTeX MathML is skipped).
import type { Highlight } from '../lib/types';

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = (n as Text).parentElement;
      if (p && p.closest('.katex-mathml')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n: Node | null;
  while ((n = walker.nextNode())) out.push(n as Text);
  return out;
}

/** Number of visible characters between the start of root and a boundary point. */
function boundaryOffset(root: HTMLElement, nodes: Text[], container: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(container, offset);
  let count = 0;
  for (const t of nodes) {
    if (t === container) {
      count += offset;
      break;
    }
    if (r.intersectsNode(t)) count += t.data.length;
  }
  return count;
}

/** Convert the current selection into [start, end) offsets within root, or null. */
export function selectionOffsets(root: HTMLElement): { start: number; end: number; text: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const text = range.toString();
  if (!text.trim()) return null;
  const nodes = textNodes(root);
  const start = boundaryOffset(root, nodes, range.startContainer, range.startOffset);
  const end = boundaryOffset(root, nodes, range.endContainer, range.endOffset);
  if (end - start < 1) return null;
  return { start, end, text };
}

/** Wrap highlight ranges in <mark> elements. Call on freshly rendered HTML. */
export function applyHighlights(root: HTMLElement, list: Highlight[]) {
  if (!list.length) return;
  const sorted = [...list].sort((a, b) => a.start - b.start);
  for (const h of sorted) {
    const nodes = textNodes(root);
    let pos = 0;
    const targets: { node: Text; from: number; to: number }[] = [];
    for (const t of nodes) {
      const len = t.data.length;
      const a = Math.max(h.start, pos);
      const b = Math.min(h.end, pos + len);
      if (a < b) targets.push({ node: t, from: a - pos, to: b - pos });
      pos += len;
      if (pos >= h.end) break;
    }
    targets.forEach(({ node, from, to }, i) => {
      let mid = node;
      if (from > 0) mid = mid.splitText(from);
      if (to - from < mid.data.length) mid.splitText(to - from);
      const mark = document.createElement('mark');
      mark.className = `hl hl-${h.color}${h.underline ? ' hl-u' : ''}`;
      mark.dataset.hid = h.id;
      if (i === targets.length - 1 && h.note) mark.classList.add('hl-note-end');
      mid.parentNode!.insertBefore(mark, mid);
      mark.appendChild(mid);
    });
  }
}
