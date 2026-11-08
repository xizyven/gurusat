import { useRef } from 'react';
import { ApiKeyCard } from '../components/ApiKey';
import { Icon } from '../components/Icon';
import { confirmDialog, toast } from '../components/ui';
import { TIMING_LABEL } from '../lib/attempt';
import { db, makeBackup, restoreBackup } from '../lib/db';
import { useSettings } from '../lib/store';
import type { TimingMode } from '../lib/types';
import { downloadFile, readFileAsText } from '../lib/util';

export default function SettingsPage() {
  const [s, save] = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);

  const backup = async () => {
    const b = await makeBackup(s);
    downloadFile(`gurusat-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b));
    toast('Backup downloaded');
  };
  const restore = async (f?: File) => {
    if (!f) return;
    try {
      const data = JSON.parse(await readFileAsText(f));
      const r = await restoreBackup(data);
      if (data.settings && typeof data.settings === 'object') {
        // backups never carry the API key — keep the one already saved here
        const { apiKey: _ignored, ...rest } = data.settings as Record<string, unknown>;
        void _ignored;
        save({ ...rest, onboarded: true });
      }
      toast(`Restored ${r.tests} tests and ${r.attempts} results`);
    } catch (e) {
      toast((e as Error).message || 'Could not restore that file');
    }
  };
  const wipe = async () => {
    if (
      await confirmDialog({
        title: 'Erase everything?',
        body: 'All your tests, results and notes in this browser will be permanently deleted. Download a backup first if you might want them back.',
        ok: 'Erase all data',
        danger: true,
      })
    ) {
      await db.clearAll();
      toast('All data erased');
    }
  };

  return (
    <>
      <div className="ph">
        <div>
          <h1>Settings</h1>
          <p>Personalize GuruSat and move your data between devices.</p>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 4 }}>
          You
        </div>
        <div className="set-row">
          <div className="set-row-text">
            <b>Name</b>
            <span>Shown at the bottom-left of the test screen, like on test day.</span>
          </div>
          <input className="input" style={{ maxWidth: 260 }} value={s.name} onChange={(e) => save({ name: e.target.value })} placeholder="Your name" />
        </div>
        <div className="set-row">
          <div className="set-row-text">
            <b>SAT test day</b>
            <span>Powers the countdown in the sidebar.</span>
          </div>
          <input className="input" style={{ maxWidth: 200 }} type="date" value={s.testDate} onChange={(e) => save({ testDate: e.target.value })} />
        </div>
        <div className="set-row">
          <div className="set-row-text">
            <b>Target score</b>
            <span>Shown on your score ring, trend chart and score reports.</span>
          </div>
          <input
            className="input"
            style={{ maxWidth: 120 }}
            type="number"
            min={400}
            max={1600}
            step={10}
            value={s.targetScore}
            onChange={(e) => save({ targetScore: Math.max(400, Math.min(1600, Number(e.target.value) || 400)) })}
          />
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 4 }}>
          Test screen
        </div>
        <div className="set-row">
          <div className="set-row-text">
            <b>Interface color</b>
            <span>GuruSat green, or the test-day blue to make practice feel exactly like the real thing.</span>
          </div>
          <div className="theme-swatches">
            <button className={`theme-sw ${!s.classicTheme ? 'on' : ''}`} onClick={() => save({ classicTheme: false })}>
              <div className="theme-sw-preview" style={{ background: '#f3f8f3' }}>
                <i style={{ background: '#106b45' }} />
                <b style={{ background: '#106b45' }} />
              </div>
              <div className="theme-sw-label">GuruSat green</div>
            </button>
            <button className={`theme-sw ${s.classicTheme ? 'on' : ''}`} onClick={() => save({ classicTheme: true })}>
              <div className="theme-sw-preview" style={{ background: '#f2f4f9' }}>
                <i style={{ background: '#324dc7' }} />
                <b style={{ background: '#324dc7' }} />
              </div>
              <div className="theme-sw-label">Test-day blue</div>
            </button>
          </div>
        </div>
        <div className="set-row">
          <div className="set-row-text">
            <b>Default timing</b>
            <span>Pre-selected when you start a test. Use extended time only if you have approved accommodations.</span>
          </div>
          <select className="select" style={{ maxWidth: 240 }} value={s.defaultTiming} onChange={(e) => save({ defaultTiming: e.target.value as TimingMode })}>
            {(Object.keys(TIMING_LABEL) as TimingMode[]).map((t) => (
              <option key={t} value={t}>
                {TIMING_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 4 }}>
          <div className="card-title">AI mock builder</div>
          <span className="badge badge-green">Claude Opus 5.5</span>
        </div>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
          Solves your teacher's questions and writes explanations using your own Anthropic account. A full mock costs about $2–4 of credit.
        </p>
        <ApiKeyCard />
      </div>

      <div className="card card-pad">
        <div className="card-title" style={{ marginBottom: 4 }}>
          Your data
        </div>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 4 }}>
          <Icon name="shield" size={14} style={{ verticalAlign: '-2px', color: 'var(--g-500)' }} /> Tests and results are saved only in this browser — nothing is uploaded. To use another computer or phone, download a backup here and restore it there.
        </p>
        <div className="set-row">
          <div className="set-row-text">
            <b>Download a backup</b>
            <span>One file with every test, result and note.</span>
          </div>
          <button className="btn" onClick={backup}>
            <Icon name="download" size={17} /> Download
          </button>
        </div>
        <div className="set-row">
          <div className="set-row-text">
            <b>Restore from a backup</b>
            <span>Adds the backup's tests and results to this browser.</span>
          </div>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => restore(e.target.files?.[0])} />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={17} /> Restore
          </button>
        </div>
        <div className="set-row">
          <div className="set-row-text">
            <b>Erase all data</b>
            <span>Removes everything from this browser.</span>
          </div>
          <button className="btn btn-danger" onClick={wipe}>
            <Icon name="trash" size={17} /> Erase
          </button>
        </div>
      </div>
    </>
  );
}
