import { Icon } from '../components/Icon';
import { confirmDialog, Spinner, toast } from '../components/ui';
import { createAttempt, testStats } from '../lib/attempt';
import { db } from '../lib/db';
import { confirmUnseal, isLocked } from '../lib/seal';
import { navigate, useAttempts, useSettings, useTests } from '../lib/store';
import type { Test } from '../lib/types';
import { downloadFile, fmtDate, slugify, uid } from '../lib/util';

function initials(title: string) {
  const words = title.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  const nums = title.match(/\d+/)?.[0];
  if (nums && words[0]) return (words[0][0] + nums).slice(0, 3).toUpperCase();
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'T';
}

export function cloneTest(t: Test, title?: string): Test {
  const copy: Test = JSON.parse(JSON.stringify(t));
  copy.id = uid('t_');
  copy.title = title ?? `${t.title} (copy)`;
  copy.builtIn = undefined;
  copy.createdAt = copy.updatedAt = Date.now();
  return copy;
}

export function Library() {
  const tests = useTests();
  const attempts = useAttempts();
  const [settings] = useSettings();
  if (!tests || !attempts) return <Spinner />;

  const start = async (t: Test) => {
    const existing = attempts.find((a) => a.status === 'active' && a.testId === t.id && a.kind === 'full');
    if (existing) {
      const resume = await confirmDialog({
        title: 'You have an unfinished attempt',
        body: 'Resume where you left off, or press Cancel to start over with a fresh attempt.',
        ok: 'Resume',
      });
      if (resume) return navigate(`/test/${existing.id}`);
      await db.deleteAttempt(existing.id);
    }
    const a = await createAttempt(t, settings.defaultTiming);
    navigate(`/test/${a.id}`);
  };

  const edit = async (t: Test) => {
    if (isLocked(t, attempts) && !(await confirmUnseal(t))) return;
    if (t.builtIn) {
      const copy = cloneTest(t, t.title);
      await db.putTest(copy);
      toast('Made an editable copy');
      navigate(`/edit/${copy.id}`);
    } else navigate(`/edit/${t.id}`);
  };

  const remove = async (t: Test) => {
    const ok = await confirmDialog({
      title: `Delete “${t.title}”?`,
      body: 'The test is removed from this browser. Your past results for it are kept.',
      ok: 'Delete test',
      danger: true,
    });
    if (ok) {
      await db.deleteTest(t.id);
      toast('Test deleted');
    }
  };

  return (
    <>
      <div className="ph">
        <div>
          <h1>My Tests</h1>
          <p>Every mock test you've added. Start one whenever you're ready.</p>
        </div>
        <div className="ph-actions">
          <button className="btn btn-primary" onClick={() => navigate('/import')}>
            <Icon name="plus" size={18} /> Add a test
          </button>
        </div>
      </div>

      <div className="test-grid">
        {tests.map((t) => {
          const st = testStats(t);
          const mine = attempts.filter((a) => a.testId === t.id && a.status === 'completed' && a.kind === 'full');
          const best = mine.reduce((m, a) => Math.max(m, a.result?.total ?? a.result?.sections[0]?.score ?? 0), 0);
          const activeA = attempts.find((a) => a.testId === t.id && a.status === 'active' && a.kind === 'full');
          const totalQs = t.sections.reduce((s, sec) => s + sec.modules.reduce((x, m) => x + m.questions.length, 0), 0);
          const locked = isLocked(t, attempts);
          return (
            <div className="card test-card" key={t.id}>
              <div className="test-card-top">
                <div className={`test-cover ${t.builtIn ? 'bright' : ''}`}>{initials(t.title)}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="test-name">{t.title}</div>
                  <div className="test-desc">{t.description || (t.builtIn ? 'Sample test included with GuruSat' : `Added ${fmtDate(t.createdAt)}`)}</div>
                </div>
              </div>
              <div className="test-chips">
                {t.builtIn && <span className="badge badge-green">Sample</span>}
                {st.parts.map((p) => (
                  <span className="badge" key={p}>
                    {p}
                  </span>
                ))}
                {st.adaptive && <span className="badge badge-blue">Adaptive</span>}
                <span className="badge">{st.minutes} min</span>
                {totalQs === 0 && <span className="badge badge-amber">No questions yet</span>}
                {t.source === 'ai' && <span className="badge badge-blue">AI-solved</span>}
              </div>
              {locked && (
                <div className="sealed-note">
                  <Icon name="shield" size={14} /> Answers sealed until you finish this test
                </div>
              )}
              <div className="test-foot">
                <div className="test-best">
                  {mine.length ? (
                    <>
                      <b>{best || '—'}</b> best · {mine.length} attempt{mine.length > 1 ? 's' : ''}
                    </>
                  ) : (
                    'Not taken yet'
                  )}
                </div>
                <span className="spacer" />
                <button className="btn btn-ghost btn-icon" title={locked ? 'Sealed — reveal & edit' : t.builtIn ? 'Copy & edit' : 'Edit'} onClick={() => edit(t)}>
                  <Icon name={locked ? 'eyeOff' : 'edit'} size={18} />
                </button>
                <button
                  className="btn btn-ghost btn-icon"
                  title="Export as JSON"
                  onClick={async () => {
                    if (locked && !(await confirmUnseal(t))) return;
                    downloadFile(`${slugify(t.title)}.gurusat.json`, JSON.stringify({ ...t, builtIn: undefined, sealed: undefined }, null, 1));
                  }}
                >
                  <Icon name="download" size={18} />
                </button>
                {!t.builtIn && (
                  <button className="btn btn-ghost btn-icon btn-danger" title="Delete" onClick={() => remove(t)}>
                    <Icon name="trash" size={18} />
                  </button>
                )}
                <button className="btn btn-primary btn-sm" disabled={totalQs === 0} onClick={() => start(t)}>
                  <Icon name="play" size={13} fill="currentColor" /> {activeA ? 'Resume' : 'Start'}
                </button>
              </div>
            </div>
          );
        })}
        <button className="dropzone" onClick={() => navigate('/import')} style={{ minHeight: 210 }}>
          <div className="dropzone-ic">
            <Icon name="upload" size={26} />
          </div>
          <h3>Add a test</h3>
          <p>Upload a Word or PDF test with the answers highlighted — it's sealed until you take it.</p>
        </button>
      </div>
    </>
  );
}
