// Question-by-question analysis in the same Bluebook layout.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Markup, Modal, Spinner, toast } from '../components/ui';
import { recheckQuestion, type AiError, type Recheck } from '../lib/ai';
import { rowsFor, TARGET_MS, type Row } from '../lib/analysis';
import { db } from '../lib/db';
import { computeResult, SECTION_NAME } from '../lib/scoring';
import { answerLabel, isCorrect } from '../lib/spr';
import { navigate, useSettings } from '../lib/store';
import type { Attempt, MistakeNote, Question, Test } from '../lib/types';
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
  const [recheck, setRecheck] = useState(false);
  const list = rows.filter((r) => (filter === 'all' ? true : filter === 'missed' ? r.status === 'wrong' || r.status === 'omit' : r.marked));
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
        <span className={`rv-chip ${cur.status === 'nokey' ? 'omit' : cur.status}`}>
          <Icon name={cur.status === 'right' ? 'check' : cur.status === 'wrong' ? 'x' : 'minus'} size={14} stroke={3} />
          {cur.status === 'right' ? 'Correct' : cur.status === 'wrong' ? 'Incorrect' : cur.status === 'nokey' ? 'No answer key — not scored' : 'Omitted'}
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
        {settings.apiKey && (
          <button className="btn btn-sm" onClick={() => setRecheck(true)} title="Have the AI solve this question again from scratch">
            <Icon name="refresh" size={14} /> Re-check answer
          </button>
        )}
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
                  {a.test.source === 'ai' && <span className="badge" style={{ marginLeft: 4 }}>AI-written</span>}
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
                  className={`${x.status === 'nokey' ? 'omit' : x.status} ${x.q.id === cur.q.id ? 'on' : ''}`}
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
      {recheck && <RecheckModal a={a} row={cur} onClose={() => setRecheck(false)} onApplied={setA} />}
    </div>
  );
}

// ───────────────────────── re-check an answer with the AI ─────────────────────────
function RecheckModal({ a, row, onClose, onApplied }: { a: Attempt; row: Row; onClose: () => void; onApplied: (a: Attempt) => void }) {
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [res, setRes] = useState<Recheck | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const ac = new AbortController();
    recheckQuestion(row.q, row.kind, ac.signal)
      .then((r) => {
        setRes(r);
        setState('done');
      })
      .catch((e) => {
        if ((e as AiError).code === 'cancelled') return;
        setError((e as Error).message);
        setState('error');
      });
    return () => ac.abort();
  }, [row.q, row.kind]);

  const current: Question = row.q;
  const agrees = res ? isCorrect({ ...current }, res.answer) || (res.answers ?? []).some((x) => isCorrect(current, x)) : false;

  const apply = async () => {
    if (!res) return;
    const patch = (q: Question): Question => (q.id === current.id ? { ...q, answer: res.answer, answers: res.answers, explanation: res.explanation } : q);
    const patchTest = (t: Test): Test => ({ ...t, sections: t.sections.map((s) => ({ ...s, modules: s.modules.map((m) => ({ ...m, questions: m.questions.map(patch) })) })) });
    const next: Attempt = { ...a, test: patchTest(a.test) };
    next.result = computeResult(next);
    await db.putAttempt(next);
    const stored = await db.getTest(a.testId);
    if (stored) await db.putTest(patchTest(stored));
    onApplied(next);
    toast('Answer key fixed and your score updated');
    onClose();
  };

  return (
    <Modal title="Re-check this answer" onClose={onClose} icon={<Icon name="refresh" />}>
      {state === 'working' && (
        <div className="stack" style={{ alignItems: 'center', padding: '18px 0', textAlign: 'center' }}>
          <div className="spinner" />
          <p className="muted">Claude is solving this question again from scratch, without seeing the current answer. This takes up to a minute.</p>
        </div>
      )}
      {state === 'error' && <p style={{ color: 'var(--red)' }}>{error}</p>}
      {state === 'done' && res && (
        <div className="stack">
          {agrees ? (
            <div className="parse-summary">
              <Icon name="check" size={18} style={{ color: 'var(--g-600)' }} />
              Confirmed — the correct answer is <b>{answerLabel(current)}</b>.
            </div>
          ) : (
            <div className="parse-summary" style={{ background: 'var(--amber-50)', borderColor: '#f3dea9' }}>
              <Icon name="help" size={18} style={{ color: 'var(--amber)' }} />
              The re-check got <b>{res.answers?.join(' or ') || res.answer}</b>, but the key says <b>{answerLabel(current)}</b>.
            </div>
          )}
          <div className="rv-explain" style={{ marginTop: 0 }}>
            <div className="rv-explain-title">
              <Icon name="lightbulb" size={17} /> Re-check reasoning
            </div>
            <Markup src={res.explanation} />
          </div>
          <p className="hint">Cost ≈ ${res.costUsd.toFixed(2)}</p>
        </div>
      )}
      <div className="modal-foot" style={{ padding: '14px 0 0' }}>
        <button className="btn" onClick={onClose}>
          {state === 'done' && !agrees ? 'Keep current answer' : 'Close'}
        </button>
        {state === 'done' && res && !agrees && (
          <button className="btn btn-primary" onClick={apply}>
            Use {res.answers?.[0] ?? res.answer} as correct
          </button>
        )}
      </div>
    </Modal>
  );
}
