// The Bluebook-style test runner.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../lib/db';
import { emptyResponse, moduleMs, TIMING_LABEL } from '../lib/attempt';
import { computeResult, routeModule2, SECTION_NAME } from '../lib/scoring';
import { navigate, useSettings } from '../lib/store';
import type { Attempt, Highlight, Module, Response, TimingMode } from '../lib/types';
import { fmtClock, LETTERS } from '../lib/util';
import { Icon } from '../components/Icon';
import { confirmDialog, Logo, Spinner } from '../components/ui';
import { QuestionView } from './QuestionView';
import { Calculator, DirectionsPanel, LineReader, MoreMenu, ReferenceSheet, ShortcutsModal, useClickOutside } from './Tools';
import '../styles/runner.css';

export function Runner({ attemptId }: { attemptId: string }) {
  const [attempt, setAttempt] = useState<Attempt | null | undefined>(undefined);
  useEffect(() => {
    db.getAttempt(attemptId).then((a) => setAttempt(a ?? null));
  }, [attemptId]);
  if (attempt === undefined) return <Spinner label="Loading your test…" />;
  if (attempt === null)
    return (
      <div className="empty">
        <h3>Test not found</h3>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          Back home
        </button>
      </div>
    );
  return <RunnerInner initial={attempt} />;
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'SELECT');
}

function RunnerInner({ initial }: { initial: Attempt }) {
  const [settings] = useSettings();
  const [a, setA] = useState<Attempt>(initial);
  const aRef = useRef(a);
  aRef.current = a;

  // time lives in refs so the ticking clock doesn't re-render the question
  const remainingRef = useRef(initial.remainingMs);
  const breakRef = useRef(initial.breakRemainingMs ?? 0);
  const qTimeRef = useRef<Record<string, number>>(
    Object.fromEntries(Object.entries(initial.responses).map(([k, r]) => [k, r.timeMs || 0])),
  );

  const [crossMode, setCrossMode] = useState(false);
  const [split, setSplit] = useState(50);
  const [navOpen, setNavOpen] = useState(false);
  const [dirOpen, setDirOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcMounted, setCalcMounted] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const [lineReader, setLineReader] = useState(false);
  const [timerHidden, setTimerHidden] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const warnedRef = useRef(false);

  const stage = a.stages[a.stageIndex];
  const section = stage ? a.test.sections[stage.sectionIndex] : undefined;
  const mod: Module | undefined = section?.modules.find((m) => m.id === stage?.moduleId);
  const questions = mod?.questions ?? [];
  const q = questions[a.qIndex];
  const kind = section?.kind ?? 'rw';
  const untimed = a.timing === 'untimed';

  // ───────── persistence ─────────
  const snapshot = useCallback((x: Attempt): Attempt => {
    const responses = { ...x.responses };
    for (const [qid, t] of Object.entries(qTimeRef.current)) {
      responses[qid] = { ...(responses[qid] ?? emptyResponse()), timeMs: Math.round(t) };
    }
    return { ...x, responses, remainingMs: Math.round(remainingRef.current), breakRemainingMs: Math.round(breakRef.current), updatedAt: Date.now() };
  }, []);

  const saveTimer = useRef<number | undefined>(undefined);
  const saveSoon = useCallback(
    (delay = 400) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => db.putAttempt(snapshot(aRef.current), true), delay);
    },
    [snapshot],
  );

  const commit = useCallback(
    (next: Attempt, now = false) => {
      aRef.current = next;
      setA(next);
      if (now) {
        clearTimeout(saveTimer.current);
        return db.putAttempt(snapshot(next), true);
      }
      saveSoon();
      return Promise.resolve();
    },
    [saveSoon, snapshot],
  );

  useEffect(() => {
    const iv = setInterval(() => {
      if (aRef.current.status === 'active') db.putAttempt(snapshot(aRef.current), true);
    }, 5000);
    const flush = () => {
      if (aRef.current.status === 'active') db.putAttempt(snapshot(aRef.current), true);
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      clearInterval(iv);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
      flush();
    };
  }, [snapshot]);

  // ───────── module flow ─────────
  const finish = useCallback(async () => {
    const cur = aRef.current;
    // resolve any adaptive module still undecided so results are honest
    const stages = cur.stages.map((s) => (s.moduleId ? s : { ...s, moduleId: routeModule2(cur.test, s.sectionIndex, cur) }));
    const done: Attempt = { ...snapshot({ ...cur, stages }), status: 'completed', phase: 'done', finishedAt: Date.now() };
    done.result = computeResult(done);
    aRef.current = done;
    setA(done);
    await db.putAttempt(done);
  }, [snapshot]);

  const startModuleAt = useCallback(
    (x: Attempt, stageIndex: number) => {
      const st = x.stages[stageIndex];
      const m = x.test.sections[st.sectionIndex].modules.find((mm) => mm.id === st.moduleId);
      remainingRef.current = m ? moduleMs(m, x.timing) : 0;
      warnedRef.current = false;
      setCrossMode(false);
      setNavOpen(false);
      if (st.stage === 1) setDirOpen(true);
      if (x.test.sections[st.sectionIndex].kind !== 'math') {
        setCalcOpen(false);
        setRefOpen(false);
      }
      commit({ ...x, stageIndex, qIndex: 0, phase: 'module' }, true);
    },
    [commit],
  );

  const endModule = useCallback(
    (reason: 'submit' | 'timeup' = 'submit') => {
      const cur = aRef.current;
      const st = cur.stages[cur.stageIndex];
      let stages = cur.stages;
      if (st?.stage === 1) {
        stages = stages.map((s, i) =>
          i > cur.stageIndex && s.sectionIndex === st.sectionIndex && s.stage === 2 && !s.moduleId
            ? { ...s, moduleId: routeModule2(cur.test, st.sectionIndex, cur) }
            : s,
        );
      }
      const next = { ...cur, stages };
      setNavOpen(false);
      setDirOpen(false);
      if (reason === 'timeup') {
        setBanner("Time's up for this module — your answers were saved.");
        setTimeout(() => setBanner(null), 5000);
      }
      if (cur.stageIndex + 1 >= stages.length) {
        aRef.current = next;
        finish();
        return;
      }
      const ns = stages[cur.stageIndex + 1];
      if (ns.sectionIndex !== st.sectionIndex && (cur.test.breakMinutes ?? 0) > 0) {
        breakRef.current = cur.test.breakMinutes * 60_000;
        setCalcOpen(false);
        setRefOpen(false);
        commit({ ...next, phase: 'break' }, true);
      } else {
        commit({ ...next, phase: 'transition' }, true);
      }
    },
    [commit, finish],
  );

  // transition screen → next module after a short "preparing" moment
  useEffect(() => {
    if (a.phase !== 'transition') return;
    const t = setTimeout(() => startModuleAt(aRef.current, aRef.current.stageIndex + 1), 2200);
    return () => clearTimeout(t);
  }, [a.phase, startModuleAt]);

  const endModuleRef = useRef(endModule);
  endModuleRef.current = endModule;

  // ───────── the clock ─────────
  useEffect(() => {
    if (!['module', 'review', 'break'].includes(a.phase)) return;
    let last = performance.now();
    const iv = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(now - last, 5000);
      last = now;
      const cur = aRef.current;
      if (cur.phase === 'break') {
        breakRef.current -= dt;
        if (breakRef.current <= 0) {
          breakRef.current = 0;
          commit({ ...cur, phase: 'transition' }, true);
        }
        return;
      }
      if (cur.timing === 'untimed') remainingRef.current += dt;
      else remainingRef.current -= dt;
      if (cur.phase === 'module') {
        const st = cur.stages[cur.stageIndex];
        const m = cur.test.sections[st.sectionIndex].modules.find((mm) => mm.id === st.moduleId);
        const qid = m?.questions[cur.qIndex]?.id;
        if (qid) qTimeRef.current[qid] = (qTimeRef.current[qid] ?? 0) + dt;
      }
      if (cur.timing !== 'untimed') {
        if (!warnedRef.current && remainingRef.current <= 5 * 60_000 && remainingRef.current > 0) {
          warnedRef.current = true;
          const st = cur.stages[cur.stageIndex];
          const m = cur.test.sections[st.sectionIndex].modules.find((mm) => mm.id === st.moduleId);
          if (m && moduleMs(m, cur.timing) > 6 * 60_000) {
            setTimerHidden(false);
            setBanner('5 minutes remaining in this module.');
            setTimeout(() => setBanner(null), 6000);
          }
        }
        if (remainingRef.current <= 0) {
          remainingRef.current = 0;
          endModuleRef.current('timeup');
        }
      }
    }, 250);
    return () => clearInterval(iv);
  }, [a.phase, a.stageIndex, commit]);

  // count visits
  useEffect(() => {
    if (a.phase !== 'module' || !q) return;
    const cur = aRef.current;
    const r = cur.responses[q.id] ?? emptyResponse();
    commit({ ...cur, responses: { ...cur.responses, [q.id]: { ...r, visits: r.visits + 1 } } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.id, a.phase]);

  // ───────── answering ─────────
  const patchResp = useCallback(
    (qid: string, fn: (r: Response) => Response) => {
      const cur = aRef.current;
      commit({ ...cur, responses: { ...cur.responses, [qid]: fn(cur.responses[qid] ?? emptyResponse()) } });
    },
    [commit],
  );

  const answer = useCallback(
    (val: string) => {
      if (!q) return;
      if (q.type === 'spr') {
        patchResp(q.id, (r) => ({ ...r, answer: val || undefined }));
        return;
      }
      patchResp(q.id, (r) => ({
        ...r,
        answer: val,
        crossed: r.crossed.filter((c) => c !== val),
        changes: r.answer && r.answer !== val ? r.changes + 1 : r.changes,
        firstAnswer: r.firstAnswer ?? val,
      }));
    },
    [q, patchResp],
  );

  const cross = useCallback(
    (L: string) => {
      if (!q) return;
      patchResp(q.id, (r) => {
        const on = r.crossed.includes(L);
        return {
          ...r,
          crossed: on ? r.crossed.filter((c) => c !== L) : [...r.crossed, L],
          answer: !on && r.answer === L ? undefined : r.answer,
        };
      });
    },
    [q, patchResp],
  );

  const toggleMark = useCallback(() => q && patchResp(q.id, (r) => ({ ...r, marked: !r.marked })), [q, patchResp]);

  const setHighlights = useCallback(
    (list: Highlight[]) => {
      if (!q) return;
      const cur = aRef.current;
      commit({ ...cur, highlights: { ...cur.highlights, [q.id]: list } });
    },
    [q, commit],
  );

  const commitSprFirst = useCallback(() => {
    if (q?.type === 'spr') {
      const r = aRef.current.responses[q.id];
      if (r?.answer && !r.firstAnswer) patchResp(q.id, (x) => ({ ...x, firstAnswer: x.answer }));
    }
  }, [q, patchResp]);

  const goTo = useCallback(
    (i: number) => {
      commitSprFirst();
      setNavOpen(false);
      commit({ ...aRef.current, qIndex: i, phase: 'module' });
    },
    [commit, commitSprFirst],
  );
  const next = useCallback(() => {
    const cur = aRef.current;
    if (cur.phase === 'review') return endModule('submit');
    commitSprFirst();
    if (cur.qIndex + 1 >= questions.length) commit({ ...aRef.current, phase: 'review' });
    else commit({ ...aRef.current, qIndex: cur.qIndex + 1 });
  }, [questions.length, commit, endModule, commitSprFirst]);
  const back = useCallback(() => {
    const cur = aRef.current;
    if (cur.phase === 'review') return commit({ ...cur, phase: 'module', qIndex: questions.length - 1 });
    if (cur.qIndex > 0) {
      commitSprFirst();
      commit({ ...aRef.current, qIndex: cur.qIndex - 1 });
    }
  }, [questions.length, commit, commitSprFirst]);

  // ───────── keyboard shortcuts ─────────
  useEffect(() => {
    if (a.phase !== 'module' && a.phase !== 'review') return;
    const k = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('.modal-back')) return;
      const key = e.key;
      if (a.phase === 'module' && q?.type === 'mcq' && key.length === 1) {
        const up = key.toUpperCase();
        const letterIdx = 'ABCD'.indexOf(up);
        const idx = letterIdx >= 0 ? letterIdx : e.shiftKey ? -1 : ['1', '2', '3', '4'].indexOf(key);
        if (idx >= 0 && idx < q.choices.length) {
          if (e.shiftKey && letterIdx >= 0) {
            if (!crossMode) setCrossMode(true);
            cross(LETTERS[idx]);
          } else if (!e.shiftKey) {
            answer(LETTERS[idx]);
          }
          e.preventDefault();
          return;
        }
      }
      switch (key) {
        case 'ArrowRight':
          next();
          break;
        case 'ArrowLeft':
          back();
          break;
        case 'm':
        case 'M':
          if (a.phase === 'module') toggleMark();
          break;
        case 'x':
        case 'X':
          setCrossMode((v) => !v);
          break;
        case 'r':
        case 'R':
          if (kind === 'math') setRefOpen((v) => !v);
          break;
        case 'l':
        case 'L':
          setLineReader((v) => !v);
          break;
        case 't':
        case 'T':
          setTimerHidden((v) => !v);
          break;
        case '?':
          setShortcuts(true);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [a.phase, q, crossMode, kind, answer, cross, next, back, toggleMark]);

  // calculator shortcut: Shift-free "C" conflicts with choice C, so use Alt+C anywhere
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'c' || e.key === 'C') && kind === 'math') {
        e.preventDefault();
        setCalcMounted(true);
        setCalcOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [kind]);

  // ───────── exit actions ─────────
  const saveAndExit = async () => {
    await db.putAttempt(snapshot(aRef.current));
    navigate('/');
  };
  const endTestNow = async () => {
    const ok = await confirmDialog({
      title: 'End the test now?',
      body: 'Your test will be scored right away. Questions you have not answered — including any modules you have not started — count as omitted.',
      ok: 'End and score',
      danger: true,
    });
    if (ok) finish();
  };

  const theme = settings.classicTheme ? 'classic' : 'guru';

  // ───────── screens outside a module ─────────
  if (a.phase === 'intro') {
    return (
      <div className="rn" data-theme={theme}>
        <IntroScreen
          attempt={a}
          name={settings.name}
          onStart={(timing) => {
            const x = { ...aRef.current, timing };
            startModuleAt(x, 0);
          }}
        />
      </div>
    );
  }
  if (a.phase === 'transition') {
    return (
      <div className="rn" data-theme={theme}>
        <TransitionScreen a={a} />
      </div>
    );
  }
  if (a.phase === 'break') {
    return (
      <div className="rn" data-theme={theme}>
        <BreakScreen getRemaining={() => breakRef.current} onResume={() => commit({ ...aRef.current, phase: 'transition' }, true)} />
      </div>
    );
  }
  if (a.phase === 'done' || a.status === 'completed') {
    return (
      <div className="rn" data-theme={theme}>
        <FinishedScreen a={a} />
      </div>
    );
  }
  if (!stage || !section || !mod) {
    return (
      <div className="empty">
        <h3>This test has no questions yet</h3>
        <button className="btn btn-primary" onClick={() => navigate('/tests')}>
          Back to my tests
        </button>
      </div>
    );
  }

  const moduleLabel = `Section ${stage.sectionIndex + 1}, Module ${stage.stage}: ${SECTION_NAME[kind]}`;
  const isLastStage = a.stageIndex === a.stages.length - 1;
  const r = q ? a.responses[q.id] : undefined;

  return (
    <div className={`rn ${lineReader ? 'with-lr' : ''}`} data-theme={theme}>
      {/* ───── header ───── */}
      <header className="rn-head">
        <div className="rn-head-left">
          <div className="rn-title">{moduleLabel}</div>
          <button className={`rn-dir-btn ${dirOpen ? 'on' : ''}`} onClick={() => setDirOpen((v) => !v)}>
            Directions <Icon name={dirOpen ? 'chevronUp' : 'chevronDown'} size={16} stroke={2.4} />
          </button>
        </div>
        <div className="rn-head-center">
          <Timer getMs={() => remainingRef.current} hidden={timerHidden} untimed={untimed} />
          <button className="rn-hide" onClick={() => setTimerHidden((v) => !v)}>
            {timerHidden ? 'Show' : 'Hide'}
          </button>
        </div>
        <div className="rn-head-right">
          {kind === 'rw' ? (
            <HighlightButton />
          ) : (
            <>
              <button
                className={`rn-tool ${calcOpen ? 'on' : ''}`}
                onClick={() => {
                  setCalcMounted(true);
                  setCalcOpen((v) => !v);
                }}
              >
                <Icon name="calculator" size={22} />
                <span>Calculator</span>
              </button>
              <button className={`rn-tool ${refOpen ? 'on' : ''}`} onClick={() => setRefOpen((v) => !v)}>
                <Icon name="formula" size={22} />
                <span>Reference</span>
              </button>
            </>
          )}
          <MoreMenu
            items={[
              { icon: 'keyboard', label: 'Keyboard shortcuts', onClick: () => setShortcuts(true) },
              { icon: 'lineReader', label: 'Line reader', onClick: () => setLineReader((v) => !v), checked: lineReader },
              { icon: 'logout', label: 'Save and exit', onClick: saveAndExit },
              { icon: 'flag', label: 'End test and get score', onClick: endTestNow, danger: true },
            ]}
          />
        </div>
      </header>
      <div className="rn-dash" />

      {dirOpen && <DirectionsPanel kind={kind} onClose={() => setDirOpen(false)} />}
      {banner && (
        <div className="rn-banner" role="status">
          <Icon name="clock" size={18} /> {banner}
        </div>
      )}

      {/* ───── main ───── */}
      <main className="rn-main">
        {a.phase === 'review' ? (
          <CheckWork
            label={moduleLabel}
            questions={questions}
            responses={a.responses}
            onGo={goTo}
            isLast={isLastStage}
          />
        ) : (
          q && (
            <QuestionView
              key={q.id}
              q={q}
              kind={kind}
              number={a.qIndex + 1}
              response={r}
              highlights={a.highlights[q.id] ?? []}
              crossMode={crossMode}
              split={split}
              onSplit={setSplit}
              onAnswer={answer}
              onCross={cross}
              onToggleMark={toggleMark}
              onToggleCrossMode={() => setCrossMode((v) => !v)}
              onHighlights={setHighlights}
            />
          )
        )}
      </main>

      {/* ───── footer ───── */}
      <div className="rn-dash" />
      <footer className="rn-foot">
        <div className="rn-foot-left">{settings.name || 'Student'}</div>
        <div className="rn-foot-center">
          {a.phase === 'module' && (
            <Navigator
              open={navOpen}
              setOpen={setNavOpen}
              label={moduleLabel}
              current={a.qIndex}
              questions={questions}
              responses={a.responses}
              onGo={goTo}
              onReview={() => {
                setNavOpen(false);
                commitSprFirst();
                commit({ ...aRef.current, phase: 'review' });
              }}
            />
          )}
        </div>
        <div className="rn-foot-right">
          {(a.phase === 'review' || a.qIndex > 0) && (
            <button className="rn-btn" onClick={back}>
              Back
            </button>
          )}
          <button className="rn-btn rn-btn-acc" onClick={next}>
            {a.phase === 'review' && isLastStage ? 'Submit' : 'Next'}
          </button>
        </div>
      </footer>

      {kind === 'math' && calcMounted && <Calculator open={calcOpen} onClose={() => setCalcOpen(false)} />}
      {kind === 'math' && <ReferenceSheet open={refOpen} onClose={() => setRefOpen(false)} />}
      {lineReader && <LineReader onClose={() => setLineReader(false)} />}
      {shortcuts && <ShortcutsModal onClose={() => setShortcuts(false)} />}
    </div>
  );
}

// ─────────────────────────── pieces ───────────────────────────
function Timer({ getMs, hidden, untimed }: { getMs: () => number; hidden: boolean; untimed: boolean }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  const ms = getMs();
  const warn = !untimed && ms <= 5 * 60_000;
  if (hidden)
    return (
      <div className="rn-timer hidden" title="Timer hidden">
        <Icon name="clock" size={22} />
      </div>
    );
  return (
    <div className={`rn-timer ${warn ? 'warn' : ''}`} aria-live="off">
      {fmtClock(ms)}
    </div>
  );
}

function HighlightButton() {
  const [tip, setTip] = useState(false);
  useEffect(() => {
    if (!tip) return;
    const t = setTimeout(() => setTip(false), 3200);
    return () => clearTimeout(t);
  }, [tip]);
  return (
    <div className="more-wrap">
      <button className={`rn-tool ${tip ? 'on' : ''}`} onClick={() => setTip((v) => !v)}>
        <Icon name="pen" size={22} />
        <span>Highlights &amp; Notes</span>
      </button>
      {tip && (
        <div className="rn-tip">
          <b>Select any text</b> in the passage or question to highlight it, underline it, or attach a note. Click a highlight to change or delete it.
        </div>
      )}
    </div>
  );
}

function QBox({ i, r, current }: { i: number; r?: Response; current?: boolean }) {
  const answered = !!r?.answer;
  return (
    <span className={`qbox ${answered ? 'answered' : 'unanswered'} ${current ? 'current' : ''}`}>
      {current && <Icon name="pin" size={16} className="qbox-pin" fill="currentColor" stroke={0} />}
      {r?.marked && <Icon name="bookmark" size={13} className="qbox-flag" fill="currentColor" stroke={1.5} />}
      {i + 1}
    </span>
  );
}

function Legend() {
  return (
    <div className="nav-legend">
      <span>
        <Icon name="pin" size={16} fill="currentColor" stroke={0} className="lg-pin" /> Current
      </span>
      <span>
        <span className="lg-empty" /> Unanswered
      </span>
      <span>
        <Icon name="bookmark" size={15} fill="currentColor" stroke={1.5} className="lg-flag" /> For Review
      </span>
    </div>
  );
}

function Navigator({
  open,
  setOpen,
  label,
  current,
  questions,
  responses,
  onGo,
  onReview,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  label: string;
  current: number;
  questions: { id: string }[];
  responses: Record<string, Response>;
  onGo: (i: number) => void;
  onReview: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), [setOpen]);
  useClickOutside(ref, close, open);
  return (
    <div className="nav-wrap" ref={ref}>
      {open && (
        <div className="nav-pop" role="dialog" aria-label="Question navigator">
          <div className="nav-pop-head">
            <span>{label} Questions</span>
            <button className="fpanel-btn" onClick={close} aria-label="Close">
              <Icon name="close" size={18} />
            </button>
          </div>
          <Legend />
          <div className="nav-grid">
            {questions.map((qq, i) => (
              <button key={qq.id} className="nav-cell" onClick={() => onGo(i)} aria-label={`Question ${i + 1}`}>
                <QBox i={i} r={responses[qq.id]} current={i === current} />
              </button>
            ))}
          </div>
          <div className="nav-pop-foot">
            <button className="rn-btn rn-btn-outline" onClick={onReview}>
              Go to Review Page
            </button>
          </div>
          <span className="nav-pop-arrow" />
        </div>
      )}
      <button className={`nav-toggle ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        Question {current + 1} of {questions.length}
        <Icon name={open ? 'chevronDown' : 'chevronUp'} size={16} stroke={2.6} />
      </button>
    </div>
  );
}

function CheckWork({
  label,
  questions,
  responses,
  onGo,
  isLast,
}: {
  label: string;
  questions: { id: string }[];
  responses: Record<string, Response>;
  onGo: (i: number) => void;
  isLast: boolean;
}) {
  const answered = questions.filter((q) => responses[q.id]?.answer).length;
  const marked = questions.filter((q) => responses[q.id]?.marked).length;
  return (
    <div className="cw">
      <h1 className="cw-title">Check Your Work</h1>
      <p className="cw-sub">
        On test day, you won't be able to move on to the next module until time runs out.
        <br />
        For this practice test, you can select <b>{isLast ? 'Submit' : 'Next'}</b> whenever you're ready.
      </p>
      <div className="cw-card">
        <div className="cw-card-head">
          <span className="cw-card-title">{label} Questions</span>
          <Legend />
        </div>
        <div className="cw-stats">
          <span>
            <b>{answered}</b> of {questions.length} answered
          </span>
          {questions.length - answered > 0 && <span className="cw-warn">{questions.length - answered} unanswered</span>}
          {marked > 0 && <span>{marked} marked for review</span>}
        </div>
        <div className="nav-grid cw-grid">
          {questions.map((qq, i) => (
            <button key={qq.id} className="nav-cell" onClick={() => onGo(i)} aria-label={`Question ${i + 1}`}>
              <QBox i={i} r={responses[qq.id]} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── full-screen states ───────────────────────────
function IntroScreen({ attempt, name, onStart }: { attempt: Attempt; name: string; onStart: (t: TimingMode) => void }) {
  const [timing, setTiming] = useState<TimingMode>(attempt.timing);
  const [settings, setSettings] = useSettings();
  const [nm, setNm] = useState(name);
  const plan = useMemo(() => {
    return attempt.test.sections.map((s, i) => {
      const m1 = s.modules.find((m) => m.stage === 1);
      const m2 = s.modules.filter((m) => m.stage === 2);
      return { i, kind: s.kind, m1, m2 };
    });
  }, [attempt.test]);
  const mult = timing === 'x1.5' ? 1.5 : timing === 'x2' ? 2 : 1;
  return (
    <div className="rn-screen intro">
      <div className="intro-card">
        <div className="intro-top">
          <Logo variant="mark" height={44} />
          <div>
            <div className="intro-eyebrow">{attempt.kind === 'practice' ? 'Practice set' : 'Practice test'}</div>
            <h1>{attempt.testTitle}</h1>
          </div>
        </div>

        <div className="intro-plan">
          {plan.map((p) => (
            <div className="intro-sec" key={p.i}>
              <div className="intro-sec-name">
                <span className="intro-sec-num">{p.i + 1}</span>
                {SECTION_NAME[p.kind]}
              </div>
              <div className="intro-mods">
                {p.m1 && (
                  <div className="intro-mod">
                    <span>Module 1</span>
                    <span>
                      {p.m1.questions.length} questions · {timing === 'untimed' ? 'untimed' : `${Math.round(p.m1.minutes * mult)} min`}
                    </span>
                  </div>
                )}
                {p.m2.length > 0 && (
                  <div className="intro-mod">
                    <span>Module 2 {p.m2.length > 1 && <span className="badge badge-green">adaptive</span>}</span>
                    <span>
                      {p.m2[0].questions.length} questions · {timing === 'untimed' ? 'untimed' : `${Math.round(p.m2[0].minutes * mult)} min`}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
          {attempt.test.sections.length > 1 && attempt.test.breakMinutes > 0 && (
            <div className="intro-break">
              <Icon name="timer" size={16} /> {attempt.test.breakMinutes}-minute break between sections
            </div>
          )}
        </div>

        <div className="intro-opts">
          <div className="field">
            <label>Name shown on screen</label>
            <input className="input" value={nm} placeholder="Your name" onChange={(e) => setNm(e.target.value)} />
          </div>
          <div className="field">
            <label>Timing</label>
            <select className="select" value={timing} onChange={(e) => setTiming(e.target.value as TimingMode)}>
              {(Object.keys(TIMING_LABEL) as TimingMode[]).map((t) => (
                <option key={t} value={t}>
                  {TIMING_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <ul className="intro-tips">
          <li>
            <Icon name="check" size={16} /> Like on test day, the timer keeps running — even if you leave this tab.
          </li>
          <li>
            <Icon name="check" size={16} /> Your progress saves automatically. Use <b>More → Save and exit</b> to continue later.
          </li>
          <li>
            <Icon name="check" size={16} /> Press <span className="kbd">?</span> during the test to see keyboard shortcuts.
          </li>
        </ul>

        <div className="intro-actions">
          <button className="btn" onClick={() => navigate('/tests')}>
            Not now
          </button>
          <button
            className="rn-btn rn-btn-acc rn-btn-lg"
            onClick={() => {
              if (nm !== settings.name) setSettings({ name: nm });
              onStart(timing);
            }}
          >
            Begin test <Icon name="arrowRight" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

function TransitionScreen({ a }: { a: Attempt }) {
  const nextStage = a.stages[a.stageIndex + 1];
  const kind = nextStage ? a.test.sections[nextStage.sectionIndex].kind : 'rw';
  return (
    <div className="rn-screen transition">
      <div className="tr-box">
        <div className="tr-logo">
          <Logo variant="mark" height={64} />
        </div>
        <h2>Preparing your next module</h2>
        <p>
          {nextStage ? `Section ${nextStage.sectionIndex + 1}, Module ${nextStage.stage}: ${SECTION_NAME[kind]}` : 'Almost there'}
        </p>
        <div className="tr-bar">
          <span />
        </div>
        <p className="tr-note">Please don't refresh this page.</p>
      </div>
    </div>
  );
}

function BreakScreen({ getRemaining, onResume }: { getRemaining: () => number; onResume: () => void }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="rn-screen brk">
      <div className="brk-inner">
        <div className="brk-timer-card">
          <div className="brk-label">Remaining Break Time:</div>
          <div className="brk-time">{fmtClock(getRemaining())}</div>
        </div>
        <button className="rn-btn rn-btn-light rn-btn-lg" onClick={onResume}>
          Resume Testing
        </button>
        <div className="brk-text">
          <h2>Practice Test Break</h2>
          <p>You can take a break. On test day, you'll have 10 minutes between Reading and Writing and Math.</p>
          <h3>Take a breath</h3>
          <ul>
            <li>Stand up, stretch, drink some water.</li>
            <li>Don't look at your notes — keep it test-day honest.</li>
            <li>The next section starts automatically when the timer hits 0:00.</li>
          </ul>
        </div>
      </div>
      <div className="brk-logo">
        <Logo variant="mark" height={34} />
      </div>
    </div>
  );
}

function FinishedScreen({ a }: { a: Attempt }) {
  return (
    <div className="rn-screen finished">
      <div className="fin-card">
        <div className="fin-burst">
          {Array.from({ length: 14 }).map((_, i) => (
            <span key={i} style={{ ['--i' as string]: i } as React.CSSProperties} />
          ))}
          <Logo variant="mark" height={72} />
        </div>
        <h1>You're All Finished!</h1>
        <p>
          Great work finishing <b>{a.testTitle}</b>. Your score report and a question-by-question breakdown are ready.
        </p>
        <div className="row" style={{ justifyContent: 'center', gap: 12, marginTop: 26 }}>
          <button className="btn" onClick={() => navigate('/')}>
            Home
          </button>
          <button className="rn-btn rn-btn-acc rn-btn-lg" onClick={() => navigate(`/results/${a.id}`)}>
            View my score <Icon name="arrowRight" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
