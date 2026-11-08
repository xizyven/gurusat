import { useState } from 'react';
import { checkKey } from '../lib/ai';
import { useSettings } from '../lib/store';
import { Icon } from './Icon';
import { toast } from './ui';

/** Paste + verify the Anthropic API key. The key is stored only in this browser. */
export function ApiKeyCard({ compact, onReady }: { compact?: boolean; onReady?: () => void }) {
  const [settings, save] = useSettings();
  const [value, setValue] = useState(settings.apiKey);
  const [show, setShow] = useState(false);
  const [state, setState] = useState<'idle' | 'checking' | 'ok' | 'error'>(settings.apiKey ? 'ok' : 'idle');
  const [error, setError] = useState('');

  const verify = async () => {
    const key = value.trim();
    if (!key) return;
    setState('checking');
    setError('');
    try {
      await checkKey(key);
      save({ apiKey: key });
      setState('ok');
      toast('API key works — AI builder is ready');
      onReady?.();
    } catch (e) {
      setState('error');
      setError((e as Error).message);
    }
  };

  return (
    <div className="ak">
      {!compact && (
        <div className="ak-steps">
          <div className="ak-step">
            <span>1</span>
            <div>
              Go to <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer">console.anthropic.com</a> and sign up (free).
            </div>
          </div>
          <div className="ak-step">
            <span>2</span>
            <div>
              Open <b>Billing</b> and add credit — $5 is enough for a few full mocks (about $2–4 each).
            </div>
          </div>
          <div className="ak-step">
            <span>3</span>
            <div>
              Open <b>API keys</b> → <b>Create key</b>, copy it, and paste it below.
            </div>
          </div>
        </div>
      )}
      <div className="field">
        <label>Anthropic API key</label>
        <div className="row">
          <input
            className="input"
            type={show ? 'text' : 'password'}
            value={value}
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setValue(e.target.value);
              setState('idle');
            }}
            onKeyDown={(e) => e.key === 'Enter' && verify()}
          />
          <button className="btn btn-ghost btn-icon" onClick={() => setShow((v) => !v)} title={show ? 'Hide key' : 'Show key'}>
            <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
          </button>
          <button className="btn btn-primary" onClick={verify} disabled={!value.trim() || state === 'checking'}>
            {state === 'checking' ? 'Checking…' : 'Save & check'}
          </button>
        </div>
        {state === 'ok' && (
          <span className="ak-ok">
            <Icon name="check" size={15} stroke={2.6} /> Key saved and working.
          </span>
        )}
        {state === 'error' && <span className="ak-err">{error}</span>}
        <span className="hint">
          <Icon name="shield" size={13} style={{ verticalAlign: '-2px', color: 'var(--g-500)' }} /> Saved only in this browser and sent only to Anthropic. It is never included in backups.
        </span>
      </div>
      {settings.apiKey && !compact && (
        <button
          className="btn btn-sm btn-ghost btn-danger"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            save({ apiKey: '' });
            setValue('');
            setState('idle');
          }}
        >
          <Icon name="trash" size={14} /> Remove key from this browser
        </button>
      )}
    </div>
  );
}
