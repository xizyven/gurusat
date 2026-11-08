// Question-by-question analysis in the same Bluebook layout.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Markup, Spinner } from '../components/ui';
import { rowsFor, TARGET_MS, type Row } from '../lib/analysis';
import { db } from '../lib/db';
import { SECTION_NAME } from '../lib/scoring';
import { answerLabel } from '../lib/spr';
import { navigate, useSettings } from '../lib/store';
import type { Attempt, MistakeNote } from '../lib/types';
import { fmtDuration } from '../lib/util';
import { QuestionView } from '../runner/QuestionView';
import '../styles/runner.css';
import '../styles/results.css';

export const MISTAKE_TAGS = ['Careless', 'Didn’t know the concept', 'Misread the question', 'Ran out of time', 'Guessed', 'Vocabulary', 'Grammar rule', 'Calculation error'];

type Filter = 'all' | 'missed' | 'marked';

export default function Review({ attemptId, questionId }: { attemptId: string; questionId?: string }) {
  const [a, setA] = useState<Attempt | null | undefined>(undefined);
  useEffect(() => {
    db.getAttempt(attemptId).then((x) => setA(x ?? null));
  }, [attemptId]);
  if (a === undefined) return <Spinner />;
  if (!a)
    return (
      <div className="empty">
        <h3>Result not found</h3>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          Home
        </button>
      </div>
    );
  return <ReviewInner a={a} setA={setA} questionId={questionId} />;
}

function ReviewInner({ a, setA, questionId }: { a: Attempt; setA: (a: Attempt) => void; questionId?: string }) {
  const [settings] = useSettings();
  const rows = useMemo(() => rowsFor(a), [a]);
  const [filter, setFilter] = useState<Filter>('all');
  const [split, setSplit] = useState(50);
  const list = rows.filter((r) => (filter === 'all' ? true : filter === 'missed' ? r.status !== 'right' : r.marked));
  const cur = rows.find((r) => r.q.id === questionId) ?? list[0] ?? rows[0];
  const posInList = list.findIndex((r) => r.q.id === cur?.q.id);

  const go = (r?: Row) => r && navigate(`/review/${a.id}/${r.q.id}`, true);
  const prev = () => go(posInList > 0 ? list[posInList - 1] : undefined);
  const next = () => go(posInList >= 0 && posInList < list.length - 1 ? list[posInList + 1] : posInList < 0 ? list[0] : undefined);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (!cur) return null;
  const note: MistakeNote = a.notes?.[cur.q.id] ?? { tags: [], text: '' };
  const saveNote = (n: MistakeNote) => {
    const next = { ...a, notes: { ...(a.notes ?? {}), [cur.q.id]: n } };
    setA(next);
    db.putAttempt(next, true);
  };
  const r = a.responses[cur.q.id];
  const label = `Section ${cur.sectionIndex + 1}, Module ${cur.stage}: ${SECTION_NAME[cur.kind]}`;
  let lastModule = '';

  return (
    <div className="rn" data-theme={settings.classicTheme ? 'classic' : 'guru'}>
      <header className="rn-head">
        <div className="rn-head-left">
          <div className="rn-title">Review · {label}</div>
          <button className="rn-dir-btn" onClick={() => navigate(`/results/${a.id}`)}>
            <Icon name="arrowLeft" size={15} stroke={2.4} /> Back to score report
          </button>
        </div>
        <div className="rn-head-center">
          <div className="seg">
            {(
              [
                ['all', 'All'],
                ['missed', 'Missed'],
                ['marked', 'Marked'],
              ] as [Filter, string][]
            ).map(([f, l]) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {l} {f === 'missed' ? rows.filter((x) => x.status !== 'right').length : f === 'marked' ? rows.filter((x) => x.marked).length : rows.length}
              </button>
            ))}
          </div>
        </div>
        <div className="rn-head-right">
          <button className="rn-tool" onClick={() => navigate('/mistakes')}>
            <Icon name="target" size={22} />
            <span>Mistake Notebook</span>
          </button>
        </div>
      </header>
      <div className="rn-dash" />
      <div className="rv-banner">
        <span className={`rv-chip ${cur.status}`}>
          <Icon name={cur.status === 'right' ? 'check' : cur.status === 'wrong' ? 'x' : 'minus'} size={14} stroke={3} />
          {cur.status === 'right' ? 'Correct' : cur.status === 'wrong' ? 'Incorrect' : 'Omitted'}
        </span>
        <span className="rv-meta">
          Your answer <b>{cur.answer ?? '—'}</b>
        </span>
        <span className="rv-meta">
          Correct <b>{answerLabel(cur.q)}</b>
        </span>
        <span className="rv-meta">
          <Icon name="clock" size={15} /> <b style={{ color: cur.timeMs > TARGET_MS[cur.kind] * 1.5 ? '#b07408' : undefined }}>{fmtDuration(cur.timeMs)}</b>
          <span style={{ fontSize: 12 }}>(target ~{fmtDuration(TARGET_MS[cur.kind])})</span>
        </span>
        {cur.changes > 0 && (
          <span className="rv-meta">
            <Icon name="undo" size={15} /> changed {cur.changes}×{cur.firstAnswer && cur.firstAnswer !== cur.answer ? ` (first picked ${cur.firstAnswer})` : ''}
          </span>
        )}
        {r?.marked && (
          <span className="rv-meta" style={{ color: 'var(--red)' }}>
            <Icon name="bookmark" size={15} fill="currentColor" /> marked
          </span>
        )}
        <span className="spacer" />
        <span className="badge">{cur.skill}</span>
        {cur.q.difficulty && <span className={`badge ${cur.q.difficulty === 'hard' ? 'badge-red' : cur.q.difficulty === 'medium' ? 'badge-amber' : 'badge-green'}`}>{cur.q.difficulty}</span>}
      </div>

      <main className="rn-main">
        <QuestionView
          key={cur.q.id}
          q={cur.q}
          kind={cur.kind}
          number={cur.n}
          response={r}
          highlights={a.highlights[cur.q.id] ?? []}
          review
          split={split}
          onSplit={setSplit}
          footer={
            <>
              <div className="rv-explain">
                <div className="rv-explain-title">
                  <Icon name="lightbulb" size={17} /> Explanation
                </div>
                {cur.q.explanation ? (
                  <Markup src={cur.q.explanation} />
                ) : (
                  <p className="rv-explain-empty">No explanation was included for this question. You can add one in the test editor — or write your own takeaway below.</p>
                )}
              </div>
              <div className="rv-notes">
                <div className="rv-notes-title">
                  <Icon name="note" size={17} /> {cur.status === 'right' ? 'Notes' : 'Why did I miss it?'}
                </div>
                <div className="rv-tags">
                  {MISTAKE_TAGS.map((t) => (
                    <button
                      key={t}
                      className={`rv-tag ${note.tags.includes(t) ? 'on' : ''}`}
                      onClick={() => saveNote({ ...note, tags: note.tags.includes(t) ? note.tags.filter((x) => x !== t) : [...note.tags, t] })}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <textarea
                  placeholder="What will you do differently next time?"
                  value={note.text}
                  onChange={(e) => saveNote({ ...note, text: e.target.value })}
                />
              </div>
            </>
          }
        />
      </main>

      <div className="rn-dash" />
      <footer className="rn-foot" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
        <div className="rv-strip">
          {rows.map((x) => {
            const sep = lastModule && lastModule !== x.moduleId;
            lastModule = x.moduleId;
            const dim = !list.includes(x);
            return (
              <Fragment key={x.q.id}>
                {sep && <span className="sep" />}
                <button
                  className={`${x.status} ${x.q.id === cur.q.id ? 'on' : ''}`}
                  style={{ opacity: dim ? 0.35 : 1 }}
                  onClick={() => go(x)}
                  title={`${x.kind === 'rw' ? 'R&W' : 'Math'} M${x.stage} Q${x.n} — ${x.status === 'right' ? 'correct' : x.status === 'wrong' ? 'incorrect' : 'omitted'}`}
                >
                  {x.n}
                </button>
              </Fragment>
            );
          })}
        </div>
        <div className="rn-foot-right">
          <button className="rn-btn" onClick={prev} disabled={posInList <= 0}>
            Back
          </button>
          <button className="rn-btn" onClick={next} disabled={posInList >= list.length - 1 && posInList >= 0}>
            Next
          </button>
        </div>
      </footer>
    </div>
  );
}
