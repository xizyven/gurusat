import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { PdfCropper } from '../components/PdfCropper';
import { confirmDialog, Modal, Spinner, toast } from '../components/ui';
import { createAttempt, testStats } from '../lib/attempt';
import { db } from '../lib/db';
import { plainText } from '../lib/markup';
import { parseKeyList } from '../lib/parser';
import { isLocked, confirmUnseal } from '../lib/seal';
import { navigate, useAttempts, useSettings, findTest } from '../lib/store';
import { classify, DOMAINS, domainOfSkill } from '../lib/taxonomy';
import type { Module, Question, Response, Section, SectionKind, Test } from '../lib/types';
import { compressImage, LETTERS, readFileAsDataUrl, uid } from '../lib/util';
import { QuestionView } from '../runner/QuestionView';
import '../styles/runner.css';
import '../styles/editor.css';

const SECTION_LABEL: Record<SectionKind, string> = { rw: 'Reading & Writing', math: 'Math' };

function blankQuestion(kind: SectionKind): Question {
  return {
    id: uid('q_'),
    type: 'mcq',
    passage: kind === 'rw' ? '' : undefined,
    prompt: '',
    choices: LETTERS.slice(0, 4).map(() => ({ id: uid('c_'), text: '' })),
    answer: '',
  };
}

function moduleLabel(_sec: Section, m: Module) {
  const v = m.variant === 'harder' ? ' · harder' : m.variant === 'easier' ? ' · easier' : '';
  return `Module ${m.stage}${v}`;
}

function problems(q: Question): string[] {
  const p: string[] = [];
  if (!q.answer) p.push('No correct answer');
  if (!q.prompt.trim() && !q.image) p.push('No question text');
  if (q.type === 'mcq' && !q.image && q.choices.some((c) => !c.text.trim())) p.push('Empty answer choice');
  return p;
}

export default function Editor({ testId }: { testId?: string }) {
  const [test, setTest] = useState<Test | null | undefined>(undefined);
  const attempts = useAttempts();
  const [settings] = useSettings();
  useEffect(() => {
    if (!testId) return setTest(null);
    findTest(testId).then((t) => setTest(t ?? null));
  }, [testId]);
  if (test === undefined || !attempts) return <Spinner />;
  if (test && isLocked(test, attempts))
    return (
      <div className="card lock-card">
        <div className="empty-ic">
          <Icon name="shield" size={30} />
        </div>
        <h2>This mock is sealed</h2>
        <p>
          <b>{test.title}</b> was solved by the AI, and its questions and answers stay hidden until you've taken it — so the mock stays fair.
        </p>
        <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 22 }}>
          <button
            className="btn btn-ghost btn-danger"
            onClick={async () => {
              if (await confirmUnseal(test)) setTest({ ...test, sealed: false });
            }}
          >
            Reveal anyway
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              const a = await createAttempt(test, settings.defaultTiming);
              navigate(`/test/${a.id}`);
            }}
          >
            <Icon name="play" size={14} fill="currentColor" /> Take the test
          </button>
        </div>
      </div>
    );
  if (!test)
    return (
      <div className="empty">
        <h3>Test not found</h3>
        <button className="btn btn-primary" onClick={() => navigate('/tests')}>
          My tests
        </button>
      </div>
    );
  return <EditorInner initial={test} />;
}

function EditorInner({ initial }: { initial: Test }) {
  const [test, setTest] = useState<Test>(initial);
  const [sel, setSel] = useState<{ s: number; m: number; q: number }>({ s: 0, m: 0, q: 0 });
  const [saved, setSaved] = useState<'saved' | 'saving'>('saved');
  const [keyFor, setKeyFor] = useState<{ s: number; m: number } | null>(null);
  const [modSettings, setModSettings] = useState<{ s: number; m: number } | null>(null);
  const [testSettings, setTestSettings] = useState(false);
  const [settings] = useSettings();
  const first = useRef(true);

  // autosave
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaved('saving');
    const t = setTimeout(async () => {
      await db.putTest({ ...test, builtIn: undefined, updatedAt: Date.now() });
      setSaved('saved');
    }, 500);
    return () => clearTimeout(t);
  }, [test]);

  const update = useCallback((fn: (t: Test) => void) => {
    setTest((prev) => {
      const next: Test = structuredClone(prev);
      fn(next);
      return next;
    });
  }, []);

  const sec = test.sections[sel.s];
  const mod = sec?.modules[sel.m];
  const q = mod?.questions[sel.q];

  // path-copy instead of a deep clone so typing stays fast even with many images
  const patchQ = (p: Partial<Question>) =>
    setTest((prev) => {
      const sections = prev.sections.slice();
      const s = { ...sections[sel.s] };
      sections[sel.s] = s;
      s.modules = s.modules.slice();
      const m = { ...s.modules[sel.m] };
      s.modules[sel.m] = m;
      m.questions = m.questions.slice();
      m.questions[sel.q] = { ...m.questions[sel.q], ...p };
      return { ...prev, sections };
    });

  const addQuestion = (s: number, m: number, after?: number) => {
    const kind = test.sections[s].kind;
    const nq = blankQuestion(kind);
    let idx = 0;
    update((t) => {
      const qs = t.sections[s].modules[m].questions;
      idx = after === undefined ? qs.length : after + 1;
      qs.splice(idx, 0, nq);
    });
    setTimeout(() => setSel({ s, m, q: idx }), 0);
  };

  const addSection = (kind: SectionKind) => {
    const n = test.sections.length;
    update((t) => {
      t.sections.push({
        id: uid('s_'),
        kind,
        modules: [{ id: uid('m_'), stage: 1, variant: 'standard', minutes: kind === 'rw' ? 32 : 35, questions: [] }],
      });
    });
    setSel({ s: n, m: 0, q: 0 });
  };

  const addModule = (s: number, variant: Module['variant']) => {
    const n = test.sections[s].modules.length;
    update((t) => {
      const ss = t.sections[s];
      const hasM1 = ss.modules.some((m) => m.stage === 1);
      if (variant !== 'standard') {
        // turning module 2 adaptive: make sure the existing one is labeled
        const m2 = ss.modules.filter((m) => m.stage === 2);
        if (m2.length === 1 && m2[0].variant === 'standard') m2[0].variant = variant === 'easier' ? 'harder' : 'easier';
      }
      ss.modules.push({ id: uid('m_'), stage: hasM1 ? 2 : 1, variant: hasM1 ? variant : 'standard', minutes: ss.kind === 'rw' ? 32 : 35, questions: [] });
    });
    setSel({ s, m: n, q: 0 });
  };

  const stats = testStats(test);
  const issues = useMemo(() => {
    let n = 0;
    test.sections.forEach((s) => s.modules.forEach((m) => m.questions.forEach((qq) => (n += problems(qq).length ? 1 : 0))));
    return n;
  }, [test]);

  const takeTest = async () => {
    await db.putTest({ ...test, builtIn: undefined, updatedAt: Date.now() });
    const a = await createAttempt(test, settings.defaultTiming);
    navigate(`/test/${a.id}`);
  };

  return (
    <div className="ed">
      {/* top bar */}
      <div className="ed-top card">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate('/tests')} title="Back to my tests">
          <Icon name="arrowLeft" />
        </button>
        <input className="ed-title" value={test.title} onChange={(e) => update((t) => (t.title = e.target.value))} aria-label="Test name" />
        <span className={`ed-saved ${saved}`}>
          {saved === 'saved' ? (
            <>
              <Icon name="check" size={14} /> Saved
            </>
          ) : (
            'Saving…'
          )}
        </span>
        <span className="spacer" />
        <span className="ed-stat">
          {stats.questions} questions · {stats.minutes} min
          {issues > 0 && <span className="badge badge-amber" style={{ marginLeft: 8 }}>{issues} to fix</span>}
        </span>
        <button className="btn btn-ghost btn-icon" title="Test settings" onClick={() => setTestSettings(true)}>
          <Icon name="settings" size={19} />
        </button>
        <button className="btn btn-primary" onClick={takeTest} disabled={stats.questions === 0}>
          <Icon name="play" size={14} fill="currentColor" /> Take test
        </button>
      </div>

      <div className="ed-body">
        {/* outline */}
        <aside className="ed-outline card">
          {test.sections.map((s, si) => (
            <div className="ed-sec" key={s.id}>
              <div className="ed-sec-head">
                <span className="ed-sec-num">{si + 1}</span>
                <b>{SECTION_LABEL[s.kind]}</b>
                <span className="spacer" />
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  title="Delete section"
                  onClick={async () => {
                    if (await confirmDialog({ title: `Delete the ${SECTION_LABEL[s.kind]} section?`, body: 'All its modules and questions will be removed.', ok: 'Delete', danger: true })) {
                      update((t) => t.sections.splice(si, 1));
                      setSel({ s: 0, m: 0, q: 0 });
                    }
                  }}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
              {s.modules.map((m, mi) => (
                <div className="ed-mod" key={m.id}>
                  <div className="ed-mod-head">
                    <span>{moduleLabel(s, m)}</span>
                    <span className="ed-mod-meta">
                      {m.questions.length}q · {m.minutes}m
                    </span>
                    <span className="spacer" />
                    <button className="btn btn-ghost btn-icon btn-sm" title="Answer key" onClick={() => setKeyFor({ s: si, m: mi })}>
                      <Icon name="check" size={15} />
                    </button>
                    <button className="btn btn-ghost btn-icon btn-sm" title="Module settings" onClick={() => setModSettings({ s: si, m: mi })}>
                      <Icon name="settings" size={15} />
                    </button>
                  </div>
                  <div className="ed-qgrid">
                    {m.questions.map((qq, qi) => {
                      const bad = problems(qq).length > 0;
                      const on = sel.s === si && sel.m === mi && sel.q === qi;
                      return (
                        <button
                          key={qq.id}
                          className={`ed-q ${on ? 'on' : ''} ${bad ? 'bad' : ''} ${qq.answer ? 'ok' : ''}`}
                          onClick={() => setSel({ s: si, m: mi, q: qi })}
                          title={bad ? problems(qq).join(', ') : plainText(qq.prompt, 80)}
                        >
                          {qi + 1}
                        </button>
                      );
                    })}
                    <button className="ed-q add" onClick={() => addQuestion(si, mi)} title="Add question">
                      <Icon name="plus" size={15} />
                    </button>
                  </div>
                </div>
              ))}
              <div className="ed-add-mod">
                {s.modules.length < 2 && (
                  <button className="btn btn-sm btn-ghost" onClick={() => addModule(si, 'standard')}>
                    <Icon name="plus" size={14} /> Module {s.modules.some((m) => m.stage === 1) ? 2 : 1}
                  </button>
                )}
                {s.modules.filter((m) => m.stage === 2).length === 1 && (
                  <button className="btn btn-sm btn-ghost" onClick={() => addModule(si, 'easier')} title="Add an easier Module 2 to make this section adaptive">
                    <Icon name="layers" size={14} /> Make adaptive
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="ed-add-sec">
            {!test.sections.some((s) => s.kind === 'rw') && (
              <button className="btn btn-sm" onClick={() => addSection('rw')}>
                <Icon name="plus" size={14} /> Reading & Writing
              </button>
            )}
            {!test.sections.some((s) => s.kind === 'math') && (
              <button className="btn btn-sm" onClick={() => addSection('math')}>
                <Icon name="plus" size={14} /> Math
              </button>
            )}
          </div>
          <div className="ed-legend">
            <span><i className="ok" /> has answer</span>
            <span><i className="bad" /> needs fixing</span>
          </div>
        </aside>

        {/* question editor */}
        <section className="ed-main">
          {q && sec && mod ? (
            <QuestionEditor
              key={q.id}
              q={q}
              kind={sec.kind}
              number={sel.q + 1}
              total={mod.questions.length}
              label={`${SECTION_LABEL[sec.kind]} · ${moduleLabel(sec, mod)}`}
              onChange={patchQ}
              onPrev={sel.q > 0 ? () => setSel({ ...sel, q: sel.q - 1 }) : undefined}
              onNext={sel.q < mod.questions.length - 1 ? () => setSel({ ...sel, q: sel.q + 1 }) : undefined}
              onMove={(d) => {
                const to = sel.q + d;
                if (to < 0 || to >= mod.questions.length) return;
                update((t) => {
                  const qs = t.sections[sel.s].modules[sel.m].questions;
                  const [x] = qs.splice(sel.q, 1);
                  qs.splice(to, 0, x);
                });
                setSel({ ...sel, q: to });
              }}
              onDuplicate={() => {
                update((t) => {
                  const qs = t.sections[sel.s].modules[sel.m].questions;
                  const copy: Question = JSON.parse(JSON.stringify(qs[sel.q]));
                  copy.id = uid('q_');
                  copy.choices.forEach((c) => (c.id = uid('c_')));
                  qs.splice(sel.q + 1, 0, copy);
                });
                setSel({ ...sel, q: sel.q + 1 });
              }}
              onDelete={async () => {
                if (await confirmDialog({ title: `Delete question ${sel.q + 1}?`, ok: 'Delete', danger: true })) {
                  update((t) => t.sections[sel.s].modules[sel.m].questions.splice(sel.q, 1));
                  setSel({ ...sel, q: Math.max(0, sel.q - 1) });
                }
              }}
              onAddAfter={() => addQuestion(sel.s, sel.m, sel.q)}
            />
          ) : (
            <div className="card empty">
              <div className="empty-ic">
                <Icon name="edit" size={26} />
              </div>
              <h3>{sec ? 'This module is empty' : 'Add a section to begin'}</h3>
              <p>{sec ? 'Add the first question, or use “Add a test” to import a whole module at once.' : 'Pick Reading & Writing or Math on the left.'}</p>
              {sec && mod && (
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => addQuestion(sel.s, sel.m)}>
                  <Icon name="plus" size={16} /> Add question
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {keyFor && (
        <AnswerKeyModal
          section={test.sections[keyFor.s]}
          module={test.sections[keyFor.s].modules[keyFor.m]}
          onClose={() => setKeyFor(null)}
          onApply={(list) => {
            update((t) => {
              const m = t.sections[keyFor.s].modules[keyFor.m];
              m.questions.forEach((qq, i) => {
                const v = list[i];
                if (!v) return;
                if (/^[A-Da-d]$/.test(v)) {
                  qq.answer = v.toUpperCase();
                  if (qq.type === 'spr') {
                    qq.type = 'mcq';
                    if (qq.choices.length !== 4) qq.choices = LETTERS.slice(0, 4).map(() => ({ id: uid('c_'), text: '' }));
                  }
                } else {
                  qq.type = 'spr';
                  qq.answer = v;
                  qq.answers = [v];
                }
              });
            });
            setKeyFor(null);
            toast('Answer key applied');
          }}
        />
      )}
      {modSettings && (
        <ModuleSettingsModal
          section={test.sections[modSettings.s]}
          module={test.sections[modSettings.s].modules[modSettings.m]}
          onClose={() => setModSettings(null)}
          onSave={(p) => {
            update((t) => Object.assign(t.sections[modSettings.s].modules[modSettings.m], p));
            setModSettings(null);
          }}
          onDelete={() => {
            update((t) => t.sections[modSettings.s].modules.splice(modSettings.m, 1));
            setSel({ s: modSettings.s, m: 0, q: 0 });
            setModSettings(null);
          }}
        />
      )}
      {testSettings && (
        <TestSettingsModal
          test={test}
          onClose={() => setTestSettings(false)}
          onSave={(p) => {
            update((t) => Object.assign(t, p));
            setTestSettings(false);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────── one question ───────────────────────────
function QuestionEditor({
  q,
  kind,
  number,
  total,
  label,
  onChange,
  onPrev,
  onNext,
  onMove,
  onDuplicate,
  onDelete,
  onAddAfter,
}: {
  q: Question;
  kind: SectionKind;
  number: number;
  total: number;
  label: string;
  onChange: (p: Partial<Question>) => void;
  onPrev?: () => void;
  onNext?: () => void;
  onMove: (d: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddAfter: () => void;
}) {
  const [crop, setCrop] = useState(false);
  const [preview, setPreview] = useState<Response>({ changes: 0, marked: false, crossed: [], timeMs: 0, visits: 0 });
  const [split, setSplit] = useState(50);
  const [cross, setCross] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const issues = problems(q);
  const guess = classify(kind, q);

  const setImage = async (src: string) => onChange({ image: await compressImage(src), imagePlacement: q.imagePlacement ?? (kind === 'rw' ? 'passage' : 'question') });

  const onPaste = async (e: React.ClipboardEvent) => {
    const file = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))?.getAsFile();
    if (file) {
      e.preventDefault();
      setImage(await readFileAsDataUrl(file));
    }
  };

  return (
    <div className="ed-q-wrap">
      <div className="card ed-form" onPaste={onPaste}>
        <div className="ed-form-head">
          <div>
            <div className="ed-crumb">{label}</div>
            <h2>
              Question {number} <span className="muted" style={{ fontWeight: 400, fontSize: 15 }}>of {total}</span>
            </h2>
          </div>
          <span className="spacer" />
          <button className="btn btn-ghost btn-icon" disabled={!onPrev} onClick={onPrev} title="Previous">
            <Icon name="chevronLeft" />
          </button>
          <button className="btn btn-ghost btn-icon" disabled={!onNext} onClick={onNext} title="Next">
            <Icon name="chevronRight" />
          </button>
        </div>
        {issues.length > 0 && (
          <div className="ed-issues">
            <Icon name="help" size={15} /> {issues.join(' · ')}
          </div>
        )}

        <div className="row row-wrap" style={{ gap: 14 }}>
          <div className="seg">
            <button
              className={q.type === 'mcq' ? 'on' : ''}
              onClick={() => onChange({ type: 'mcq', choices: q.choices.length === 4 ? q.choices : LETTERS.slice(0, 4).map(() => ({ id: uid('c_'), text: '' })), answer: /^[A-D]$/.test(q.answer) ? q.answer : '' })}
            >
              Multiple choice
            </button>
            <button className={q.type === 'spr' ? 'on' : ''} onClick={() => onChange({ type: 'spr', answer: /^[A-D]$/.test(q.answer) ? '' : q.answer })}>
              Grid-in (student response)
            </button>
          </div>
        </div>

        <div className="field">
          <label>{kind === 'rw' ? 'Passage' : 'Extra text above the question (optional)'}</label>
          <textarea
            className="textarea"
            style={{ minHeight: kind === 'rw' ? 140 : 70 }}
            value={q.passage ?? ''}
            onChange={(e) => onChange({ passage: e.target.value })}
            placeholder={kind === 'rw' ? 'The text shown on the left side…' : 'e.g. a short scenario or a table'}
          />
          <span className="hint">
            <b>**bold**</b> · <i>*italic*</i> · <u>__underline__</u> · ______ blank · <code>$x^2$</code> math · lines starting with “- ” make a list · <code>| a | b |</code> makes a table
          </span>
        </div>

        <div className="field">
          <label>Question</label>
          <textarea className="textarea" style={{ minHeight: 70 }} value={q.prompt} onChange={(e) => onChange({ prompt: e.target.value })} placeholder="Which choice completes the text…" />
        </div>

        <div className="field">
          <label>Image / figure</label>
          {q.image ? (
            <div className="ed-img">
              <img src={q.image} alt="Figure" />
              <div className="stack" style={{ gap: 8 }}>
                {kind === 'rw' ? (
                  <select className="select" value={q.imagePlacement ?? 'passage'} onChange={(e) => onChange({ imagePlacement: e.target.value as Question['imagePlacement'] })}>
                    <option value="passage">Show in the left (passage) pane</option>
                    <option value="question">Show with the question</option>
                  </select>
                ) : (
                  <span className="hint">Shown above the question, like on the real test.</span>
                )}
                <button className="btn btn-sm btn-danger" onClick={() => onChange({ image: undefined })}>
                  <Icon name="trash" size={15} /> Remove image
                </button>
              </div>
            </div>
          ) : (
            <div className="row row-wrap">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => e.target.files?.[0] && setImage(await readFileAsDataUrl(e.target.files[0]))} />
              <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                <Icon name="image" size={15} /> Upload
              </button>
              <button className="btn btn-sm" onClick={() => setCrop(true)}>
                <Icon name="crop" size={15} /> Crop from PDF
              </button>
              <span className="hint">or paste a screenshot anywhere in this card (Ctrl + V)</span>
            </div>
          )}
        </div>

        {q.type === 'mcq' ? (
          <div className="field">
            <label>Answer choices — click the letter of the correct one</label>
            <div className="ed-choices">
              {q.choices.map((c, i) => (
                <div className="ed-choice" key={c.id}>
                  <button className={`ed-choice-letter ${q.answer === LETTERS[i] ? 'on' : ''}`} onClick={() => onChange({ answer: LETTERS[i] })} title="Mark as correct">
                    {q.answer === LETTERS[i] ? <Icon name="check" size={15} stroke={3} /> : LETTERS[i]}
                  </button>
                  <textarea
                    className="textarea"
                    rows={1}
                    value={c.text}
                    placeholder={q.image ? `(optional — the image shows choice ${LETTERS[i]})` : `Choice ${LETTERS[i]}`}
                    onChange={(e) => onChange({ choices: q.choices.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) })}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="field">
            <label>Correct answer(s)</label>
            <input
              className="input"
              value={(q.answers && q.answers.length ? q.answers : q.answer ? [q.answer] : []).join(', ')}
              onChange={(e) => {
                const list = e.target.value.split(/\s*,\s*/).filter((x, i, arr) => x || i === arr.length - 1);
                onChange({ answers: list.filter(Boolean), answer: list.find(Boolean) ?? '' });
              }}
              placeholder="e.g. 7/2, 3.5"
            />
            <span className="hint">Separate equivalent answers with commas. Fractions and decimals are matched automatically (2/3 also accepts .6666, .6667, 0.667…).</span>
          </div>
        )}

        <div className="field">
          <label>Explanation (shown when you review)</label>
          <textarea className="textarea" style={{ minHeight: 70 }} value={q.explanation ?? ''} onChange={(e) => onChange({ explanation: e.target.value })} placeholder="Why the correct answer is right…" />
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Skill</label>
            <select
              className="select"
              value={q.skill ?? ''}
              onChange={(e) => onChange({ skill: e.target.value || undefined, domain: domainOfSkill(kind, e.target.value) })}
            >
              <option value="">Auto: {guess.skill}</option>
              {DOMAINS[kind].map((d) => (
                <optgroup key={d.name} label={d.name}>
                  {d.skills.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Difficulty</label>
            <div className="seg">
              {(['easy', 'medium', 'hard'] as const).map((d) => (
                <button key={d} className={q.difficulty === d ? 'on' : ''} onClick={() => onChange({ difficulty: q.difficulty === d ? undefined : d })}>
                  {d[0].toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="ed-form-foot">
          <button className="btn btn-sm btn-ghost" onClick={() => onMove(-1)} disabled={number === 1}>
            <Icon name="chevronUp" size={15} /> Move up
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => onMove(1)} disabled={number === total}>
            <Icon name="chevronDown" size={15} /> Move down
          </button>
          <button className="btn btn-sm btn-ghost" onClick={onDuplicate}>
            <Icon name="copy" size={15} /> Duplicate
          </button>
          <button className="btn btn-sm btn-ghost btn-danger" onClick={onDelete}>
            <Icon name="trash" size={15} /> Delete
          </button>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={onAddAfter}>
            <Icon name="plus" size={15} /> Add question after
          </button>
        </div>
      </div>

      <div className="ed-preview">
        <div className="ed-preview-label">
          <Icon name="eye" size={15} /> Live preview — exactly how it looks in the test
        </div>
        <div className="ed-preview-frame">
          <div className="rn rn-embed">
            <QuestionView
              q={q}
              kind={kind}
              number={number}
              response={preview}
              crossMode={cross}
              split={split}
              onSplit={setSplit}
              onAnswer={(a) => setPreview((p) => ({ ...p, answer: a }))}
              onCross={(L) => setPreview((p) => ({ ...p, crossed: p.crossed.includes(L) ? p.crossed.filter((x) => x !== L) : [...p.crossed, L] }))}
              onToggleMark={() => setPreview((p) => ({ ...p, marked: !p.marked }))}
              onToggleCrossMode={() => setCross((v) => !v)}
            />
          </div>
        </div>
      </div>
      {crop && <PdfCropper onClose={() => setCrop(false)} onCrop={(u) => setImage(u)} />}
    </div>
  );
}

// ─────────────────────────── modals ───────────────────────────
function AnswerKeyModal({ section, module, onClose, onApply }: { section: Section; module: Module; onClose: () => void; onApply: (list: string[]) => void }) {
  const current = module.questions.map((q, i) => `${i + 1} ${q.answer || '?'}`).join(', ');
  const [text, setText] = useState(current.replace(/\d+ \?(, )?/g, ''));
  const list = parseKeyList(text);
  return (
    <Modal
      title={`Answer key · ${SECTION_LABEL[section.kind]} ${moduleLabel(section, module)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onApply(list)}>
            Apply to {module.questions.length} questions
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginBottom: 10, fontSize: 14 }}>
        Type or paste the answers in order. Numbers are optional: <code>1 B, 2 D, 3 7/2</code> or just <code>B D 7/2</code>. Letters make multiple-choice questions, numbers make grid-ins.
      </p>
      <textarea className="textarea mono" style={{ minHeight: 140 }} autoFocus value={text} onChange={(e) => setText(e.target.value)} />
      <div className="ed-key-preview">
        {module.questions.map((q, i) => (
          <span key={q.id} className={list[i] ? 'set' : q.answer ? 'keep' : 'none'}>
            <b>{i + 1}</b>
            {list[i] ?? q.answer ?? '—'}
          </span>
        ))}
      </div>
    </Modal>
  );
}

function ModuleSettingsModal({ section, module, onClose, onSave, onDelete }: { section: Section; module: Module; onClose: () => void; onSave: (p: Partial<Module>) => void; onDelete: () => void }) {
  const [minutes, setMinutes] = useState(module.minutes);
  const [stage, setStage] = useState(module.stage);
  const [variant, setVariant] = useState(module.variant);
  return (
    <Modal
      title={`${SECTION_LABEL[section.kind]} · ${moduleLabel(section, module)}`}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-danger"
            style={{ marginRight: 'auto' }}
            onClick={async () => {
              if (await confirmDialog({ title: 'Delete this module?', body: `${module.questions.length} questions will be removed.`, ok: 'Delete', danger: true })) onDelete();
            }}
          >
            <Icon name="trash" size={15} /> Delete module
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onSave({ minutes, stage, variant: stage === 1 ? 'standard' : variant })}>
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <label>Time limit (minutes)</label>
          <input className="input" type="number" min={1} max={180} value={minutes} onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))} />
          <span className="hint">
            Real SAT: {section.kind === 'rw' ? '32 minutes for 27 questions' : '35 minutes for 22 questions'}. Suggested for {module.questions.length} questions:{' '}
            <b>{Math.max(1, Math.round(module.questions.length * (section.kind === 'rw' ? 32 / 27 : 35 / 22)))} min</b>
          </span>
        </div>
        <div className="field">
          <label>Module</label>
          <div className="seg">
            <button className={stage === 1 ? 'on' : ''} onClick={() => setStage(1)}>
              Module 1
            </button>
            <button className={stage === 2 ? 'on' : ''} onClick={() => setStage(2)}>
              Module 2
            </button>
          </div>
        </div>
        {stage === 2 && (
          <div className="field">
            <label>Adaptive version</label>
            <select className="select" value={variant} onChange={(e) => setVariant(e.target.value as Module['variant'])}>
              <option value="standard">Only version (not adaptive)</option>
              <option value="harder">Harder Module 2 — for strong Module 1 performance</option>
              <option value="easier">Easier Module 2 — caps the score, like the real test</option>
            </select>
          </div>
        )}
      </div>
    </Modal>
  );
}

function TestSettingsModal({ test, onClose, onSave }: { test: Test; onClose: () => void; onSave: (p: Partial<Test>) => void }) {
  const [desc, setDesc] = useState(test.description ?? '');
  const [brk, setBrk] = useState(test.breakMinutes);
  const [thr, setThr] = useState(Math.round(test.routingThreshold * 100));
  const adaptive = test.sections.some((s) => s.modules.filter((m) => m.stage === 2).length > 1);
  return (
    <Modal
      title="Test settings"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onSave({ description: desc.trim() || undefined, breakMinutes: brk, routingThreshold: thr / 100 })}>
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <label>Description</label>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. From Mr. Karimov, November mock" />
        </div>
        <div className="field">
          <label>Break between sections (minutes)</label>
          <input className="input" type="number" min={0} max={30} value={brk} onChange={(e) => setBrk(Math.max(0, Number(e.target.value) || 0))} />
          <span className="hint">The real SAT gives a 10-minute break. Set 0 to skip it.</span>
        </div>
        <div className="field">
          <label>Adaptive routing: Module 1 score needed for the harder Module 2 — {thr}%</label>
          <input type="range" min={30} max={90} step={5} value={thr} onChange={(e) => setThr(Number(e.target.value))} disabled={!adaptive} />
          <span className="hint">{adaptive ? 'Only used by sections that have both a harder and an easier Module 2.' : 'Add an easier Module 2 in a section (“Make adaptive”) to use this.'}</span>
        </div>
      </div>
    </Modal>
  );
}
