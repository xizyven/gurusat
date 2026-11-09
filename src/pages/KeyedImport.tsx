// Upload a test whose correct answers are highlighted → sealed mock, straight into the test. No preview.
import { useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Logo } from '../components/ui';
import { createAttempt, testStats } from '../lib/attempt';
import { db } from '../lib/db';
import { buildKeyedTest, docxLines, pdfLines, type KeyedReport } from '../lib/keyed';
import { navigate, useSettings } from '../lib/store';
import type { Test } from '../lib/types';

export function KeyedImport({ title, setTitle }: { title: string; setTitle: (t: string) => void }) {
  const [settings] = useSettings();
  const [phase, setPhase] = useState<'pick' | 'reading' | 'done' | 'error'>('pick');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [test, setTest] = useState<Test | null>(null);
  const [report, setReport] = useState<KeyedReport | null>(null);
  const [saved, setSaved] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async (f?: File) => {
    if (!f) return;
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    const isDocx = /\.docx$/i.test(f.name) || f.type.includes('wordprocessingml');
    if (!isPdf && !isDocx) {
      setError(/\.doc$/i.test(f.name) ? 'Old .doc files aren’t supported — open it in Word and “Save as” .docx, or export a PDF.' : 'Choose a PDF or a Word (.docx) file.');
      setPhase('error');
      return;
    }
    const name = title.trim() || f.name.replace(/\.(pdf|docx)$/i, '');
    if (!title.trim()) setTitle(name);
    setPhase('reading');
    setProgress(0);
    setSaved(false);
    try {
      const src = isPdf ? await pdfLines(f, setProgress) : { ...(await docxLines(f)), scanned: false };
      const { test: t, report: r } = buildKeyedTest(src.lines, src.figures, { title: name, source: f.name, scanned: src.scanned });
      setReport(r);
      if (!t) {
        setError(
          r.scanned
            ? 'This PDF is a scanned image, so its text and highlights can’t be read. Ask for the original Word file or a text PDF.'
            : 'No numbered questions were found in this file. Questions should start with their number (“1.”, “1)” or “Question 1”).',
        );
        setPhase('error');
        return;
      }
      setTest(t);
      // only save automatically when the answer key was found — otherwise let the student decide
      if (r.keyed > 0) {
        await db.putTest(t);
        setSaved(true);
      }
      setPhase('done');
    } catch (e) {
      console.error(e);
      setError((e as Error).message || 'That file couldn’t be read.');
      setPhase('error');
    }
  };

  const begin = async () => {
    if (!test) return;
    if (!saved) await db.putTest(test);
    const a = await createAttempt(test, settings.defaultTiming);
    navigate(`/test/${a.id}`);
  };

  if (phase === 'reading')
    return (
      <div className="aib-run">
        <div className="aib-run-head">
          <div className="aib-spin">
            <Logo variant="mark" height={40} />
          </div>
          <div>
            <h3>Reading your test…</h3>
            <p className="muted">Finding every question and the highlighted answer. Nothing is shown to you and nothing leaves your computer.</p>
          </div>
        </div>
        <div className="tr-bar" style={{ width: '100%', margin: '8px 0' }}>
          <span style={{ width: `${Math.round(progress * 100)}%`, animation: 'none', transition: 'width .3s' }} />
        </div>
      </div>
    );

  if (phase === 'done' && test && report) {
    const st = testStats(test);
    const pct = report.questions ? report.keyed / report.questions : 0;
    return (
      <div className="aib-ready">
        <div className="aib-ready-badge" style={pct < 0.5 ? { background: 'var(--amber)' } : undefined}>
          <Icon name={pct < 0.5 ? 'help' : 'check'} size={30} stroke={2.6} />
        </div>
        <h2>{pct < 0.5 ? 'Answer key not found' : 'Your mock is ready'}</h2>
        <p className="muted">
          <b>{test.title}</b> — {pct < 0.5 ? 'the questions were found, but most highlighted answers weren’t.' : 'answers are sealed until you finish.'}
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
          <div>
            <b>Answer key</b>
            <span>
              {report.keyed} of {report.questions} found
            </span>
          </div>
        </div>
        {report.missing.length > 0 && (
          <p className="keyed-note">
            <Icon name="help" size={15} /> No highlighted answer for {report.missing.length === 1 ? 'one question' : `${report.missing.length} questions`} ({report.missing.slice(0, 8).join(', ')}
            {report.missing.length > 8 ? '…' : ''}). {pct < 0.5 ? 'Make sure the correct choices are highlighted, colored or bold in the file.' : 'They’ll be in the test but won’t count toward your score.'}
          </p>
        )}
        {report.figureWarnings.length > 0 && (
          <p className="keyed-note">
            <Icon name="image" size={15} /> {report.figureWarnings.length === 1 ? 'One question mentions' : `${report.figureWarnings.length} questions mention`} a graph or figure that couldn’t be found in the file ({report.figureWarnings.slice(0, 6).join(', ')}
            {report.figureWarnings.length > 6 ? '…' : ''}).
          </p>
        )}
        <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button
            className="btn"
            onClick={() => {
              setPhase('pick');
              setTest(null);
            }}
          >
            Upload another file
          </button>
          {saved && (
            <button className="btn" onClick={() => navigate('/tests')}>
              Take it later
            </button>
          )}
          <button className="btn btn-primary btn-lg" onClick={begin}>
            <Icon name="play" size={15} fill="currentColor" /> {pct < 0.5 ? 'Take it anyway' : 'Begin test now'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="aib">
      {phase === 'error' && (
        <div className="aib-error">
          <Icon name="help" size={18} />
          <div>{error}</div>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={(e) => load(e.target.files?.[0])} />
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
          <Icon name="upload" size={26} />
        </div>
        <h3>Drop the test file here</h3>
        <p>Word (.docx) or PDF, with the correct answers highlighted. You go straight to the test — no preview.</p>
      </div>
      <ul className="aib-promises" style={{ marginTop: 4 }}>
        <li>
          <Icon name="eyeOff" size={15} /> You never see the questions or answers before the test
        </li>
        <li>
          <Icon name="check" size={15} /> Highlighted, colored or bold choices are taken as the correct answer
        </li>
        <li>
          <Icon name="shield" size={15} /> Free — the file is read on your computer and never uploaded
        </li>
      </ul>
    </div>
  );
}
