// Upload a questions-only mock → Claude solves and explains it → straight into the test.
// The student never sees a question or an answer before taking the test.
import { useEffect, useRef, useState } from 'react';
import { ApiKeyCard } from '../components/ApiKey';
import { Icon } from '../components/Icon';
import { loadPdfPages } from '../components/PdfCropper';
import { Logo, toast } from '../components/ui';
import { AiError, buildMock, fileToBase64, PARTS, type AiEffort, type AiSource, type BuildProgress } from '../lib/ai';
import { createAttempt, testStats } from '../lib/attempt';
import { db } from '../lib/db';
import { navigate, useSettings } from '../lib/store';
import type { Test } from '../lib/types';
import { compressImage, fmtClock, readFileAsDataUrl } from '../lib/util';

type Picked = { kind: 'pdf'; file: File } | { kind: 'images'; images: string[]; name: string } | { kind: 'text'; text: string };

const EFFORT_LABEL: Record<AiEffort, string> = {
  medium: 'Fast — cheaper, very good',
  high: 'Careful — recommended',
  max: 'Maximum — slowest, most careful',
};

export function AiBuilder({ title, setTitle }: { title: string; setTitle: (t: string) => void }) {
  const [settings, save] = useSettings();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState<'pick' | 'preparing' | 'building' | 'ready' | 'error'>('pick');
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [error, setError] = useState<AiError | null>(null);
  const [test, setTest] = useState<Test | null>(null);
  const [started, setStarted] = useState(0);
  const [, tick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // bring the progress / ready panel into view
  useEffect(() => {
    if (phase === 'building' || phase === 'ready' || phase === 'error')
      requestAnimationFrame(() => document.querySelector('.aib-run, .aib-ready, .aib-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [phase]);

  // keep the clock moving while building, and warn before closing the tab
  useEffect(() => {
    if (phase !== 'building' && phase !== 'preparing') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      clearInterval(t);
      window.removeEventListener('beforeunload', warn);
    };
  }, [phase]);

  const addFiles = async (files: FileList | File[] | null | undefined) => {
    if (!files?.length) return;
    const list = Array.from(files);
    const pdf = list.find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (pdf) {
      setPicked({ kind: 'pdf', file: pdf });
      if (!title) setTitle(pdf.name.replace(/\.pdf$/i, ''));
      return;
    }
    const imgs = list.filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return toast('Choose a PDF or images');
    const urls = await Promise.all(imgs.map(async (f) => compressImage(await readFileAsDataUrl(f), 1600)));
    setPicked((p) => (p?.kind === 'images' ? { ...p, images: [...p.images, ...urls] } : { kind: 'images', images: urls, name: imgs[0].name.replace(/\.[a-z]+$/i, '') }));
  };

  useEffect(() => {
    if (phase !== 'pick') return;
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
  }, [phase]);

  const build = async () => {
    const choice: Picked | null = textMode ? (text.trim() ? { kind: 'text', text } : null) : picked;
    if (!choice) return;
    setError(null);
    setPhase('preparing');
    setStarted(Date.now());
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      let src: AiSource;
      if (choice.kind === 'pdf') {
        const pages = await loadPdfPages(choice.file);
        // very large PDFs go as page images instead (request size limit)
        src =
          choice.file.size > 24 * 1024 * 1024
            ? { kind: 'images', name: choice.file.name, images: await Promise.all(pages.slice(0, 100).map((p) => compressImage(p, 1500))) }
            : { kind: 'pdf', name: choice.file.name, base64: await fileToBase64(choice.file), pages };
      } else if (choice.kind === 'images') {
        src = { kind: 'images', name: choice.name, images: choice.images };
      } else {
        src = { kind: 'text', name: 'pasted text', text: choice.text };
      }
      setPhase('building');
      const t = await buildMock(src, { title, effort: settings.aiEffort, signal: ac.signal, onProgress: setProgress });
      await db.putTest(t);
      setTest(t);
      setPhase('ready');
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError('other', (e as Error).message);
      if (err.code === 'cancelled') {
        setPhase('pick');
        toast('Build cancelled');
        return;
      }
      setError(err);
      setPhase('error');
    }
  };

  const begin = async () => {
    if (!test) return;
    const a = await createAttempt(test, settings.defaultTiming);
    navigate(`/test/${a.id}`);
  };

  // ───────── no key yet ─────────
  if (!settings.apiKey) {
    return (
      <div className="aib">
        <div className="aib-intro">
          <div className="aib-intro-ic">
            <Icon name="sparkle" size={22} />
          </div>
          <div>
            <h3>Connect the AI once</h3>
            <p>
              GuruSat uses <b>Claude</b>, Anthropic's AI, to solve your teacher's questions and write explanations. It runs with your own Anthropic API key, which takes about two minutes to set up.
            </p>
          </div>
        </div>
        <ApiKeyCard />
      </div>
    );
  }

  // ───────── building ─────────
  if (phase === 'preparing' || phase === 'building') {
    const elapsed = Date.now() - started;
    return (
      <div className="aib-run">
        <div className="aib-run-head">
          <div className="aib-spin">
            <Logo variant="mark" height={40} />
          </div>
          <div>
            <h3>{phase === 'preparing' ? 'Preparing your file…' : 'Claude is building your mock'}</h3>
            <p className="muted">
              Reading every question, solving it and writing explanations. Usually 5–12 minutes — keep this tab open. You won't see any questions until the test starts.
            </p>
          </div>
          <span className="spacer" />
          <div className="aib-clock">{fmtClock(elapsed)}</div>
        </div>
        <div className="aib-parts">
          {PARTS.map((p, i) => {
            const s = progress?.parts[i] ?? { state: 'waiting', count: 0 };
            return (
              <div className={`aib-part ${s.state}`} key={p.label}>
                <span className="aib-part-ic">
                  {s.state === 'done' ? <Icon name="check" size={16} stroke={2.6} /> : s.state === 'error' ? <Icon name="x" size={16} stroke={2.6} /> : s.state === 'empty' ? <Icon name="minus" size={16} /> : <span className="aib-dot" />}
                </span>
                <div className="aib-part-name">{p.label}</div>
                <div className="aib-part-state">
                  {s.state === 'waiting' && 'Waiting'}
                  {s.state === 'reading' && 'Reading the document…'}
                  {s.state === 'solving' && 'Solving…'}
                  {s.state === 'writing' && `Writing up — ${s.count} question${s.count === 1 ? '' : 's'}`}
                  {s.state === 'done' && `${s.count} questions ready`}
                  {s.state === 'empty' && 'Not in this file'}
                  {s.state === 'error' && (s.error || 'Failed')}
                </div>
              </div>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {progress && progress.costUsd > 0 ? `Cost so far ≈ $${progress.costUsd.toFixed(2)}` : `Using ${EFFORT_LABEL[settings.aiEffort].split(' — ')[0].toLowerCase()} mode`}
          </span>
          <span className="spacer" />
          <button className="btn btn-danger" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ───────── ready ─────────
  if (phase === 'ready' && test) {
    const st = testStats(test);
    return (
      <div className="aib-ready">
        <div className="aib-ready-badge">
          <Icon name="check" size={30} stroke={2.6} />
        </div>
        <h2>Your mock is ready</h2>
        <p className="muted">
          <b>{test.title}</b> — answers and explanations are sealed until you finish.
        </p>
        <div className="aib-ready-stats">
          {test.sections.map((s) => (
            <div key={s.id}>
              <b>{s.kind === 'rw' ? 'Reading & Writing' : 'Math'}</b>
              <span>{s.modules.map((m) => `M${m.stage}: ${m.questions.length}`).join(' · ')}</span>
            </div>
          ))}
          <div>
            <b>Total</b>
            <span>
              {st.questions} questions · {st.minutes} min
            </span>
          </div>
        </div>
        {test.aiCostUsd !== undefined && <p className="hint">Built for about ${test.aiCostUsd.toFixed(2)} of Anthropic credit.</p>}
        <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 18 }}>
          <button className="btn" onClick={() => navigate('/tests')}>
            Take it later
          </button>
          <button className="btn btn-primary btn-lg" onClick={begin}>
            <Icon name="play" size={15} fill="currentColor" /> Begin test now
          </button>
        </div>
      </div>
    );
  }

  // ───────── pick a file ─────────
  return (
    <div className="aib">
      {phase === 'error' && error && (
        <div className="aib-error">
          <Icon name="help" size={18} />
          <div>
            <b>The mock couldn't be built.</b> {error.message}
          </div>
          {(error.code === 'bad-key' || error.code === 'missing-key') && (
            <button className="btn btn-sm" onClick={() => save({ apiKey: '' })}>
              Re-enter key
            </button>
          )}
        </div>
      )}
      <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />

      {!textMode ? (
        picked && picked.kind !== 'text' ? (
          <div className="aib-file">
            <div className="aib-file-ic">
              <Icon name={picked.kind === 'pdf' ? 'file' : 'image'} size={24} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{picked.kind === 'pdf' ? picked.file.name : `${picked.images.length} screenshot${picked.images.length > 1 ? 's' : ''}`}</b>
              <div className="muted" style={{ fontSize: 13 }}>
                {picked.kind === 'pdf' ? `${(picked.file.size / 1024 / 1024).toFixed(1)} MB PDF` : 'Paste more with Ctrl + V to add pages'}
              </div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => setPicked(null)}>
              Change
            </button>
          </div>
        ) : (
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
              <Icon name="sparkle" size={26} />
            </div>
            <h3>Drop the teacher's file here</h3>
            <p>A PDF (even scanned), or screenshots — paste them with Ctrl + V. Questions only is fine: the AI finds the answers.</p>
          </div>
        )
      ) : (
        <textarea className="textarea mono" style={{ minHeight: 220 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the questions here…" />
      )}
      <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setTextMode((v) => !v)}>
        <Icon name={textMode ? 'file' : 'text'} size={15} /> {textMode ? 'Upload a file instead' : 'Paste text instead'}
      </button>

      <div className="aib-opts">
        <div className="field">
          <label>Solving mode</label>
          <select className="select" value={settings.aiEffort} onChange={(e) => save({ aiEffort: e.target.value as AiEffort })}>
            {(Object.keys(EFFORT_LABEL) as AiEffort[]).map((k) => (
              <option key={k} value={k}>
                {EFFORT_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <ul className="aib-promises">
          <li>
            <Icon name="eyeOff" size={15} /> You won't see questions or answers before the test
          </li>
          <li>
            <Icon name="lightbulb" size={15} /> Every question gets an answer, explanation and skill tag
          </li>
          <li>
            <Icon name="clock" size={15} /> About 5–12 minutes, ≈ $2–4 per full mock
          </li>
        </ul>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary btn-lg" disabled={textMode ? !text.trim() : !picked} onClick={build}>
          <Icon name="sparkle" size={17} /> Build my mock
        </button>
      </div>
    </div>
  );
}
