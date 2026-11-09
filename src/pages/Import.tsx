import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { PdfCropper, pdfSession } from '../components/PdfCropper';
import { Spinner, toast } from '../components/ui';
import { AiBuilder } from './AiBuilder';
import { KeyedImport } from './KeyedImport';
import { db, restoreBackup, type Backup } from '../lib/db';
import { normalizeTest } from '../lib/normalize';
import { parseKeyList, parseText, type ParseResult } from '../lib/parser';
import { openPdf, pdfText } from '../lib/pdf';
import { navigate } from '../lib/store';
import type { Module, Question, Section, SectionKind, Test } from '../lib/types';
import { compressImage, readFileAsDataUrl, readFileAsText, uid } from '../lib/util';

type Method = 'keyed' | 'ai' | 'text' | 'pdf' | 'shots' | 'json';

const SAMPLE = `Reading and Writing — Module 1

1
In 1928, Alexander Fleming noticed that mold growing in a dish had ______ the bacteria around it, a chance observation that led to penicillin.
Which choice completes the text with the most logical and precise word or phrase?
A) destroyed
B) nourished
C) imitated
D) ignored

2
...

Math — Module 1

1. If 3x + 5 = 20, what is the value of x?
A) 3
B) 5
C) 15
D) 25

2. What is the value of 2/5 + 1/10 ?

Answer Key
Reading and Writing Module 1: 1. A  2. C ...
Math Module 1: 1. B  2. 1/2 ...`;

export function newTest(title: string, sections: Section[], source?: string): Test {
  const now = Date.now();
  return { id: uid('t_'), title: title.trim() || 'Untitled mock test', createdAt: now, updatedAt: now, sections, breakMinutes: 10, routingThreshold: 0.6, source };
}

export default function ImportPage() {
  const [method, setMethod] = useState<Method>('keyed');
  const [title, setTitle] = useState('');

  return (
    <>
      <div className="ph">
        <div>
          <h1>Add a test</h1>
          <p>Upload the test file with the correct answers highlighted. GuruSat reads the key, hides everything, and takes you straight into the test.</p>
        </div>
        <div className="ph-actions">
          <button
            className="btn"
            onClick={async () => {
              const t = newTest(title || 'New test', [
                { id: uid('s_'), kind: 'rw', modules: [{ id: uid('m_'), stage: 1, variant: 'standard', minutes: 32, questions: [] }] },
              ]);
              await db.putTest(t);
              navigate(`/edit/${t.id}`);
            }}
          >
            <Icon name="edit" size={17} /> Start from scratch
          </button>
        </div>
      </div>

      <button className={`method method-ai ${method === 'keyed' ? 'on' : ''}`} onClick={() => setMethod('keyed')}>
        <span className="method-ic">
          <Icon name="upload" size={22} />
        </span>
        <div>
          <b>
            Upload a test with highlighted answers <span className="badge badge-green">Recommended</span>
          </b>
          <span>Word or PDF where the correct choices are highlighted (or colored / bold). Free, instant, and you never see a preview — straight to the test.</span>
        </div>
      </button>
      <div className="method-sub">Other ways to add a test:</div>
      <div className="method-grid">
        {(
          [
            ['ai', 'sparkle', 'AI solves it', 'No answers in the file? Claude solves it with your own API key (≈ $2–4 per mock).'],
            ['text', 'text', 'Paste text', 'Copy from a PDF, Word file or website and paste it in.'],
            ['pdf', 'file', 'Upload a PDF', 'Reads the text for you. Crop graphs straight from the pages.'],
            ['shots', 'image', 'Screenshots', 'Paste or drop images of each question — works for anything.'],
            ['json', 'json', 'GuruSat file', 'Import a .json test or a full backup from another device.'],
          ] as [Method, string, string, string][]
        ).map(([m, ic, t, d]) => (
          <button key={m} className={`method ${method === m ? 'on' : ''}`} onClick={() => setMethod(m)}>
            <span className="method-ic">
              <Icon name={ic} size={20} />
            </span>
            <b>{t}</b>
            <span>{d}</span>
          </button>
        ))}
      </div>

      <div className="card card-pad">
        <div className="field" style={{ marginBottom: 18, maxWidth: 520 }}>
          <label>Test name</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mock Exam #3 — November" />
        </div>
        {method === 'keyed' && <KeyedImport title={title} setTitle={setTitle} />}
        {method === 'ai' && <AiBuilder title={title} setTitle={setTitle} />}
        {method === 'text' && <TextImport title={title} />}
        {method === 'pdf' && <PdfImport title={title} setTitle={setTitle} />}
        {method === 'shots' && <ShotsImport title={title} />}
        {method === 'json' && <JsonImport />}
      </div>
    </>
  );
}

// ─────────────────────────── text ───────────────────────────
function ParsePreview({ result, onCreate, busy }: { result: ParseResult; onCreate: () => void; busy?: boolean }) {
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      <div className="parse-summary">
        <Icon name="sparkle" size={18} style={{ color: 'var(--g-600)' }} />
        Found <b>{result.questionCount}</b> questions in
        {result.sections.map((s) => (
          <span key={s.id} className="badge badge-green">
            {s.kind === 'rw' ? 'Reading & Writing' : 'Math'} · {s.modules.length} module{s.modules.length > 1 ? 's' : ''}
          </span>
        ))}
        <span className="badge">{result.answered} with answers</span>
        <span className="spacer" />
        <button className="btn btn-primary" disabled={!result.questionCount || busy} onClick={onCreate}>
          Create test & review <Icon name="arrowRight" size={16} />
        </button>
      </div>
      {result.warnings.length > 0 && (
        <ul className="warn-list">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TextImport({ title }: { title: string }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'auto' | SectionKind>('auto');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if (!text.trim()) return setResult(null);
    const t = setTimeout(() => setResult(parseText(text, kind === 'auto' ? undefined : kind)), 300);
    return () => clearTimeout(t);
  }, [text, kind]);

  const create = async () => {
    if (!result) return;
    const t = newTest(title, result.sections, 'text');
    await db.putTest(t);
    toast(`Created “${t.title}”`);
    navigate(`/edit/${t.id}`);
  };

  return (
    <div className="stack">
      <div className="row row-wrap">
        <span className="label">Section</span>
        <div className="seg">
          {(['auto', 'rw', 'math'] as const).map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {k === 'auto' ? 'Detect automatically' : k === 'rw' ? 'Reading & Writing' : 'Math'}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={() => setHelp((v) => !v)}>
          <Icon name="help" size={16} /> What format works?
        </button>
      </div>
      {help && (
        <div className="format-help">
          Almost anything numbered works. Headers like <b>“Reading and Writing — Module 1”</b> split the test into modules, and an <b>“Answer Key”</b> at the end (or “Answer: B” under each question) fills in the answers. Math with no A–D choices becomes a grid-in question. Use <code>$x^2$</code> for formulas.
          <pre>{SAMPLE}</pre>
        </div>
      )}
      <textarea
        className="textarea mono"
        style={{ minHeight: 320 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the questions here (Ctrl + V)…"
      />
      {result && <ParsePreview result={result} onCreate={create} />}
    </div>
  );
}

// ─────────────────────────── PDF ───────────────────────────
function PdfImport({ title, setTitle }: { title: string; setTitle: (t: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [scanned, setScanned] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async (f?: File) => {
    if (!f) return;
    if (!title) setTitle(f.name.replace(/\.pdf$/i, ''));
    setBusy('Reading the PDF…');
    setResult(null);
    try {
      const doc = await openPdf(f);
      const { text: t, textChars } = await pdfText(doc, (p) => setBusy(`Reading text… ${Math.round(p * 100)}%`));
      pdfSession.name = f.name;
      pdfSession.pages = [];
      // render pages for cropping in the background
      (async () => {
        const { renderPage } = await import('../lib/pdf');
        const pages: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) pages.push(await renderPage(doc, i, 2));
        pdfSession.pages = pages;
      })();
      const isScanned = textChars < 60 * doc.numPages;
      setScanned(isScanned);
      setText(t);
      if (!isScanned) setResult(parseText(t));
    } catch (e) {
      toast('Could not read that PDF');
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!result) return;
    const t = newTest(title, result.sections, 'pdf');
    await db.putTest(t);
    toast(`Created “${t.title}”`);
    navigate(`/edit/${t.id}`);
  };

  if (busy) return <Spinner label={busy} />;

  return (
    <div className="stack">
      <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => load(e.target.files?.[0])} />
      {!text && (
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            load(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="dropzone-ic">
            <Icon name="file" size={26} />
          </div>
          <h3>Drop the PDF here or click to choose</h3>
          <p>Everything happens in your browser — the file is never uploaded anywhere.</p>
        </div>
      )}
      {text && scanned && (
        <div className="parse-summary" style={{ background: 'var(--amber-50)', borderColor: '#f3dea9' }}>
          <Icon name="image" size={18} style={{ color: 'var(--amber)' }} />
          This PDF looks scanned (it has almost no selectable text). Use <b>Screenshots</b> mode — you can crop each question straight from these pages.
        </div>
      )}
      {text && !scanned && (
        <>
          <div className="row">
            <span className="label">Text found in the PDF — fix anything odd, the preview updates live</span>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              Different file
            </button>
          </div>
          <textarea
            className="textarea mono"
            style={{ minHeight: 300 }}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setResult(parseText(e.target.value));
            }}
          />
          {result && <ParsePreview result={result} onCreate={create} />}
          <p className="hint">Graphs and tables inside the PDF don't come through as text — after creating the test, use “Add image → Crop from PDF” on those questions.</p>
        </>
      )}
    </div>
  );
}

// ─────────────────────────── screenshots ───────────────────────────
interface Shot {
  id: string;
  src: string;
  kind: SectionKind;
  module: 1 | 2;
  type: 'mcq' | 'spr';
  answer: string;
}

function ShotsImport({ title }: { title: string }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [over, setOver] = useState(false);
  const [crop, setCrop] = useState(false);
  const [key, setKey] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<Pick<Shot, 'kind' | 'module' | 'type'>>({ kind: 'rw', module: 1, type: 'mcq' });

  const add = async (src: string) => {
    const small = await compressImage(src);
    setShots((s) => [...s, { id: uid('sh'), src: small, ...lastRef.current, answer: '' }]);
  };
  const addFiles = async (files: FileList | File[] | null | undefined) => {
    if (!files) return;
    for (const f of Array.from(files)) if (f.type.startsWith('image/')) await add(await readFileAsDataUrl(f));
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((i) => i.type.startsWith('image/'))
        .map((i) => i.getAsFile())
        .filter(Boolean) as File[];
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (id: string, p: Partial<Shot>) => {
    setShots((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const cur = shots.find((x) => x.id === id);
    if (cur) lastRef.current = { kind: p.kind ?? cur.kind, module: p.module ?? cur.module, type: p.type ?? cur.type };
  };

  const applyKey = () => {
    const list = parseKeyList(key);
    setShots((s) =>
      s.map((x, i) => {
        const v = list[i];
        if (!v) return x;
        const isLetter = /^[A-Da-d]$/.test(v);
        return { ...x, answer: isLetter ? v.toUpperCase() : v, type: isLetter ? 'mcq' : 'spr' };
      }),
    );
    toast(`Applied ${list.filter(Boolean).length} answers`);
  };

  const create = async () => {
    const sections: Section[] = [];
    for (const kind of ['rw', 'math'] as SectionKind[]) {
      const mods: Module[] = [];
      for (const stage of [1, 2] as const) {
        const qs: Question[] = shots
          .filter((s) => s.kind === kind && s.module === stage)
          .map((s) => ({
            id: uid('q_'),
            type: s.type,
            prompt: '',
            image: s.src,
            imagePlacement: 'question',
            choices: s.type === 'mcq' ? ['A', 'B', 'C', 'D'].map(() => ({ id: uid('c_'), text: '' })) : [],
            answer: s.answer,
            answers: s.type === 'spr' && s.answer ? s.answer.split(/\s*(?:,|\bor\b)\s*/) : undefined,
          }));
        if (qs.length) mods.push({ id: uid('m_'), stage, variant: 'standard', minutes: Math.max(1, Math.round(qs.length * (kind === 'rw' ? 32 / 27 : 35 / 22))), questions: qs });
      }
      if (mods.length) {
        if (!mods.some((m) => m.stage === 1)) mods[0].stage = 1;
        sections.push({ id: uid('s_'), kind, modules: mods });
      }
    }
    const t = newTest(title, sections, 'screenshots');
    await db.putTest(t);
    toast(`Created “${t.title}”`);
    navigate(`/edit/${t.id}`);
  };

  return (
    <div className="stack">
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <div className="dropzone-ic">
          <Icon name="image" size={26} />
        </div>
        <h3>Paste a screenshot with Ctrl + V, or drop images here</h3>
        <p>
          Tip: press <span className="kbd">Win</span> + <span className="kbd">Shift</span> + <span className="kbd">S</span>, snip one question, then paste. Repeat for each question.
        </p>
      </div>
      <div className="row row-wrap">
        <button className="btn" onClick={() => setCrop(true)}>
          <Icon name="crop" size={17} /> Crop questions from a PDF
        </button>
        <span className="spacer" />
        {shots.length > 0 && <span className="muted" style={{ fontSize: 13 }}>{shots.length} questions · {shots.filter((s) => s.answer).length} with answers</span>}
      </div>

      {shots.length > 0 && (
        <>
          <div className="field">
            <label>Answer key (optional) — answers in order, e.g. “1 B, 2 D, 3 7/2 …”</label>
            <div className="row">
              <input className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="B D A C 7/2 …" />
              <button className="btn" onClick={applyKey} disabled={!key.trim()}>
                Apply
              </button>
            </div>
          </div>
          <div className="shot-list">
            {shots.map((s, i) => (
              <div className="shot" key={s.id}>
                <img src={s.src} alt={`Question ${i + 1}`} />
                <div className="shot-body">
                  <div className="row">
                    <b style={{ fontSize: 13 }}>#{i + 1}</b>
                    <select className="select" style={{ padding: '4px 8px', fontSize: 12.5 }} value={`${s.kind}-${s.module}`} onChange={(e) => {
                      const [k, m] = e.target.value.split('-');
                      patch(s.id, { kind: k as SectionKind, module: Number(m) as 1 | 2 });
                    }}>
                      <option value="rw-1">R&W · Module 1</option>
                      <option value="rw-2">R&W · Module 2</option>
                      <option value="math-1">Math · Module 1</option>
                      <option value="math-2">Math · Module 2</option>
                    </select>
                    <button className="btn btn-ghost btn-icon btn-danger" title="Remove" onClick={() => setShots((x) => x.filter((y) => y.id !== s.id))}>
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  <div className="row">
                    <div className="seg">
                      <button className={s.type === 'mcq' ? 'on' : ''} onClick={() => patch(s.id, { type: 'mcq', answer: /^[A-D]$/.test(s.answer) ? s.answer : '' })}>
                        A–D
                      </button>
                      <button className={s.type === 'spr' ? 'on' : ''} onClick={() => patch(s.id, { type: 'spr', answer: /^[A-D]$/.test(s.answer) ? '' : s.answer })}>
                        Grid-in
                      </button>
                    </div>
                  </div>
                  {s.type === 'mcq' ? (
                    <div className="answer-pills">
                      {['A', 'B', 'C', 'D'].map((L) => (
                        <button key={L} className={s.answer === L ? 'on' : ''} onClick={() => patch(s.id, { answer: L })}>
                          {L}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input className="input" placeholder="Correct answer, e.g. 7/2 or 3.5" value={s.answer} onChange={(e) => patch(s.id, { answer: e.target.value })} />
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-lg" onClick={create}>
              Create test & review <Icon name="arrowRight" size={16} />
            </button>
          </div>
        </>
      )}
      {crop && <PdfCropper multi title="Crop each question" onClose={() => setCrop(false)} onCrop={(u) => add(u)} />}
    </div>
  );
}

// ─────────────────────────── JSON ───────────────────────────
function JsonImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const load = async (f?: File) => {
    if (!f) return;
    setError('');
    try {
      const data = JSON.parse(await readFileAsText(f));
      if (data?.app === 'gurusat' && Array.isArray(data.tests)) {
        const r = await restoreBackup(data as Backup);
        toast(`Restored ${r.tests} tests and ${r.attempts} results`);
        navigate('/tests');
        return;
      }
      const test: Test = normalizeTest(data, f.name.replace(/\.(gurusat\.)?json$/i, ''));
      await db.putTest(test);
      toast(`Imported “${test.title}”`);
      navigate(`/edit/${test.id}`);
    } catch (e) {
      setError((e as Error).message || 'That file could not be read.');
    }
  };
  return (
    <div className="stack">
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => load(e.target.files?.[0])} />
      <button className="dropzone" onClick={() => fileRef.current?.click()}>
        <div className="dropzone-ic">
          <Icon name="json" size={26} />
        </div>
        <h3>Choose a .json file</h3>
        <p>A test exported from GuruSat (My Tests → download), or a full backup from Settings.</p>
      </button>
      {error && <div className="badge badge-red" style={{ height: 'auto', padding: '8px 12px' }}>{error}</div>}
    </div>
  );
}
