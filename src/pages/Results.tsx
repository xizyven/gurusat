import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { PacingChart, ScaleBar, SegmentBar } from '../components/Charts';
import { confirmDialog, Spinner, toast } from '../components/ui';
import { domainStats, insights, rowsFor, TARGET_MS, type Row } from '../lib/analysis';
import { createAttempt, practiceTest, TIMING_LABEL } from '../lib/attempt';
import { db } from '../lib/db';
import { SECTION_NAME } from '../lib/scoring';
import { answerLabel } from '../lib/spr';
import { findTest, navigate, useSettings } from '../lib/store';
import { DOMAINS } from '../lib/taxonomy';
import type { Attempt, SectionKind } from '../lib/types';
import { fmtDate, fmtDuration } from '../lib/util';
import '../styles/results.css';

type Filter = 'all' | 'wrong' | 'omit' | 'marked' | 'slow';

export default function Results({ attemptId }: { attemptId?: string }) {
  const [a, setA] = useState<Attempt | null | undefined>(undefined);
  useEffect(() => {
    if (attemptId) db.getAttempt(attemptId).then((x) => setA(x ?? null));
  }, [attemptId]);
  if (a === undefined) return <Spinner />;
  if (!a || a.status !== 'completed' || !a.result)
    return (
      <div className="empty">
        <h3>{a ? 'This test is not finished yet' : 'Result not found'}</h3>
        {a ? (
          <button className="btn btn-primary" onClick={() => navigate(`/test/${a.id}`)}>
            Resume test
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Home
          </button>
        )}
      </div>
    );
  return <Report a={a} />;
}

function Report({ a }: { a: Attempt }) {
  const [settings] = useSettings();
  const r = a.result!;
  const rows = useMemo(() => rowsFor(a), [a]);
  const ds = useMemo(() => domainStats(rows), [rows]);
  const tips = useMemo(() => insights(a, rows), [a, rows]);
  const modules = useMemo(() => {
    const map = new Map<string, Row[]>();
    rows.forEach((x) => map.set(x.moduleId, [...(map.get(x.moduleId) ?? []), x]));
    return [...map.values()];
  }, [rows]);
  const [modTab, setModTab] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [openDomain, setOpenDomain] = useState<string | null>(null);

  const changes = rows.reduce((s, x) => s + x.changes, 0);
  const avg = r.questionCount ? r.timeMs / r.questionCount : 0;
  const isFull = a.kind === 'full';

  const filtered = rows.filter((x) =>
    filter === 'all' ? true : filter === 'wrong' ? x.status === 'wrong' : filter === 'omit' ? x.status === 'omit' : filter === 'marked' ? x.marked : x.timeMs > TARGET_MS[x.kind] * 1.5,
  );

  const retake = async () => {
    const t = (await findTest(a.testId)) ?? a.test;
    const na = await createAttempt(t, a.timing === 'untimed' ? settings.defaultTiming : a.timing);
    navigate(`/test/${na.id}`);
  };
  const retryMistakes = async () => {
    const items = rows.filter((x) => x.status === 'wrong' || x.status === 'omit').map((x) => ({ kind: x.kind, q: x.q }));
    if (!items.length) return toast('No mistakes to retry 🎉');
    const t = practiceTest(`Retry: ${a.testTitle}`, items);
    const na = await createAttempt(t, 'untimed', 'practice');
    navigate(`/test/${na.id}`);
  };
  const remove = async () => {
    if (await confirmDialog({ title: 'Delete this result?', body: 'It will disappear from your history and score trend.', ok: 'Delete', danger: true })) {
      await db.deleteAttempt(a.id);
      navigate('/scores');
    }
  };

  const firstWrong = rows.find((x) => x.status !== 'right');

  return (
    <div className="rep">
      <div className="ph">
        <div>
          <a href="#/scores" className="rep-back">
            <Icon name="arrowLeft" size={15} /> Scores
          </a>
          <h1>{a.testTitle}</h1>
          <p>
            {fmtDate(a.finishedAt ?? a.createdAt, true)} · {TIMING_LABEL[a.timing]}
            {a.kind === 'practice' && ' · practice set'}
          </p>
        </div>
        <div className="ph-actions">
          <button className="btn" onClick={retryMistakes}>
            <Icon name="target" size={17} /> Retry mistakes
          </button>
          {isFull && (
            <button className="btn" onClick={retake}>
              <Icon name="refresh" size={17} /> Retake
            </button>
          )}
          <button className="btn btn-primary" onClick={() => navigate(`/review/${a.id}${firstWrong ? '/' + firstWrong.q.id : ''}`)}>
            <Icon name="eye" size={17} /> Review questions
          </button>
        </div>
      </div>

      {/* ───── scores ───── */}
      <section className="rep-scores">
        {r.total !== undefined ? (
          <div className="rep-total">
            <div className="rep-label">Your Total Score</div>
            <div className="rep-total-num">{r.total}</div>
            <div className="rep-range">
              Score range <b>{r.totalLow}–{r.totalHigh}</b>
            </div>
            <ScaleBar score={r.total} low={r.totalLow!} high={r.totalHigh!} min={400} max={1600} />
            <div className="rep-pct">
              <Icon name="trend" size={16} /> About the <b>{ordinal(r.totalPercentile!)}</b> percentile
            </div>
            {settings.targetScore > 0 && (
              <div className="rep-goal">
                {r.total >= settings.targetScore ? (
                  <>
                    <Icon name="trophy" size={16} /> Goal of {settings.targetScore} reached!
                  </>
                ) : (
                  <>
                    <Icon name="target" size={16} /> {settings.targetScore - r.total} points to your goal of {settings.targetScore}
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="rep-total">
            <div className="rep-label">{isFull ? 'Section Score' : 'Practice Accuracy'}</div>
            <div className="rep-total-num">{isFull && r.sections[0] ? r.sections[0].score : `${Math.round((r.correct / Math.max(1, r.questionCount)) * 100)}%`}</div>
            <div className="rep-range">
              {r.correct} of {r.questionCount} correct
            </div>
            {!isFull && <p className="rep-note">Practice sets show accuracy instead of an SAT score.</p>}
          </div>
        )}
        <div className="rep-sections">
          {r.sections.map((s) => (
            <div className="rep-sec" key={s.kind}>
              <div className="rep-sec-top">
                <span className="rep-sec-dot" style={{ background: s.kind === 'rw' ? '#16704a' : '#d99212' }} />
                <span className="rep-label">{SECTION_NAME[s.kind]}</span>
                {s.route !== 'standard' && <span className={`badge ${s.route === 'harder' ? 'badge-green' : 'badge-amber'}`}>{s.route === 'harder' ? 'Harder' : 'Easier'} Module 2</span>}
              </div>
              {isFull ? (
                <>
                  <div className="rep-sec-num">{s.score}</div>
                  <ScaleBar score={s.score} low={s.low} high={s.high} min={200} max={800} />
                  <div className="rep-sec-meta">
                    <span>
                      Range <b>{s.low}–{s.high}</b>
                    </span>
                    <span>
                      <b>{ordinal(s.percentile)}</b> pct.
                    </span>
                    <span>
                      <b>
                        {s.correct}/{s.total}
                      </b>{' '}
                      correct
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="rep-sec-num">{Math.round((s.correct / Math.max(1, s.total)) * 100)}%</div>
                  <div className="rep-sec-meta">
                    <span>
                      <b>
                        {s.correct}/{s.total}
                      </b>{' '}
                      correct
                    </span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </section>
      {isFull && (
        <p className="rep-disclaimer">
          <Icon name="help" size={14} /> Estimated with conversion curves modeled on the official Bluebook practice tests{rows.some((x) => x.q.difficulty) ? ', weighted by question difficulty' : ''}. The real SAT's exact scale varies slightly from test to test.
        </p>
      )}

      {/* ───── quick stats ───── */}
      <div className="rep-stats">
        <Stat icon="check" tone="good" value={r.correct} label="Correct" />
        <Stat icon="x" tone="bad" value={r.incorrect} label="Incorrect" />
        <Stat icon="minus" tone="muted" value={r.omitted} label="Omitted" />
        <Stat icon="clock" value={fmtDuration(r.timeMs)} label="Total time" />
        <Stat icon="timer" value={fmtDuration(avg)} label="Avg. per question" />
        <Stat icon="undo" value={changes} label="Answer changes" />
      </div>

      {(r.unscored ?? 0) > 0 && (
        <p className="rep-disclaimer">
          <Icon name="help" size={14} /> {r.unscored} question{r.unscored === 1 ? ' was' : 's were'} shown but not scored because the file had no highlighted answer for {r.unscored === 1 ? 'it' : 'them'}.
        </p>
      )}

      {/* ───── insights ───── */}
      {tips.length > 0 && (
        <>
          <div className="section-title">
            <h2>What this test says about you</h2>
          </div>
          <div className="rep-insights">
            {tips.map((t) => (
              <div className={`rep-insight ${t.tone}`} key={t.title}>
                <div className="rep-insight-ic">
                  <Icon name={t.icon} size={19} />
                </div>
                <div>
                  <b>{t.title}</b>
                  <p>{t.body}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ───── knowledge & skills ───── */}
      <div className="section-title">
        <h2>Knowledge and Skills</h2>
      </div>
      <div className="rep-ks">
        {(['rw', 'math'] as SectionKind[])
          .filter((k) => ds.some((d) => d.kind === k && d.total > 0))
          .map((k) => (
            <div className="card card-pad" key={k}>
              <div className="rep-ks-title">{SECTION_NAME[k]}</div>
              {ds
                .filter((d) => d.kind === k)
                .map((d) => {
                  const meta = DOMAINS[k].find((x) => x.name === d.domain);
                  const open = openDomain === k + d.domain;
                  return (
                    <div className="rep-domain" key={d.domain}>
                      <button className="rep-domain-head" onClick={() => setOpenDomain(open ? null : k + d.domain)} disabled={!d.total}>
                        <div>
                          <div className="rep-domain-name">{d.domain}</div>
                          <div className="rep-domain-share">{meta?.share} of section · {d.total ? `${d.correct}/${d.total} correct` : 'no questions'}</div>
                        </div>
                        <span className="spacer" />
                        {d.total > 0 ? <SegmentBar pct={d.correct / d.total} /> : <span className="muted" style={{ fontSize: 12 }}>—</span>}
                        {d.total > 0 && <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} className="muted" />}
                      </button>
                      {open && (
                        <div className="rep-skills">
                          {d.skills.map((s) => (
                            <div className="rep-skill" key={s.skill}>
                              <span>{s.skill}</span>
                              <span className="rep-skill-bar">
                                <span style={{ width: `${(s.correct / s.total) * 100}%` }} />
                              </span>
                              <b>
                                {s.correct}/{s.total}
                              </b>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
      </div>

      {/* ───── pacing ───── */}
      <div className="section-title">
        <h2>Pacing</h2>
        <span className="spacer" />
        <div className="seg">
          {modules.map((m, i) => (
            <button key={m[0].moduleId} className={modTab === i ? 'on' : ''} onClick={() => setModTab(i)}>
              {m[0].kind === 'rw' ? 'R&W' : 'Math'} M{m[0].stage}
            </button>
          ))}
        </div>
      </div>
      <div className="card card-pad">
        {modules[modTab] && (
          <>
            <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
              <span className="muted" style={{ fontSize: 13 }}>
                {SECTION_NAME[modules[modTab][0].kind]} · Module {modules[modTab][0].stage} — {fmtDuration(modules[modTab].reduce((s, x) => s + x.timeMs, 0))} on {modules[modTab].length} questions. Click a bar to review that question.
              </span>
            </div>
            <PacingChart
              items={modules[modTab].map((x) => ({ n: x.n, timeMs: x.timeMs, status: x.status, qid: x.q.id }))}
              targetMs={TARGET_MS[modules[modTab][0].kind]}
              onPick={(qid) => navigate(`/review/${a.id}/${qid}`)}
            />
          </>
        )}
      </div>

      {/* ───── question table ───── */}
      <div className="section-title">
        <h2>Every question</h2>
        <span className="spacer" />
        <div className="seg">
          {(
            [
              ['all', `All ${rows.length}`],
              ['wrong', `Incorrect ${rows.filter((x) => x.status === 'wrong').length}`],
              ['omit', `Omitted ${rows.filter((x) => x.status === 'omit').length}`],
              ['marked', `Marked ${rows.filter((x) => x.marked).length}`],
              ['slow', 'Slow'],
            ] as [Filter, string][]
          ).map(([f, l]) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="card rep-table-wrap">
        <table className="rep-table">
          <thead>
            <tr>
              <th>Question</th>
              <th>Result</th>
              <th>Your answer</th>
              <th>Correct</th>
              <th className="hide-sm">Skill</th>
              <th>Time</th>
              <th className="hide-sm" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((x) => (
              <tr key={x.q.id} onClick={() => navigate(`/review/${a.id}/${x.q.id}`)}>
                <td>
                  <span className="rep-qid">
                    {x.kind === 'rw' ? 'R&W' : 'Math'} M{x.stage} · <b>{x.n}</b>
                  </span>
                </td>
                <td>
                  <span className={`rep-res ${x.status === 'nokey' ? 'omit' : x.status}`}>
                    <Icon name={x.status === 'right' ? 'check' : x.status === 'wrong' ? 'x' : 'minus'} size={13} stroke={3} />
                    {x.status === 'right' ? 'Correct' : x.status === 'wrong' ? 'Incorrect' : x.status === 'nokey' ? 'Not scored' : 'Omitted'}
                  </span>
                </td>
                <td className="mono">{x.answer ?? '—'}</td>
                <td className="mono">{answerLabel(x.q)}</td>
                <td className="hide-sm rep-skill-cell">{x.skill}</td>
                <td className={`mono ${x.timeMs > TARGET_MS[x.kind] * 1.5 ? 'slow' : ''}`}>{fmtDuration(x.timeMs)}</td>
                <td className="hide-sm">
                  <span className="row" style={{ gap: 6 }}>
                    {x.marked && <Icon name="bookmark" size={15} fill="currentColor" style={{ color: 'var(--red)' }} title="Marked for review" />}
                    {x.flip === 'toWrong' && <span className="badge badge-red">changed → wrong</span>}
                    {x.flip === 'toRight' && <span className="badge badge-green">changed → right</span>}
                    <Icon name="chevronRight" size={16} className="muted" />
                  </span>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                  Nothing here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ justifyContent: 'center', marginTop: 28 }}>
        <button className="btn btn-ghost btn-danger btn-sm" onClick={remove}>
          <Icon name="trash" size={15} /> Delete this result
        </button>
      </div>
    </div>
  );
}

function Stat({ icon, value, label, tone }: { icon: string; value: string | number; label: string; tone?: 'good' | 'bad' | 'muted' }) {
  return (
    <div className={`rep-stat ${tone ?? ''}`}>
      <span className="rep-stat-ic">
        <Icon name={icon} size={16} stroke={2.4} />
      </span>
      <div>
        <div className="rep-stat-num">{value}</div>
        <div className="rep-stat-label">{label}</div>
      </div>
    </div>
  );
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
