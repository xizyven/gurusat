// Smart text → test parser.
// Handles the common shapes of teacher-made mock tests:
//   • numbered questions ("1." / "1)" / "Question 1" / a number alone on a line)
//   • choices "A)" "A." "(A)" "A:" — on separate lines or all on one line
//   • inline answers ("Answer: B", "Correct Answer: 7/2") and explanations ("Explanation:", "Rationale")
//   • an answer key at the end ("Answer Key" → "1. B  2. C …", optionally split by module)
//   • section / module headers ("Section 1, Module 2: Math", "Reading and Writing", "Module 2")
//   • College Board question-bank exports ("Question ID …", "Correct Answer:", "Question Difficulty:")
import { ensureTags, DOMAINS } from './taxonomy';
import type { Difficulty, Module, Question, Section, SectionKind } from './types';
import { uid } from './util';

export interface ParseResult {
  sections: Section[];
  warnings: string[];
  questionCount: number;
  answered: number;
  /** question ids in document order */
  order: string[];
}


const NOISE = [
  /^mark for review$/i,
  /^question \d+ of \d+$/i,
  /^\d+ of \d+$/,
  /unauthorized copying/i,
  /^(continue|stop)\.?$/i,
  /^go on to the next page/i,
  /^bluebook$/i,
  /^assessment\s+test\s+domain\s+skill\s+difficulty$/i,
  /^id:\s*\w+(\s+answer)?$/i,
  /^page \d+( of \d+)?$/i,
  /^©.*college board/i,
];

const STEM_STARTERS =
  /(Which choice|Which quotation|Which finding|Which statement|Which of the following|Based on the texts?|According to the text|As used in the text|The student wants|What is the|What are|What was|What value|What does|How (?:does|many|much|would)|If .{0,80}what|In the|For what value|Which expression|Which equation|Which table|Which graph|Which of)/g;

function normalize(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/[‐‑]/g, '-')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !NOISE.some((re) => re.test(l)))
    .join('\n')
    .replace(/_{3,}/g, '______');
}

// ───────── headers ─────────
function headerInfo(line: string): { kind?: SectionKind; moduleNo?: number } | null {
  if (line.length > 70) return null;
  const l = line.toLowerCase().replace(/[*#]/g, '').trim();
  let kind: SectionKind | undefined;
  let moduleNo: number | undefined;
  const mod = l.match(/\bmodule\s*([12])\b/);
  if (mod) moduleNo = Number(mod[1]);
  if (/\breading\s*(and|&)\s*writing\b|\bverbal\b|\benglish\b/.test(l)) kind = 'rw';
  else if (/\bmath(ematics)?\b/.test(l)) kind = 'math';
  const isHeader =
    (mod && l.length < 60) ||
    (kind && /^(section\s*\d+\s*[,:–—-]?\s*)?(module\s*\d\s*[,:–—-]?\s*)?(reading\s*(and|&)\s*writing|math(ematics)?|verbal|english)(\s*(section|module\s*\d))?\s*[:–—-]?\s*(module\s*\d)?\s*$/.test(l));
  if (!isHeader) return null;
  return { kind, moduleNo };
}

// ───────── answer key ─────────
function splitAnswerKey(lines: string[]): { body: string[]; key: string[][] } {
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^(answer\s*key|answers|answer\s*sheet|correct\s*answers|key)\s*[:\-–]?\s*$/i.test(lines[i]) || /^answer\s*key\b/i.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return { body: lines, key: [] };
  const keyLines = lines.slice(start + 1);
  const groups: string[][] = [[]];
  for (const l of keyLines) {
    if (headerInfo(l) && groups[groups.length - 1].length) groups.push([]);
    const re = /(?:^|\s)(?:q(?:uestion)?\s*)?(\d{1,2})\s*[.):\-–]?\s*((?:-?[\d./]+(?:\s*(?:or|,)\s*-?[\d./]+)*)|[A-Da-d])(?=\s|$|[,;])/g;
    let m: RegExpExecArray | null;
    const found: [number, string][] = [];
    while ((m = re.exec(l))) found.push([Number(m[1]), m[2]]);
    for (const [n, v] of found) {
      const g = groups[groups.length - 1];
      if (n === 1 && g.length) groups.push([]);
      groups[groups.length - 1][n - 1] = v.trim();
    }
  }
  return { body: lines.slice(0, start), key: groups.filter((g) => g.length) };
}

// ───────── question splitting ─────────
interface RawQ {
  lines: string[];
}

function questionStart(line: string): { n: number; rest: string } | null {
  let m = line.match(/^(?:question|q)\s*#?\s*(\d{1,2})\s*[.):\-–]?\s*(.*)$/i);
  if (m) return { n: Number(m[1]), rest: m[2] };
  m = line.match(/^(\d{1,2})\s*[.)]\s+(.*)$/);
  if (m) return { n: Number(m[1]), rest: m[2] };
  m = line.match(/^(\d{1,2})\s*[.)]?$/);
  if (m) return { n: Number(m[1]), rest: '' };
  return null;
}

function splitQuestions(lines: string[]): { groups: { kind?: SectionKind; moduleNo?: number; qs: RawQ[] }[] } {
  const groups: { kind?: SectionKind; moduleNo?: number; qs: RawQ[] }[] = [{ qs: [] }];
  const cur = () => groups[groups.length - 1];
  let expected = 1;
  let curQ: RawQ | null = null;
  const qbank = lines.some((l) => /^question id\b/i.test(l));

  for (const line of lines) {
    const h = headerInfo(line);
    if (h) {
      const g = cur();
      if (g.qs.length) {
        groups.push({ kind: h.kind ?? g.kind, moduleNo: h.moduleNo, qs: [] });
      } else {
        g.kind = h.kind ?? g.kind;
        g.moduleNo = h.moduleNo ?? g.moduleNo;
      }
      expected = 1;
      curQ = null;
      continue;
    }
    if (qbank) {
      if (/^question id\b/i.test(line)) {
        curQ = { lines: [] };
        cur().qs.push(curQ);
        continue;
      }
    } else {
      const s = questionStart(line);
      if (s && (s.n === expected || (s.n === 1 && cur().qs.length > 0))) {
        if (s.n === 1 && cur().qs.length > 0) {
          groups.push({ kind: cur().kind, qs: [] });
        }
        curQ = { lines: s.rest ? [s.rest] : [] };
        cur().qs.push(curQ);
        expected = s.n + 1;
        continue;
      }
    }
    if (curQ) curQ.lines.push(line);
  }
  return { groups: groups.filter((g) => g.qs.length) };
}

// ───────── one question ─────────
function joinLines(lines: string[]): string {
  // paragraphs separated by blank lines; wrapped lines joined with spaces; keep bullets/tables/Text 1 headers
  const out: string[] = [];
  let para = '';
  const flush = () => {
    if (para) out.push(para.trim());
    para = '';
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      flush();
      out.push('');
      continue;
    }
    if (/^(text\s*[12])\s*$/i.test(l)) {
      flush();
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(`**Text ${l.replace(/\D/g, '')}**`, '');
      continue;
    }
    if (/^[•▪●◦\-–]\s+/.test(l) || l.startsWith('|')) {
      flush();
      out.push(l.replace(/^[–]\s+/, '- '));
      continue;
    }
    if (para.endsWith('-') && /^[a-z]/.test(l)) para = para.slice(0, -1) + l;
    else para = para ? `${para} ${l}` : l;
  }
  flush();
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(\*\*Text [12]\*\*)\n(?!\n)/g, '$1\n\n')
    .trim();
}

function extractChoices(lines: string[]): { pre: string[]; choices: string[] } {
  const marker = (l: string) => l.match(/^\(?([A-D])\s*[).:]\s*(.*)$/) || l.match(/^([A-D])$/) || l.match(/^([A-D])\s+(?=[\d$\\(\-−])(.*)$/);
  // inline "A) .. B) .. C) .. D) .."
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^\(?A[).]\s*(.+?)\s+\(?B[).]\s*(.+?)\s+\(?C[).]\s*(.+?)\s+\(?D[).]\s*(.+)$/);
    if (m) return { pre: lines.slice(0, i), choices: [m[1], m[2], m[3], m[4]].map((s) => s.trim()) };
  }
  // find the last "A" marker followed by B, C, D in order
  for (let i = lines.length - 1; i >= 0; i--) {
    const mA = marker(lines[i]);
    if (!mA || mA[1] !== 'A') continue;
    const choices: string[] = [mA[2] ?? ''];
    let want = 'B';
    let ok = true;
    for (let j = i + 1; j < lines.length; j++) {
      const m = marker(lines[j]);
      if (m && m[1] === want) {
        choices.push(m[2] ?? '');
        want = String.fromCharCode(want.charCodeAt(0) + 1);
        if (want > 'D') {
          // remaining lines belong to D
          for (let k = j + 1; k < lines.length; k++) if (lines[k]) choices[3] = `${choices[3]} ${lines[k]}`.trim();
          break;
        }
      } else if (lines[j]) {
        choices[choices.length - 1] = `${choices[choices.length - 1]} ${lines[j]}`.trim();
      }
    }
    if (want <= 'D') ok = choices.length >= 4;
    if (ok && choices.length === 4) return { pre: lines.slice(0, i), choices };
  }
  return { pre: lines, choices: [] };
}

function splitStem(text: string, kind: SectionKind): { passage: string; prompt: string } {
  if (!text) return { passage: '', prompt: '' };
  const tail = text.slice(-500);
  const offset = text.length - tail.length;
  let best = -1;
  STEM_STARTERS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STEM_STARTERS.exec(tail))) {
    const idx = m.index;
    const before = tail.slice(Math.max(0, idx - 2), idx);
    if (idx === 0 || /[.?!"”)\]]\s$|\n$|^\s*$/.test(before) || /\n/.test(before)) best = idx;
  }
  if (best >= 0) {
    const cut = offset + best;
    const passage = text.slice(0, cut).trim();
    const prompt = text.slice(cut).trim();
    if (kind === 'rw' || passage.length > 220) return { passage, prompt };
    return { passage: '', prompt: text.trim() };
  }
  if (kind === 'rw' && /\?\s*$/.test(text)) {
    const q = text.match(/([^.?!\n]*\?)\s*$/);
    if (q && q.index !== undefined && q.index > 0) return { passage: text.slice(0, q.index).trim(), prompt: q[1].trim() };
  }
  return { passage: '', prompt: text.trim() };
}

function parseOne(raw: RawQ, kindHint: SectionKind | undefined): { q: Question; kind: SectionKind } {
  let lines = [...raw.lines];
  let answer = '';
  let explanation = '';
  let difficulty: Difficulty | undefined;
  let skill: string | undefined;

  // difficulty / skill tags from question-bank exports
  const diffIdx = lines.findIndex((l) => /^question difficulty\s*:/i.test(l));
  if (diffIdx >= 0) {
    const d = lines[diffIdx].split(':')[1]?.trim().toLowerCase();
    if (d === 'easy' || d === 'medium' || d === 'hard') difficulty = d;
    lines.splice(diffIdx, 1);
  }
  const header = lines.slice(0, 3).join(' ');
  for (const k of ['rw', 'math'] as SectionKind[])
    for (const d of DOMAINS[k]) for (const s of d.skills) if (header.toLowerCase().includes(s.toLowerCase()) && (!skill || s.length > skill.length)) skill = s;
  if (skill && /^(sat|psat)/i.test(lines[0] ?? '')) lines = lines.slice(1);

  // explanation (everything after "Explanation" / "Rationale")
  const expIdx = lines.findIndex((l) => /^(explanation|rationale|solution)\b\s*:?/i.test(l));
  if (expIdx >= 0) {
    explanation = joinLines([lines[expIdx].replace(/^(explanation|rationale|solution)\b\s*:?\s*/i, ''), ...lines.slice(expIdx + 1)]);
    lines = lines.slice(0, expIdx);
  }
  // inline answer
  const ansIdx = lines.findIndex((l) => /^(correct\s+)?answer\s*[:\-–]?\s*\S+/i.test(l) || /^key\s*[:\-–]\s*\S+/i.test(l));
  if (ansIdx >= 0) {
    answer = lines[ansIdx].replace(/^(correct\s+)?(answer|key)\s*[:\-–]?\s*/i, '').trim().replace(/[.)]$/, '');
    lines = lines.filter((_, i) => i !== ansIdx);
  }

  const { pre, choices } = extractChoices(lines);
  const body = joinLines(pre);
  const looksMath = /[=+×÷^√π]|\d\s*[x-z]\b|\bf\(x\)|\bsolutions?\b|\bvalue of\b/.test(body) && choices.length < 4 ? true : /[=^√π]|\bf\(x\)|\bvalue of\b/.test(body);
  const kind: SectionKind = kindHint ?? (choices.length === 0 || looksMath ? 'math' : 'rw');
  const { passage, prompt } = splitStem(body, kind);

  const isMcq = choices.length === 4;
  let ans = answer;
  let answers: string[] | undefined;
  if (isMcq) {
    const L = ans.match(/^\(?([A-Da-d])\b/);
    ans = L ? L[1].toUpperCase() : '';
  } else if (ans) {
    answers = ans.split(/\s*(?:,|;|\bor\b)\s*/).map((s) => s.trim()).filter(Boolean);
    ans = answers[0] ?? '';
  }

  const q: Question = {
    id: uid('q_'),
    type: isMcq ? 'mcq' : 'spr',
    passage: passage || undefined,
    prompt: prompt || '(question text missing — edit me)',
    choices: isMcq ? choices.map((c) => ({ id: uid('c_'), text: c })) : [],
    answer: ans,
    answers,
    explanation: explanation || undefined,
    difficulty,
    skill,
  };
  return { q, kind };
}

// ───────── public API ─────────
export function parseText(raw: string, fallbackKind?: SectionKind): ParseResult {
  const warnings: string[] = [];
  const allLines = normalize(raw).split('\n');
  const { body, key } = splitAnswerKey(allLines);
  const { groups } = splitQuestions(body);

  if (!groups.length) {
    return { sections: [], warnings: ['No numbered questions were found. Make sure each question starts with its number (e.g. "1." or "Question 1").'], questionCount: 0, answered: 0, order: [] };
  }

  // parse questions and guess a kind for each group
  const parsed = groups.map((g) => {
    const items = g.qs.map((rq) => parseOne(rq, g.kind ?? fallbackKind));
    const mathVotes = items.filter((i) => i.kind === 'math').length;
    const kind: SectionKind = g.kind ?? fallbackKind ?? (mathVotes > items.length / 2 ? 'math' : 'rw');
    return { kind, moduleNo: g.moduleNo, qs: items.map((i) => i.q) };
  });

  // answer key
  if (key.length) {
    if (key.length === parsed.length) {
      parsed.forEach((g, gi) => g.qs.forEach((q, qi) => applyKey(q, key[gi][qi])));
    } else {
      const flat = key.flat();
      let k = 0;
      parsed.forEach((g) => g.qs.forEach((q) => applyKey(q, flat[k++])));
      if (key.length > 1) warnings.push(`The answer key has ${key.length} parts but ${parsed.length} modules were found — answers were assigned in order. Double-check them.`);
    }
  }

  // group modules into sections
  const sections: Section[] = [];
  for (const g of parsed) {
    let sec = sections.find((s) => s.kind === g.kind);
    if (!sec || (sections[sections.length - 1] !== sec && sec.modules.length >= 2)) {
      sec = { id: uid('s_'), kind: g.kind, modules: [] };
      sections.push(sec);
    }
    const perQ = g.kind === 'rw' ? 32 / 27 : 35 / 22;
    const stage: 1 | 2 = g.moduleNo === 2 || sec.modules.length >= 1 ? 2 : 1;
    const mod: Module = {
      id: uid('m_'),
      stage,
      variant: 'standard',
      minutes: Math.max(1, Math.round(g.qs.length * perQ)),
      questions: g.qs.map((q) => ensureTags(g.kind, q)),
    };
    sec.modules.push(mod);
  }
  for (const s of sections) {
    const m2 = s.modules.filter((m) => m.stage === 2);
    if (m2.length >= 2) {
      m2[0].variant = 'harder';
      m2.slice(1).forEach((m) => (m.variant = 'easier'));
      warnings.push(`${s.kind === 'rw' ? 'Reading and Writing' : 'Math'} has ${m2.length} second modules — set up as adaptive (harder / easier). Change this in the editor if that's wrong.`);
    }
    if (!s.modules.some((m) => m.stage === 1) && s.modules[0]) s.modules[0].stage = 1;
  }

  // warnings
  let count = 0;
  let answered = 0;
  const missing: string[] = [];
  const odd: string[] = [];
  sections.forEach((s) =>
    s.modules.forEach((m, mi) =>
      m.questions.forEach((q, qi) => {
        count++;
        const label = `${s.kind === 'rw' ? 'R&W' : 'Math'} M${m.stage}${s.modules.filter((x) => x.stage === m.stage).length > 1 ? `(${mi + 1})` : ''} Q${qi + 1}`;
        if (q.answer) answered++;
        else missing.push(label);
        if (s.kind === 'rw' && q.type === 'spr') odd.push(label);
      }),
    ),
  );
  if (missing.length) warnings.push(`${missing.length} question${missing.length > 1 ? 's have' : ' has'} no correct answer yet: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}. Use “Answer key” in the editor to fill them in fast.`);
  if (odd.length) warnings.push(`No A–D choices were found for ${odd.slice(0, 8).join(', ')}${odd.length > 8 ? '…' : ''} — check those questions.`);
  return { sections, warnings, questionCount: count, answered, order: parsed.flatMap((g) => g.qs.map((q) => q.id)) };
}

function applyKey(q: Question, v: string | undefined) {
  if (!v) return;
  if (q.type === 'mcq') {
    if (/^[A-Da-d]$/.test(v)) q.answer = v.toUpperCase();
  } else {
    const answers = v.split(/\s*(?:,|\bor\b)\s*/).filter(Boolean);
    q.answer = answers[0];
    q.answers = answers;
  }
}

/** "1 B, 2 C, 3 7/2 …" or one answer per line → answers in order. */
export function parseKeyList(text: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[\s,;])(?:(\d{1,2})(?:\s*[.):\-–]\s*(?=[A-Da-d])|\s*[.):\-–]\s+|\s+))?([A-Da-d]|-?\d*\.?\d+(?:\/\d+)?)(?=$|[\s,;])/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    const n = m[1] ? Number(m[1]) - 1 : i;
    out[n] = m[2];
    i = n + 1;
  }
  return out;
}
