import { db } from './db';
import type { Attempt, Module, Question, Response, SectionKind, Stage, Test, TimingMode } from './types';
import { uid } from './util';

export const TIMING_LABEL: Record<TimingMode, string> = {
  standard: 'Standard time',
  'x1.5': 'Time and a half (1.5×)',
  x2: 'Double time (2×)',
  untimed: 'Untimed practice',
};

export function timeMultiplier(t: TimingMode) {
  return t === 'x1.5' ? 1.5 : t === 'x2' ? 2 : 1;
}

export function moduleMs(mod: Module, timing: TimingMode) {
  return timing === 'untimed' ? 0 : Math.round(mod.minutes * 60_000 * timeMultiplier(timing));
}

export function buildStages(test: Test): Stage[] {
  const stages: Stage[] = [];
  test.sections.forEach((sec, sectionIndex) => {
    const m1 = sec.modules.find((m) => m.stage === 1);
    const m2s = sec.modules.filter((m) => m.stage === 2);
    if (m1) stages.push({ sectionId: sec.id, kind: sec.kind, sectionIndex, stage: 1, moduleId: m1.id });
    if (m2s.length) {
      stages.push({
        sectionId: sec.id,
        kind: sec.kind,
        sectionIndex,
        stage: 2,
        // with one module 2 we know it already; adaptive tests decide after module 1
        moduleId: m2s.length === 1 ? m2s[0].id : undefined,
      });
    }
  });
  return stages;
}

export function emptyResponse(): Response {
  return { changes: 0, marked: false, crossed: [], timeMs: 0, visits: 0 };
}

export async function createAttempt(test: Test, timing: TimingMode, kind: Attempt['kind'] = 'full'): Promise<Attempt> {
  const stages = buildStages(test);
  const first = test.sections[stages[0]?.sectionIndex ?? 0]?.modules.find((m) => m.id === stages[0]?.moduleId);
  const a: Attempt = {
    id: uid('a_'),
    testId: test.id,
    testTitle: test.title,
    test: JSON.parse(JSON.stringify(test)),
    kind,
    timing,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'active',
    stages,
    stageIndex: 0,
    phase: 'intro',
    qIndex: 0,
    remainingMs: first ? moduleMs(first, timing) : 0,
    responses: {},
    highlights: {},
    notes: {},
  };
  await db.putAttempt(a);
  return a;
}

/** Build a practice set out of chosen questions (e.g. your mistakes). */
export function practiceTest(title: string, items: { kind: SectionKind; q: Question }[]): Test {
  const now = Date.now();
  const kinds: SectionKind[] = ['rw', 'math'];
  const sections = kinds
    .map((kind) => {
      const qs = items.filter((i) => i.kind === kind).map((i) => ({ ...i.q }));
      if (!qs.length) return null;
      const perQ = kind === 'rw' ? 71 : 95;
      return {
        id: uid('s_'),
        kind,
        modules: [{ id: uid('m_'), stage: 1 as const, variant: 'standard' as const, minutes: Math.ceil((qs.length * perQ) / 60), questions: qs }],
      };
    })
    .filter(Boolean) as Test['sections'];
  return {
    id: uid('practice_'),
    title,
    createdAt: now,
    updatedAt: now,
    sections,
    breakMinutes: 0,
    routingThreshold: 0.6,
    source: 'practice',
  };
}

export function testStats(t: Test) {
  let questions = 0;
  let minutes = 0;
  const parts: string[] = [];
  for (const s of t.sections) {
    const m1 = s.modules.find((m) => m.stage === 1);
    const m2 = s.modules.find((m) => m.stage === 2 && m.variant !== 'easier') ?? s.modules.find((m) => m.stage === 2);
    const n = (m1?.questions.length ?? 0) + (m2?.questions.length ?? 0);
    questions += n;
    minutes += (m1?.minutes ?? 0) + (m2?.minutes ?? 0);
    parts.push(`${s.kind === 'rw' ? 'Reading & Writing' : 'Math'} · ${n}`);
  }
  const adaptive = t.sections.some((s) => s.modules.filter((m) => m.stage === 2).length > 1);
  return { questions, minutes, parts, adaptive };
}
