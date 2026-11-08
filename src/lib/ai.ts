// AI mock builder: Claude reads a questions-only test, solves every question and writes explanations.
// Runs entirely in the browser with the student's own Anthropic API key (stored only in this browser).
import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlockParam, BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { cropImage } from './pdf';
import { getSettings } from './store';
import { DOMAINS, domainOfSkill } from './taxonomy';
import type { Difficulty, Module, Question, Section, SectionKind, Test } from './types';
import { uid } from './util';

export const AI_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export type AiEffort = 'medium' | 'high' | 'max';

export function makeClient(apiKey = getSettings().apiKey) {
  if (!apiKey) throw new AiError('missing-key', 'Add your Anthropic API key in Settings first.');
  // The key never leaves this browser except to call Anthropic directly.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 3 });
}

export class AiError extends Error {
  constructor(
    public code: 'missing-key' | 'bad-key' | 'no-credit' | 'rate-limit' | 'overloaded' | 'refusal' | 'too-long' | 'parse' | 'cancelled' | 'other',
    message: string,
  ) {
    super(message);
  }
}

function explain(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new AiError('cancelled', 'Cancelled.');
  if (e instanceof Anthropic.AuthenticationError) return new AiError('bad-key', 'Anthropic rejected the API key. Check it in Settings.');
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError('bad-key', 'This API key is not allowed to use the model. Check your Anthropic Console.');
  if (e instanceof Anthropic.RateLimitError) return new AiError('rate-limit', 'Anthropic says you are sending requests too fast. Wait a minute and try again.');
  if (e instanceof Anthropic.APIError) {
    const msg = e.message || '';
    if (/credit balance|billing|insufficient/i.test(msg)) return new AiError('no-credit', 'Your Anthropic account is out of credit. Add credit at console.anthropic.com → Billing.');
    if (e.status === 529 || /overloaded/i.test(msg)) return new AiError('overloaded', 'Anthropic is busy right now. Try again in a few minutes.');
    if (e.status === 413 || /too large|too long|exceeds/i.test(msg)) return new AiError('too-long', 'The file is too large for one request. Try fewer pages, or screenshots.');
    return new AiError('other', `Anthropic error ${e.status ?? ''}: ${msg}`.trim());
  }
  if (e instanceof Anthropic.APIConnectionError) return new AiError('other', 'Could not reach Anthropic. Check your internet connection.');
  return new AiError('other', (e as Error)?.message || 'Something went wrong.');
}

export async function checkKey(apiKey: string): Promise<void> {
  try {
    await makeClient(apiKey).models.retrieve(AI_MODEL);
  } catch (e) {
    throw explain(e);
  }
}

// ───────────────────────── prompt ─────────────────────────
const ALL_SKILLS = [...DOMAINS.rw, ...DOMAINS.math].flatMap((d) => d.skills);

// Frozen: identical bytes on every request so the document stays cached across the parallel parts.
const SYSTEM = `You are GuruSat's test builder: an expert SAT tutor who turns a teacher's SAT practice-test document into structured data and solves every question.

The document may be a PDF, page images or pasted text. It usually follows the digital SAT layout: a Reading and Writing section (two modules of about 27 questions) and a Math section (two modules of about 22 questions). Headers such as "Module 1", "Module 2", "Section 1", or question numbering that restarts at 1 separate modules. If a section is numbered continuously (for example 1-54) with no module break, its first half is Module 1 and its second half is Module 2. If a section has only one block of questions, that block is Module 1.

Each request names ONE part of the test (for example "Reading and Writing, Module 1"). Return only that part's questions, in order. If the document has no such part, return found=false and an empty list.

Transcribe faithfully:
- passage: the text the question is about (passages, Text 1/Text 2 pairs, a student's notes, tables). For math, any setup text, table or displayed equations that come before the actual question; otherwise "".
- prompt: the question itself, for example "Which choice completes the text with the most logical and precise word or phrase?".
- choices: the four answer choices without their letters, in order A-D. Use [] for student-produced response (grid-in) questions.
- Formatting: math in LaTeX between single dollar signs ($x^2 + 3$, $\\dfrac{3}{4}$); a literal dollar sign is \\$; underlined text is __like this__; a blank is ______; bold is **like this**; italics *like this*; tables as Markdown pipe tables; bulleted notes as lines starting with "- "; "**Text 1**" and "**Text 2**" on their own lines before each text. Separate paragraphs with a blank line.
- Leave out page headers and footers, "Mark for Review", directions pages, answer sheets, and any answer key or explanations printed in the document. Ignore printed answers entirely and solve every question yourself.

Solve every question with care, as if a student's score depends on it, because it does. Check your answer against every choice before committing. For multiple-choice questions, answer is the letter A, B, C or D. For grid-in questions, answer is the simplest exact form, and accepted_answers lists every form the SAT accepts (for example "7/2" and "3.5"; for repeating decimals the truncated and rounded forms such as ".6666", ".6667", "0.666", "0.667"). Grid-in entries are at most 5 characters (6 if negative) and use only digits, ".", "/" and "-".

explanation: written for the student to read after the test, 2-5 sentences: why the correct answer is right (show the key steps for math) and why the most tempting wrong choice fails. For multiple choice, start with "Choice X is correct."

skill: the official digital SAT skill that fits best. difficulty: easy, medium or hard compared with real SAT questions.

figure: if the question depends on a graph, diagram, geometric figure, picture or chart that cannot be written as text or a Markdown table, give its location so the app can crop it: page is the 1-based page (or image) number, and x0, y0, x1, y1 are the box edges as fractions of that page's width and height (0 = left/top, 1 = right/bottom). Draw the box generously around the whole figure and its labels, but not the answer choices. Otherwise figure is null.`;

const QUESTION_PROPS = {
  number: { type: 'integer' },
  type: { type: 'string', enum: ['mcq', 'spr'] },
  passage: { type: 'string' },
  prompt: { type: 'string' },
  choices: { type: 'array', items: { type: 'string' } },
  figure: {
    anyOf: [
      { type: 'null' },
      {
        type: 'object',
        additionalProperties: false,
        required: ['page', 'x0', 'y0', 'x1', 'y1'],
        properties: { page: { type: 'integer' }, x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } },
      },
    ],
  },
  skill: { type: 'string', enum: ALL_SKILLS },
  difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
  explanation: { type: 'string' },
  answer: { type: 'string' },
  accepted_answers: { type: 'array', items: { type: 'string' } },
};

const PART_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'questions'],
  properties: {
    found: { type: 'boolean' },
    questions: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: Object.keys(QUESTION_PROPS), properties: QUESTION_PROPS },
    },
  },
};

interface RawQuestion {
  number: number;
  type: 'mcq' | 'spr';
  passage: string;
  prompt: string;
  choices: string[];
  figure: { page: number; x0: number; y0: number; x1: number; y1: number } | null;
  skill: string;
  difficulty: Difficulty;
  explanation: string;
  answer: string;
  accepted_answers: string[];
}

// ───────────────────────── input ─────────────────────────
export type AiSource =
  | { kind: 'pdf'; name: string; base64: string; pages: string[] }
  | { kind: 'images'; name: string; images: string[] }
  | { kind: 'text'; name: string; text: string };

function dataUrlParts(url: string): { media: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } {
  const m = url.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.*)$/);
  if (!m) throw new AiError('other', 'Unsupported image format. Use PNG or JPG.');
  return { media: m[1] as 'image/png', data: m[2] };
}

function sourceBlocks(src: AiSource): BetaContentBlockParam[] {
  const cache = { type: 'ephemeral' as const, ttl: '1h' as const };
  if (src.kind === 'pdf') {
    return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: src.base64 }, cache_control: cache }];
  }
  if (src.kind === 'text') return [{ type: 'text', text: `<document>\n${src.text}\n</document>`, cache_control: cache }];
  const blocks: BetaContentBlockParam[] = [{ type: 'text', text: `The test is in the following ${src.images.length} images, in order (image 1 is page 1).` }];
  src.images.forEach((img, i) => {
    const { media, data } = dataUrlParts(img);
    blocks.push({ type: 'image', source: { type: 'base64', media_type: media, data }, ...(i === src.images.length - 1 ? { cache_control: cache } : {}) });
  });
  return blocks;
}

// ───────────────────────── build ─────────────────────────
export const PARTS: { kind: SectionKind; stage: 1 | 2; label: string }[] = [
  { kind: 'rw', stage: 1, label: 'Reading and Writing, Module 1' },
  { kind: 'rw', stage: 2, label: 'Reading and Writing, Module 2' },
  { kind: 'math', stage: 1, label: 'Math, Module 1' },
  { kind: 'math', stage: 2, label: 'Math, Module 2' },
];

export type PartStatus = { state: 'waiting' | 'reading' | 'solving' | 'writing' | 'done' | 'empty' | 'error'; count: number; error?: string };

export interface BuildProgress {
  parts: PartStatus[];
  costUsd: number;
}

// Claude Opus 5.5 rates (USD per token); cache writes use the 1-hour TTL (2x input).
const RATE = { input: 4e-6, output: 20e-6, cacheWrite: 8e-6, cacheRead: 0.2e-6 };
function costOf(m: BetaMessage) {
  const u = m.usage;
  return u.input_tokens * RATE.input + u.output_tokens * RATE.output + (u.cache_creation_input_tokens ?? 0) * RATE.cacheWrite + (u.cache_read_input_tokens ?? 0) * RATE.cacheRead;
}

async function runPart(
  client: Anthropic,
  blocks: BetaContentBlockParam[],
  part: (typeof PARTS)[number],
  effort: AiEffort,
  signal: AbortSignal,
  onStatus: (s: Partial<PartStatus>) => void,
  onStarted: () => void,
): Promise<{ questions: RawQuestion[]; cost: number }> {
  const stream = client.beta.messages.stream(
    {
      model: AI_MODEL,
      max_tokens: 128000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort, format: { type: 'json_schema', schema: PART_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: [...blocks, { type: 'text', text: `Part to return: ${part.label}.` }] }],
    },
    { signal },
  );
  let started = false;
  stream.on('streamEvent', (ev) => {
    if (!started) {
      started = true;
      onStarted();
    }
    if (ev.type === 'content_block_start' && ev.content_block.type === 'thinking') onStatus({ state: 'solving' });
  });
  stream.on('text', (_d, snapshot) => {
    const count = (snapshot.match(/"number"\s*:/g) || []).length;
    onStatus({ state: 'writing', count });
  });
  const msg = await stream.finalMessage();
  const cost = costOf(msg);
  if (msg.stop_reason === 'refusal') throw new AiError('refusal', `Claude declined to process ${part.label}.`);
  if (msg.stop_reason === 'max_tokens') throw new AiError('too-long', `${part.label} was too long to finish in one go.`);
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  try {
    const parsed = JSON.parse(text) as { found: boolean; questions: RawQuestion[] };
    return { questions: parsed.found ? parsed.questions ?? [] : [], cost };
  } catch {
    throw new AiError('parse', `Could not read Claude's answer for ${part.label}.`);
  }
}

function cleanSpr(s: string) {
  return s.replace(/\s+/g, '').replace(/^\+/, '');
}

async function toQuestion(r: RawQuestion, kind: SectionKind, pages: string[]): Promise<Question> {
  const isMcq = r.type === 'mcq' && r.choices.length >= 2;
  let image: string | undefined;
  if (r.figure && pages[r.figure.page - 1]) {
    const pad = 0.012;
    const x0 = Math.max(0, Math.min(r.figure.x0, r.figure.x1) - pad);
    const y0 = Math.max(0, Math.min(r.figure.y0, r.figure.y1) - pad);
    const x1 = Math.min(1, Math.max(r.figure.x0, r.figure.x1) + pad);
    const y1 = Math.min(1, Math.max(r.figure.y0, r.figure.y1) + pad);
    if (x1 - x0 > 0.02 && y1 - y0 > 0.02) {
      try {
        image = await cropImage(pages[r.figure.page - 1], { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      } catch {
        image = undefined;
      }
    }
  }
  const sprAnswers = isMcq ? undefined : [...new Set([r.answer, ...(r.accepted_answers ?? [])].map(cleanSpr).filter((a) => /^-?[\d./]+$/.test(a)))];
  return {
    id: uid('q_'),
    type: isMcq ? 'mcq' : 'spr',
    passage: r.passage?.trim() || undefined,
    prompt: r.prompt?.trim() || '',
    image,
    imagePlacement: image ? (kind === 'rw' ? 'passage' : 'question') : undefined,
    choices: isMcq ? r.choices.map((c) => ({ id: uid('c_'), text: c.trim() })) : [],
    answer: isMcq ? (r.answer.trim().match(/[A-F]/i)?.[0] ?? '').toUpperCase() : sprAnswers?.[0] ?? r.answer.trim(),
    answers: sprAnswers,
    explanation: r.explanation?.trim() || undefined,
    skill: r.skill,
    domain: domainOfSkill(kind, r.skill),
    difficulty: r.difficulty,
  };
}

/** Read, solve and explain a whole mock. Never shows the questions to the student. */
export async function buildMock(
  src: AiSource,
  opts: { title: string; effort: AiEffort; signal: AbortSignal; onProgress: (p: BuildProgress) => void },
): Promise<Test> {
  const client = makeClient();
  const blocks = sourceBlocks(src);
  const pages = src.kind === 'pdf' ? src.pages : src.kind === 'images' ? src.images : [];
  const status: PartStatus[] = PARTS.map(() => ({ state: 'waiting', count: 0 }));
  let cost = 0;
  const emit = () => opts.onProgress({ parts: status.map((s) => ({ ...s })), costUsd: cost });
  emit();

  // The first part writes the document to the cache; the rest start once it is being processed so they read it cheaply.
  let releaseOthers!: () => void;
  const firstStarted = new Promise<void>((res) => {
    releaseOthers = res;
    setTimeout(res, 25_000);
  });

  const results = await Promise.allSettled(
    PARTS.map(async (part, i) => {
      if (i > 0) await firstStarted;
      if (opts.signal.aborted) throw new AiError('cancelled', 'Cancelled.');
      status[i] = { state: 'reading', count: 0 };
      emit();
      try {
        const r = await runPart(
          client,
          blocks,
          part,
          opts.effort,
          opts.signal,
          (s) => {
            status[i] = { ...status[i], ...s };
            emit();
          },
          () => i === 0 && releaseOthers(),
        );
        cost += r.cost;
        status[i] = { state: r.questions.length ? 'done' : 'empty', count: r.questions.length };
        emit();
        return r.questions;
      } catch (e) {
        if (i === 0) releaseOthers();
        const err = explain(e);
        status[i] = { state: 'error', count: 0, error: err.message };
        emit();
        throw err;
      }
    }),
  );

  if (opts.signal.aborted) throw new AiError('cancelled', 'Cancelled.');
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failures.length) {
    const first = failures[0].reason as AiError;
    // a key/credit problem affects every part, so report it once
    throw first;
  }

  const sections: Section[] = [];
  for (const kind of ['rw', 'math'] as SectionKind[]) {
    const modules: Module[] = [];
    for (let i = 0; i < PARTS.length; i++) {
      if (PARTS[i].kind !== kind) continue;
      const raw = (results[i] as PromiseFulfilledResult<RawQuestion[]>).value;
      if (!raw.length) continue;
      const questions = await Promise.all(raw.map((r) => toQuestion(r, kind, pages)));
      const perQ = kind === 'rw' ? 32 / 27 : 35 / 22;
      modules.push({ id: uid('m_'), stage: modules.length ? 2 : 1, variant: 'standard', minutes: Math.max(1, Math.round(questions.length * perQ)), questions });
    }
    if (modules.length) sections.push({ id: uid('s_'), kind, modules });
  }
  if (!sections.length) throw new AiError('parse', 'No SAT questions were found in this file.');

  const now = Date.now();
  return {
    id: uid('t_'),
    title: opts.title.trim() || src.name || 'AI mock test',
    description: `Built by AI from ${src.name || 'your file'}`,
    createdAt: now,
    updatedAt: now,
    sections,
    breakMinutes: sections.length > 1 ? 10 : 0,
    routingThreshold: 0.6,
    source: 'ai',
    sealed: true,
    aiCostUsd: Math.round(cost * 100) / 100,
  };
}

// ───────────────────────── re-check one answer ─────────────────────────
const RECHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['explanation', 'answer', 'accepted_answers'],
  properties: {
    explanation: { type: 'string' },
    answer: { type: 'string' },
    accepted_answers: { type: 'array', items: { type: 'string' } },
  },
};

export interface Recheck {
  answer: string;
  answers?: string[];
  explanation: string;
  costUsd: number;
}

/** Solve one question again from scratch, without telling Claude the current key (no anchoring). */
export async function recheckQuestion(q: Question, kind: SectionKind, signal?: AbortSignal): Promise<Recheck> {
  const client = makeClient();
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const lines = [
    `Section: ${kind === 'rw' ? 'Reading and Writing' : 'Math'}`,
    q.passage ? `Passage:\n${q.passage}` : '',
    `Question:\n${q.prompt || '(see image)'}`,
    q.type === 'mcq' ? `Choices:\n${q.choices.map((c, i) => `${letters[i]}) ${c.text || '(see image)'}`).join('\n')}` : 'This is a student-produced response (grid-in) question.',
  ].filter(Boolean);
  const content: BetaContentBlockParam[] = [];
  if (q.image?.startsWith('data:image/')) {
    const { media, data } = dataUrlParts(q.image);
    content.push({ type: 'image', source: { type: 'base64', media_type: media, data } });
  }
  content.push({
    type: 'text',
    text: `${lines.join('\n\n')}\n\nSolve this SAT question independently and carefully. Return the answer (a letter for multiple choice; for grid-in the simplest exact form plus every accepted form in accepted_answers) and a 2-5 sentence explanation for the student.`,
  });
  try {
    const stream = client.beta.messages.stream(
      {
        model: AI_MODEL,
        max_tokens: 32000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'max', format: { type: 'json_schema', schema: RECHECK_SCHEMA } },
        system: 'You are an expert SAT tutor. Math uses LaTeX between single dollar signs; a literal dollar sign is \\$.',
        messages: [{ role: 'user', content }],
      },
      { signal },
    );
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new AiError('refusal', 'Claude declined to re-check this question.');
    const r = JSON.parse(msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')) as { explanation: string; answer: string; accepted_answers: string[] };
    const isMcq = q.type === 'mcq';
    const answers = isMcq ? undefined : [...new Set([r.answer, ...r.accepted_answers].map(cleanSpr).filter((a) => /^-?[\d./]+$/.test(a)))];
    return {
      answer: isMcq ? (r.answer.match(/[A-F]/i)?.[0] ?? '').toUpperCase() : answers?.[0] ?? r.answer,
      answers,
      explanation: r.explanation,
      costUsd: Math.round(costOf(msg) * 100) / 100,
    };
  } catch (e) {
    throw explain(e);
  }
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}
