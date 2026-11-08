// Student-produced response (grid-in) rules, modeled on the digital SAT.
import type { Question } from './types';

/** Keep only characters the SAT input accepts and enforce the length limits. */
export function sanitizeSpr(raw: string): string {
  let s = raw.replace(/[^0-9./-]/g, '');
  // only a leading minus
  s = s.replace(/(?!^)-/g, '');
  // at most one slash and one dot
  const firstSlash = s.indexOf('/');
  if (firstSlash >= 0) s = s.slice(0, firstSlash + 1) + s.slice(firstSlash + 1).replace(/\//g, '');
  const parts = s.split('/');
  s = parts.map((p) => {
    const i = p.indexOf('.');
    return i >= 0 ? p.slice(0, i + 1) + p.slice(i + 1).replace(/\./g, '') : p;
  }).join('/');
  const max = s.startsWith('-') ? 6 : 5;
  return s.slice(0, max);
}

export function parseNumber(s: string): number | null {
  const t = s.trim().replace(/\s+/g, '').replace(/,/g, '');
  if (!t) return null;
  // mixed numbers like "3 1/2" are not allowed by the SAT; treat a/b and decimals
  const frac = t.match(/^(-?)(\d*\.?\d+)\/(\d*\.?\d+)$/);
  if (frac) {
    const d = parseFloat(frac[3]);
    if (!d) return null;
    return (frac[1] ? -1 : 1) * (parseFloat(frac[2]) / d);
  }
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return parseFloat(t);
  return null;
}

function decimals(s: string): number {
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** True if the student's entry matches any accepted answer (fraction/decimal equivalents, SAT rounding). */
export function checkSpr(entry: string | undefined, q: Pick<Question, 'answer' | 'answers'>): boolean {
  if (!entry) return false;
  const val = parseNumber(entry);
  const accepted = (q.answers && q.answers.length ? q.answers : [q.answer]).filter(Boolean);
  for (const a of accepted) {
    if (a.trim().toLowerCase() === entry.trim().toLowerCase()) return true;
    const truth = parseNumber(a);
    if (truth === null || val === null) continue;
    if (Math.abs(truth - val) < 1e-9) return true;
    // A decimal that fills the box may be rounded or truncated (e.g. 2/3 → .6666, .6667, 0.666, 0.667)
    const e = entry.replace(/^-/, '');
    if (!e.includes('/') && e.includes('.')) {
      const d = decimals(e);
      const filled = e.length >= 5 || (e.startsWith('.') && e.length >= 4) || (e.startsWith('0.') && d >= 3);
      if (d >= 3 && filled) {
        const p = Math.pow(10, d);
        const rounded = Math.round(truth * p) / p;
        const truncated = Math.trunc(truth * p) / p;
        if (Math.abs(val - rounded) < 1e-9 || Math.abs(val - truncated) < 1e-9) return true;
      }
    }
  }
  return false;
}

export function isCorrect(q: Question, answer: string | undefined): boolean {
  if (!answer) return false;
  if (q.type === 'spr') return checkSpr(answer, q);
  return answer.toUpperCase() === (q.answer || '').toUpperCase();
}

/** Nicely formatted correct answer for display. */
export function answerLabel(q: Question): string {
  if (q.type === 'spr') return (q.answers && q.answers.length ? q.answers : [q.answer]).filter(Boolean).join(' or ');
  return q.answer || '—';
}
