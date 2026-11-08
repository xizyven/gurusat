import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { TrendChart } from '../components/Charts';
import { Spinner } from '../components/ui';
import { TIMING_LABEL } from '../lib/attempt';
import { navigate, useAttempts, useSettings } from '../lib/store';
import { fmtDate, fmtDuration } from '../lib/util';
import '../styles/results.css';

export default function Scores() {
  const attempts = useAttempts();
  const [settings] = useSettings();
  const [mode, setMode] = useState<'total' | 'sections'>('total');
  const done = useMemo(() => (attempts ?? []).filter((a) => a.status === 'completed'), [attempts]);
  const full = done.filter((a) => a.kind === 'full' && a.result);
  const points = [...full].reverse().map((a) => ({
    id: a.id,
    date: a.finishedAt ?? a.createdAt,
    title: a.testTitle,
    total: a.result!.total,
    rw: a.result!.sections.find((s) => s.kind === 'rw')?.score,
    math: a.result!.sections.find((s) => s.kind === 'math')?.score,
  }));
  if (!attempts) return <Spinner />;

  return (
    <>
      <div className="ph">
        <div>
          <h1>Scores</h1>
          <p>Every test and practice set you've finished.</p>
        </div>
      </div>
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="card-title">Progress</div>
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
          <p className="muted">Finish a full test to start your progress chart.</p>
        )}
      </div>

      <div className="card rep-table-wrap">
        <table className="rep-table">
          <thead>
            <tr>
              <th>Test</th>
              <th>Date</th>
              <th>Total</th>
              <th>R&amp;W</th>
              <th>Math</th>
              <th className="hide-sm">Correct</th>
              <th className="hide-sm">Time</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {done.map((a) => {
              const rw = a.result?.sections.find((s) => s.kind === 'rw');
              const math = a.result?.sections.find((s) => s.kind === 'math');
              return (
                <tr key={a.id} onClick={() => navigate(`/results/${a.id}`)}>
                  <td>
                    <b>{a.testTitle}</b>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {a.kind === 'practice' ? 'Practice set' : TIMING_LABEL[a.timing]}
                    </div>
                  </td>
                  <td className="muted">{fmtDate(a.finishedAt ?? a.createdAt)}</td>
                  <td className="mono" style={{ fontSize: 16 }}>
                    {a.result?.total ?? '—'}
                  </td>
                  <td className="mono">{a.kind === 'full' ? rw?.score ?? '—' : rw ? `${rw.correct}/${rw.total}` : '—'}</td>
                  <td className="mono">{a.kind === 'full' ? math?.score ?? '—' : math ? `${math.correct}/${math.total}` : '—'}</td>
                  <td className="hide-sm mono">
                    {a.result?.correct}/{a.result?.questionCount}
                  </td>
                  <td className="hide-sm mono">{fmtDuration(a.result?.timeMs ?? 0)}</td>
                  <td>
                    <Icon name="chevronRight" size={16} className="muted" />
                  </td>
                </tr>
              );
            })}
            {!done.length && (
              <tr>
                <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 32 }}>
                  No finished tests yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
