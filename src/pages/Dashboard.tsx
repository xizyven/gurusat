import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { ScoreRing, TrendChart } from '../components/Charts';
import { Spinner } from '../components/ui';
import { skillTotals } from '../lib/analysis';
import { createAttempt } from '../lib/attempt';
import { navigate, useAttempts, useSettings, useTests } from '../lib/store';
import { daysUntil, fmtDate, fmtDuration, greeting } from '../lib/util';

const BASE = import.meta.env.BASE_URL;

export function Dashboard() {
  const attempts = useAttempts();
  const tests = useTests();
  const [settings] = useSettings();
  const [mode, setMode] = useState<'total' | 'sections'>('total');

  const done = useMemo(() => (attempts ?? []).filter((a) => a.status === 'completed' && a.kind === 'full'), [attempts]);
  const active = useMemo(() => (attempts ?? []).filter((a) => a.status === 'active'), [attempts]);
  const scored = done.filter((a) => a.result?.total);
  const latest = scored[0];
  const prev = scored[1];
  const best = scored.reduce((m, a) => Math.max(m, a.result?.total ?? 0), 0);
  const days = daysUntil(settings.testDate);
  const totalQs = (attempts ?? []).filter((a) => a.status === 'completed').reduce((s, a) => s + (a.result?.questionCount ?? 0), 0);
  const totalTime = (attempts ?? []).filter((a) => a.status === 'completed').reduce((s, a) => s + (a.result?.timeMs ?? 0), 0);

  const points = useMemo(
    () =>
      [...done]
        .reverse()
        .filter((a) => a.result)
        .map((a) => ({
          id: a.id,
          date: a.finishedAt ?? a.createdAt,
          title: a.testTitle,
          total: a.result!.total,
          rw: a.result!.sections.find((s) => s.kind === 'rw')?.score,
          math: a.result!.sections.find((s) => s.kind === 'math')?.score,
        })),
    [done],
  );

  const focus = useMemo(() => {
    const all = skillTotals(attempts ?? []).filter((s) => s.correct < s.total);
    return all.sort((a, b) => a.correct / a.total - b.correct / b.total || b.total - a.total).slice(0, 5);
  }, [attempts]);

  if (!attempts || !tests) return <Spinner />;

  const firstTest = tests.find((t) => !t.builtIn) ?? tests[0];
  const startFirst = async () => {
    if (!firstTest) return navigate('/import');
    const a = await createAttempt(firstTest, settings.defaultTiming);
    navigate(`/test/${a.id}`);
  };
  const delta = latest && prev ? latest.result!.total! - prev.result!.total! : null;

  return (
    <>
      <section className="hero">
        <img className="hero-mark" src={`${BASE}brand/mark.png`} alt="" />
        <div>
          <div className="hero-hello">
            {greeting()}
            {settings.name ? `, ${settings.name.split(' ')[0]}` : ''} 👋
          </div>
          <h1>{latest ? (delta !== null && delta > 0 ? `Up ${delta} points. Keep climbing.` : 'Every test makes you sharper.') : 'Your practice room is ready.'}</h1>
          <p>
            {days !== null && days >= 0
              ? `${days} day${days === 1 ? '' : 's'} until test day. ${days > 14 ? 'Plenty of time for a few full mock tests.' : 'Final stretch — focus on timing and your mistake notebook.'}`
              : 'Upload your teacher’s mock test and take it in a Bluebook-style interface, with a realistic score at the end.'}
          </p>
          <div className="hero-actions">
            <button className="btn btn-white btn-lg" onClick={startFirst}>
              <Icon name="play" size={16} fill="currentColor" /> {firstTest ? 'Start a test' : 'Add your first test'}
            </button>
            <button className="btn btn-glass btn-lg" onClick={() => navigate('/import')}>
              <Icon name="upload" size={18} /> Add a test
            </button>
          </div>
        </div>
        <div className="hero-score">
          <ScoreRing value={latest?.result?.total} label={latest ? 'Latest score' : 'No score yet'} target={settings.targetScore} />
          <div className="hero-score-meta">
            <div className="hero-stat">
              <b>{best || '—'}</b>Best score
            </div>
            <div className="hero-stat">
              <b>{settings.targetScore}</b>Goal
            </div>
            <div className="hero-stat">
              <b>{latest ? Math.max(0, settings.targetScore - latest.result!.total!) || '✓' : '—'}</b>
              {latest && latest.result!.total! >= settings.targetScore ? 'Goal reached!' : 'Points to goal'}
            </div>
          </div>
        </div>
      </section>

      {active.map((a) => (
        <div className="resume" key={a.id}>
          <div className="resume-ic">
            <Icon name="timer" size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>Unfinished: {a.testTitle}</b>
            <span>
              Started {fmtDate(a.createdAt, true)} · {a.phase === 'intro' ? 'not started yet' : `Section ${a.stages[a.stageIndex]?.sectionIndex + 1}, Module ${a.stages[a.stageIndex]?.stage}`}
            </span>
          </div>
          <button className="btn btn-primary" onClick={() => navigate(`/test/${a.id}`)}>
            Resume
          </button>
        </div>
      ))}

      <div className="stat-grid">
        <div className="card stat">
          <div className="stat-ic">
            <Icon name="layers" size={19} />
          </div>
          <div className="stat-num">{done.length}</div>
          <div className="stat-label">Tests completed</div>
        </div>
        <div className="card stat">
          <div className="stat-ic">
            <Icon name="check" size={19} />
          </div>
          <div className="stat-num">{totalQs}</div>
          <div className="stat-label">Questions answered</div>
        </div>
        <div className="card stat">
          <div className="stat-ic">
            <Icon name="clock" size={19} />
          </div>
          <div className="stat-num">{totalTime ? fmtDuration(totalTime) : '0m'}</div>
          <div className="stat-label">Time practicing</div>
        </div>
        <div className="card stat">
          <div className="stat-ic">
            <Icon name="library" size={19} />
          </div>
          <div className="stat-num">{tests.length}</div>
          <div className="stat-label">Tests in library</div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="card card-pad">
          <div className="row" style={{ marginBottom: 14 }}>
            <div>
              <div className="card-title">Score trend</div>
              <div className="card-sub">Estimated SAT score after each full test</div>
            </div>
            <span className="spacer" />
            <div className="seg">
              <button className={mode === 'total' ? 'on' : ''} onClick={() => setMode('total')}>
                Total
              </button>
              <button className={mode === 'sections' ? 'on' : ''} onClick={() => setMode('sections')}>
                Sections
              </button>
            </div>
          </div>
          {points.length ? (
            <TrendChart points={points} mode={mode} target={settings.targetScore} />
          ) : (
            <div className="empty" style={{ padding: '36px 10px' }}>
              <div className="empty-ic">
                <Icon name="trend" size={26} />
              </div>
              <h3>Your score line starts here</h3>
              <p>Finish a full test to see your first data point.</p>
            </div>
          )}
        </div>
        <div className="card card-pad">
          <div className="card-title">Focus areas</div>
          <div className="card-sub" style={{ marginBottom: 16 }}>
            Your weakest skills across all tests
          </div>
          {focus.length ? (
            <div className="focus-list">
              {focus.map((f) => {
                const pct = Math.round((f.correct / f.total) * 100);
                return (
                  <div className="focus-row" key={f.kind + f.skill}>
                    <span className="focus-name">
                      {f.skill} <span className="badge" style={{ marginLeft: 4 }}>{f.kind === 'rw' ? 'R&W' : 'Math'}</span>
                    </span>
                    <span className="focus-pct">
                      {f.correct}/{f.total}
                    </span>
                    <div className="focus-bar">
                      <span style={{ width: `${Math.max(pct, 3)}%`, background: pct < 50 ? '#cf3d3d' : pct < 75 ? '#d99212' : '#1d8a4b' }} />
                    </div>
                  </div>
                );
              })}
              <button className="btn btn-sm" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => navigate('/mistakes')}>
                <Icon name="target" size={15} /> Practice my mistakes
              </button>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 14 }}>
              {done.length
                ? 'No weak spots so far — every skill you’ve been tested on is at 100%. 🎯'
                : 'After your first test, GuruSat tags every question by SAT skill and shows where you lose points.'}
            </p>
          )}
        </div>
      </div>

      <div className="section-title">
        <h2>Recent results</h2>
        <span className="spacer" />
        {done.length > 0 && (
          <a className="btn btn-sm btn-ghost" href="#/scores">
            See all <Icon name="arrowRight" size={15} />
          </a>
        )}
      </div>
      <div className="card card-pad" style={{ paddingTop: 8, paddingBottom: 8 }}>
        {(attempts ?? []).filter((a) => a.status === 'completed').length ? (
          <div className="attempt-list">
            {(attempts ?? [])
              .filter((a) => a.status === 'completed')
              .slice(0, 5)
              .map((a) => (
                <a className="attempt-row" key={a.id} href={`#/results/${a.id}`}>
                  <div className="attempt-ic">
                    <Icon name={a.kind === 'practice' ? 'target' : 'file'} size={19} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="attempt-title">{a.testTitle}</div>
                    <div className="attempt-meta">
                      {fmtDate(a.finishedAt ?? a.createdAt, true)} · {a.result?.correct}/{a.result?.questionCount} correct
                    </div>
                  </div>
                  <div className="attempt-score">
                    {a.result?.total ?? a.result?.sections[0]?.score ?? '—'}
                    <small>{a.result?.total ? 'total' : a.kind === 'practice' ? `${Math.round(((a.result?.correct ?? 0) / Math.max(1, a.result?.questionCount ?? 1)) * 100)}% correct` : a.result?.sections[0] ? (a.result.sections[0].kind === 'rw' ? 'R&W' : 'Math') : ''}</small>
                  </div>
                  <Icon name="chevronRight" size={18} className="muted" />
                </a>
              ))}
          </div>
        ) : (
          <div className="empty" style={{ padding: '28px 10px' }}>
            <p>No results yet — your completed tests will show up here.</p>
          </div>
        )}
      </div>
    </>
  );
}
