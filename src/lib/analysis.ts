// Turning an attempt into something you can learn from.
import { takenModules } from './scoring';
import { hasKey, isCorrect } from './spr';
import { classify, DOMAINS } from './taxonomy';
import type { Attempt, Question, SectionKind } from './types';
import { fmtDuration } from './util';

export const TARGET_MS: Record<SectionKind, number> = { rw: 71_000, math: 95_000 };

export type Status = 'right' | 'wrong' | 'omit' | 'nokey';

export interface Row {
  q: Question;
  kind: SectionKind;
  sectionIndex: number;
  stage: 1 | 2;
  moduleId: string;
  /** number within its module */
  n: number;
  /** position across the whole attempt */
  index: number;
  answer?: string;
  status: Status;
  timeMs: number;
  marked: boolean;
  changes: number;
  firstAnswer?: string;
  domain: string;
  skill: string;
  /** flipped from right → wrong / wrong → right */
  flip?: 'toWrong' | 'toRight';
}

export function rowsFor(a: Attempt): Row[] {
  const rows: Row[] = [];
  let index = 0;
  for (const m of takenModules(a)) {
    m.questions.forEach((q, i) => {
      const r = a.responses[q.id];
      const status: Status = !hasKey(q) ? 'nokey' : !r?.answer ? 'omit' : isCorrect(q, r.answer) ? 'right' : 'wrong';
      const tags = q.domain && q.skill ? { domain: q.domain, skill: q.skill } : classify(m.kind, q);
      let flip: Row['flip'];
      if (r?.firstAnswer && r.answer && r.firstAnswer !== r.answer) {
        const firstRight = isCorrect(q, r.firstAnswer);
        if (firstRight && status === 'wrong') flip = 'toWrong';
        if (!firstRight && status === 'right') flip = 'toRight';
      }
      rows.push({
        q,
        kind: m.kind,
        sectionIndex: m.sectionIndex,
        stage: m.stage,
        moduleId: m.moduleId,
        n: i + 1,
        index: index++,
        answer: r?.answer,
        status,
        timeMs: r?.timeMs ?? 0,
        marked: !!r?.marked,
        changes: r?.changes ?? 0,
        firstAnswer: r?.firstAnswer,
        domain: tags.domain,
        skill: tags.skill,
        flip,
      });
    });
  }
  return rows;
}

export interface DomainStat {
  kind: SectionKind;
  domain: string;
  correct: number;
  total: number;
  skills: { skill: string; correct: number; total: number }[];
}

export function domainStats(rows: Row[]): DomainStat[] {
  const out: DomainStat[] = [];
  for (const kind of ['rw', 'math'] as SectionKind[]) {
    const kr = rows.filter((r) => r.kind === kind && r.status !== 'nokey');
    if (!kr.length) continue;
    for (const d of DOMAINS[kind]) {
      const dr = kr.filter((r) => r.domain === d.name);
      const skills = d.skills
        .map((skill) => {
          const sr = dr.filter((r) => r.skill === skill);
          return { skill, correct: sr.filter((r) => r.status === 'right').length, total: sr.length };
        })
        .filter((s) => s.total > 0);
      out.push({ kind, domain: d.name, correct: dr.filter((r) => r.status === 'right').length, total: dr.length, skills });
    }
  }
  return out;
}

export interface Insight {
  tone: 'good' | 'warn' | 'info';
  icon: string;
  title: string;
  body: string;
}

export function insights(_a: Attempt, rows: Row[]): Insight[] {
  const out: Insight[] = [];
  if (!rows.length) return out;
  const wrong = rows.filter((r) => r.status === 'wrong');
  const omit = rows.filter((r) => r.status === 'omit');

  // pacing per module
  const byModule = new Map<string, Row[]>();
  rows.forEach((r) => byModule.set(r.moduleId, [...(byModule.get(r.moduleId) ?? []), r]));
  for (const [, mr] of byModule) {
    const kind = mr[0].kind;
    const half = Math.ceil(mr.length / 2);
    const first = mr.slice(0, half).reduce((s, r) => s + r.timeMs, 0) / half;
    const second = mr.slice(half).reduce((s, r) => s + r.timeMs, 0) / Math.max(1, mr.length - half);
    const label = `${kind === 'rw' ? 'Reading & Writing' : 'Math'} Module ${mr[0].stage}`;
    const lateOmits = mr.slice(half).filter((r) => r.status === 'omit').length;
    if (lateOmits >= 2 && first > TARGET_MS[kind]) {
      out.push({
        tone: 'warn',
        icon: 'timer',
        title: `You ran out of road in ${label}`,
        body: `You averaged ${fmtDuration(first)} on the first half, then left ${lateOmits} questions blank at the end. On the real test, a guess is free — never leave a blank. Try moving on from any question after ~${fmtDuration(TARGET_MS[kind] * 1.6)}.`,
      });
    } else if (second < first * 0.45 && second < TARGET_MS[kind] * 0.5 && mr.length >= 6) {
      out.push({
        tone: 'warn',
        icon: 'timer',
        title: `Rushed finish in ${label}`,
        body: `The second half got ${fmtDuration(second)} per question vs. ${fmtDuration(first)} in the first half. Harder questions often sit later in a module — budget time for them.`,
      });
    }
  }

  const slowWrong = wrong.filter((r) => r.timeMs > TARGET_MS[r.kind] * 2).sort((x, y) => y.timeMs - x.timeMs);
  if (slowWrong.length) {
    const r = slowWrong[0];
    out.push({
      tone: 'warn',
      icon: 'clock',
      title: `${slowWrong.length} time-sink${slowWrong.length > 1 ? 's' : ''}`,
      body: `You spent over twice the target pace on ${slowWrong.length} question${slowWrong.length > 1 ? 's' : ''} and still missed ${slowWrong.length > 1 ? 'them' : 'it'} — the worst was ${fmtDuration(r.timeMs)} on ${r.kind === 'rw' ? 'R&W' : 'Math'} M${r.stage} Q${r.n}. Mark it, guess, and come back.`,
    });
  }

  const toWrong = rows.filter((r) => r.flip === 'toWrong');
  const toRight = rows.filter((r) => r.flip === 'toRight');
  if (toWrong.length || toRight.length) {
    out.push({
      tone: toWrong.length > toRight.length ? 'warn' : 'good',
      icon: 'undo',
      title: 'Changing answers',
      body: `You changed ${toRight.length} answer${toRight.length === 1 ? '' : 's'} from wrong to right and ${toWrong.length} from right to wrong. ${toWrong.length > toRight.length ? 'Your first instinct was better this time — only switch when you find clear evidence.' : 'Your second looks paid off.'}`,
    });
  }

  const markedRight = rows.filter((r) => r.marked && r.status === 'right').length;
  const marked = rows.filter((r) => r.marked).length;
  if (marked >= 2) {
    out.push({
      tone: 'info',
      icon: 'bookmark',
      title: 'Questions you flagged',
      body: `You marked ${marked} for review and got ${markedRight} of them right. ${markedRight / marked >= 0.6 ? 'Your doubts were often unfounded — trust yourself a bit more.' : 'Your gut flags are reliable — these are the skills to drill.'}`,
    });
  }

  const ds = domainStats(rows).filter((d) => d.total >= 2);
  if (ds.length) {
    const sorted = [...ds].sort((x, y) => x.correct / x.total - y.correct / y.total);
    const weak = sorted[0];
    const strong = sorted[sorted.length - 1];
    if (weak.correct / weak.total < 0.75) {
      const worstSkill = [...weak.skills].sort((x, y) => x.correct / x.total - y.correct / y.total)[0];
      out.push({
        tone: 'warn',
        icon: 'target',
        title: `Biggest opportunity: ${weak.domain}`,
        body: `${weak.correct}/${weak.total} correct${worstSkill ? `, with ${worstSkill.skill} the weakest (${worstSkill.correct}/${worstSkill.total})` : ''}. Your Mistake Notebook has these questions ready to retry.`,
      });
    }
    if (strong !== weak && strong.correct / strong.total >= 0.8) {
      out.push({ tone: 'good', icon: 'trophy', title: `Strength: ${strong.domain}`, body: `${strong.correct}/${strong.total} correct. Keep it warm with a few questions a week.` });
    }
  }

  if (omit.length === 0 && wrong.length === 0) {
    out.unshift({ tone: 'good', icon: 'sparkle', title: 'Perfect run', body: 'Every single question correct. Time to try something harder.' });
  }
  return out.slice(0, 6);
}

// ───────── across attempts ─────────
export interface MistakeItem {
  key: string;
  attemptId: string;
  attemptTitle: string;
  date: number;
  row: Row;
  note?: Attempt['notes'][string];
}

/** Latest wrong/omitted result for each question across completed attempts. */
export function collectMistakes(attempts: Attempt[]): MistakeItem[] {
  const seen = new Map<string, MistakeItem>();
  const done = attempts.filter((a) => a.status === 'completed').sort((x, y) => (y.finishedAt ?? 0) - (x.finishedAt ?? 0));
  for (const a of done) {
    for (const row of rowsFor(a)) {
      const key = row.q.id;
      if (seen.has(key)) continue;
      // the newest attempt at this question decides whether it is still a mistake
      seen.set(key, { key, attemptId: a.id, attemptTitle: a.testTitle, date: a.finishedAt ?? a.createdAt, row, note: a.notes?.[row.q.id] });
    }
  }
  return [...seen.values()].filter((m) => m.row.status === 'wrong' || m.row.status === 'omit');
}

export function skillTotals(attempts: Attempt[]) {
  const map = new Map<string, { kind: SectionKind; domain: string; skill: string; correct: number; total: number }>();
  for (const a of attempts.filter((x) => x.status === 'completed')) {
    for (const r of rowsFor(a)) {
      if (r.status === 'nokey') continue;
      const k = `${r.kind}|${r.skill}`;
      const cur = map.get(k) ?? { kind: r.kind, domain: r.domain, skill: r.skill, correct: 0, total: 0 };
      cur.total++;
      if (r.status === 'right') cur.correct++;
      map.set(k, cur);
    }
  }
  return [...map.values()];
}
