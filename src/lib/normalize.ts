// Make a hand-written / imported JSON test safe to use: fill in ids and sensible defaults.
import type { Module, Question, Section, SectionKind, Test } from './types';
import { uid } from './util';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeTest(raw: any, fallbackTitle = 'Imported test'): Test {
  if (!raw || !Array.isArray(raw.sections)) throw new Error('This file has no "sections" list, so it is not a GuruSat test.');
  const now = Date.now();
  const sections: Section[] = raw.sections.map((s: any, si: number) => {
    const kind: SectionKind = s?.kind === 'math' ? 'math' : s?.kind === 'rw' ? 'rw' : si === 0 ? 'rw' : 'math';
    const mods: any[] = Array.isArray(s?.modules) ? s.modules : [];
    const modules: Module[] = mods.map((m: any, mi: number) => {
      const qs: any[] = Array.isArray(m?.questions) ? m.questions : [];
      const questions: Question[] = qs.map((q: any) => {
        const choices = (Array.isArray(q?.choices) ? q.choices : []).map((c: any) => ({
          id: typeof c?.id === 'string' ? c.id : uid('c_'),
          text: typeof c === 'string' ? c : String(c?.text ?? ''),
        }));
        const type: Question['type'] = q?.type === 'spr' || q?.type === 'mcq' ? q.type : choices.length >= 2 ? 'mcq' : 'spr';
        const answers: string[] | undefined = Array.isArray(q?.answers) ? q.answers.map(String) : undefined;
        return {
          id: typeof q?.id === 'string' ? q.id : uid('q_'),
          type,
          passage: q?.passage ? String(q.passage) : undefined,
          prompt: String(q?.prompt ?? ''),
          image: q?.image ? String(q.image) : undefined,
          imagePlacement: q?.imagePlacement === 'passage' || q?.imagePlacement === 'question' ? q.imagePlacement : undefined,
          choices: type === 'mcq' ? choices : [],
          answer: String(q?.answer ?? answers?.[0] ?? '').trim(),
          answers,
          explanation: q?.explanation ? String(q.explanation) : undefined,
          domain: q?.domain,
          skill: q?.skill,
          difficulty: ['easy', 'medium', 'hard'].includes(q?.difficulty) ? q.difficulty : undefined,
        };
      });
      const stage: 1 | 2 = m?.stage === 2 || (m?.stage !== 1 && mi > 0) ? 2 : 1;
      return {
        id: typeof m?.id === 'string' ? m.id : uid('m_'),
        stage,
        variant: stage === 2 && (m?.variant === 'harder' || m?.variant === 'easier') ? m.variant : 'standard',
        minutes: Number(m?.minutes) > 0 ? Number(m.minutes) : Math.max(1, Math.round(questions.length * (kind === 'rw' ? 32 / 27 : 35 / 22))),
        questions,
      };
    });
    return { id: typeof s?.id === 'string' ? s.id : uid('s_'), kind, modules };
  });
  return {
    id: uid('t_'),
    title: String(raw.title || fallbackTitle),
    description: raw.description ? String(raw.description) : undefined,
    createdAt: now,
    updatedAt: now,
    sections,
    breakMinutes: Number.isFinite(raw.breakMinutes) ? Number(raw.breakMinutes) : 10,
    routingThreshold: Number(raw.routingThreshold) > 0 && Number(raw.routingThreshold) < 1 ? Number(raw.routingThreshold) : 0.6,
    source: 'json',
  };
}
