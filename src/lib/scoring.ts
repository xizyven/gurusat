// Realistic digital-SAT score estimates.
//
// The real SAT uses item response theory, so the exact conversion changes from form to form.
// These curves are modeled on the raw→scaled tables published with the official Bluebook
// practice tests (54 RW questions, 44 Math questions). Raw scores from tests of any length are
// rescaled to that size first. Hard questions count a little more when difficulty is tagged,
// and taking the easier adaptive Module 2 caps the score, just like the real test.
import type { Attempt, AttemptResult, ModuleVariant, Question, SectionKind, SectionScore, Test } from './types';
import { isCorrect } from './spr';

// [raw out of 54, scaled]
const RW_CURVE: [number, number][] = [
  [0, 200], [2, 210], [4, 240], [6, 270], [8, 300], [10, 320], [12, 350], [14, 370], [16, 390],
  [18, 410], [20, 430], [22, 450], [24, 470], [26, 490], [28, 510], [30, 530], [32, 550], [34, 570],
  [36, 590], [38, 610], [40, 630], [42, 650], [44, 670], [46, 690], [48, 710], [50, 740], [52, 770],
  [53, 790], [54, 800],
];

// [raw out of 44, scaled]
const MATH_CURVE: [number, number][] = [
  [0, 200], [1, 220], [2, 250], [3, 280], [4, 300], [5, 320], [6, 340], [7, 360], [8, 380], [9, 390],
  [10, 410], [11, 420], [12, 430], [13, 450], [14, 460], [15, 470], [16, 480], [17, 490], [18, 500],
  [19, 510], [20, 520], [21, 530], [22, 540], [23, 550], [24, 560], [25, 570], [26, 580], [27, 590],
  [28, 600], [29, 610], [30, 620], [31, 630], [32, 640], [33, 650], [34, 660], [35, 670], [36, 680],
  [37, 700], [38, 710], [39, 720], [40, 740], [41, 750], [42, 770], [43, 780], [44, 800],
];

function interp(curve: [number, number][], x: number): number {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    const [x0, y0] = curve[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return curve[curve.length - 1][1];
}

const round10 = (n: number) => Math.round(n / 10) * 10;
const clampScore = (n: number) => Math.max(200, Math.min(800, n));

const WEIGHT = { easy: 0.85, medium: 1, hard: 1.2 } as const;

export function scaleSection(kind: SectionKind, questions: Question[], correctIds: Set<string>, route: ModuleVariant) {
  const tagged = questions.some((q) => q.difficulty);
  let earned = 0;
  let possible = 0;
  for (const q of questions) {
    const w = tagged ? WEIGHT[q.difficulty ?? 'medium'] : 1;
    possible += w;
    if (correctIds.has(q.id)) earned += w;
  }
  const pct = possible ? earned / possible : 0;
  const curve = kind === 'rw' ? RW_CURVE : MATH_CURVE;
  const size = kind === 'rw' ? 54 : 44;
  let scaled = interp(curve, pct * size);
  // Easier Module 2 → the top of the scale isn't reachable (roughly mid-600s max).
  if (route === 'easier') scaled = 200 + (scaled - 200) * 0.78;
  const score = clampScore(round10(scaled));
  // Short tests give a wider range of likely scores.
  const spread = round10(Math.max(20, Math.min(70, 30 * Math.sqrt(27 / Math.max(questions.length, 4)))));
  return {
    score,
    low: clampScore(score - spread),
    high: clampScore(score + spread),
  };
}

// Approximate nationally representative percentiles.
const TOTAL_PCT: [number, number][] = [
  [400, 1], [600, 1], [700, 2], [750, 5], [800, 10], [850, 16], [900, 23], [950, 32], [1000, 41],
  [1050, 50], [1100, 59], [1150, 68], [1200, 75], [1250, 82], [1300, 87], [1350, 91], [1400, 94],
  [1450, 97], [1500, 98], [1550, 99], [1600, 99],
];
const RW_PCT: [number, number][] = [
  [200, 1], [250, 1], [300, 3], [350, 11], [400, 24], [450, 38], [500, 54], [550, 68], [600, 80],
  [650, 89], [700, 95], [750, 98], [800, 99],
];
const MATH_PCT: [number, number][] = [
  [200, 1], [250, 1], [300, 4], [350, 11], [400, 22], [450, 36], [500, 50], [550, 64], [600, 76],
  [650, 85], [700, 92], [750, 96], [800, 99],
];

export function percentile(score: number, kind: SectionKind | 'total') {
  const table = kind === 'total' ? TOTAL_PCT : kind === 'rw' ? RW_PCT : MATH_PCT;
  return Math.max(1, Math.min(99, Math.round(interp(table, score))));
}

/** Questions actually taken in this attempt, in order, grouped by module. */
export function takenModules(a: Attempt) {
  const out: { sectionIndex: number; kind: SectionKind; stage: 1 | 2; moduleId: string; variant: ModuleVariant; questions: Question[]; minutes: number }[] = [];
  for (const st of a.stages) {
    if (!st.moduleId) continue;
    const sec = a.test.sections[st.sectionIndex];
    const mod = sec?.modules.find((m) => m.id === st.moduleId);
    if (!mod) continue;
    out.push({ sectionIndex: st.sectionIndex, kind: sec.kind, stage: st.stage, moduleId: mod.id, variant: mod.variant, questions: mod.questions, minutes: mod.minutes });
  }
  return out;
}

export function computeResult(a: Attempt): AttemptResult {
  const mods = takenModules(a);
  const sections: SectionScore[] = [];
  let correct = 0, incorrect = 0, omitted = 0, count = 0, timeMs = 0;
  const bySection = new Map<number, typeof mods>();
  for (const m of mods) {
    if (!bySection.has(m.sectionIndex)) bySection.set(m.sectionIndex, []);
    bySection.get(m.sectionIndex)!.push(m);
  }
  for (const [, list] of bySection) {
    const kind = list[0].kind;
    const qs = list.flatMap((m) => m.questions);
    const right = new Set<string>();
    for (const q of qs) {
      const r = a.responses[q.id];
      count++;
      timeMs += r?.timeMs ?? 0;
      if (!r?.answer) omitted++;
      else if (isCorrect(q, r.answer)) { correct++; right.add(q.id); }
      else incorrect++;
    }
    const route = list.find((m) => m.stage === 2)?.variant ?? 'standard';
    const s = scaleSection(kind, qs, right, route);
    sections.push({ kind, ...s, correct: right.size, total: qs.length, percentile: percentile(s.score, kind), route });
  }
  const res: AttemptResult = { sections, correct, incorrect, omitted, questionCount: count, timeMs };
  const rw = sections.find((s) => s.kind === 'rw');
  const math = sections.find((s) => s.kind === 'math');
  if (rw && math && a.kind === 'full') {
    res.total = rw.score + math.score;
    const spread = Math.round(Math.sqrt((rw.high - rw.score) ** 2 + (math.high - math.score) ** 2) / 10) * 10;
    res.totalLow = Math.max(400, res.total - spread);
    res.totalHigh = Math.min(1600, res.total + spread);
    res.totalPercentile = percentile(res.total, 'total');
  }
  return res;
}

/** Module-1 accuracy decides which module 2 you get on adaptive tests. */
export function routeModule2(test: Test, sectionIndex: number, a: Attempt): string | undefined {
  const sec = test.sections[sectionIndex];
  const m2s = sec.modules.filter((m) => m.stage === 2);
  if (!m2s.length) return undefined;
  if (m2s.length === 1) return m2s[0].id;
  const m1 = sec.modules.find((m) => m.stage === 1);
  const qs = m1?.questions ?? [];
  const right = qs.filter((q) => isCorrect(q, a.responses[q.id]?.answer)).length;
  const acc = qs.length ? right / qs.length : 0;
  const harder = m2s.find((m) => m.variant === 'harder') ?? m2s[0];
  const easier = m2s.find((m) => m.variant === 'easier') ?? m2s[m2s.length - 1];
  return acc >= (test.routingThreshold ?? 0.6) ? harder.id : easier.id;
}

export const SECTION_NAME: Record<SectionKind, string> = {
  rw: 'Reading and Writing',
  math: 'Math',
};
