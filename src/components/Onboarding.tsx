import { useState } from 'react';
import { useSettings } from '../lib/store';
import { Modal, Logo } from './ui';

export function Onboarding() {
  const [s, save] = useSettings();
  const [name, setName] = useState(s.name);
  const [date, setDate] = useState(s.testDate);
  const [target, setTarget] = useState(s.targetScore);
  const done = () => save({ name: name.trim(), testDate: date, targetScore: target, onboarded: true });
  return (
    <Modal
      onClose={() => save({ onboarded: true })}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => save({ onboarded: true })}>
            Skip
          </button>
          <button className="btn btn-primary" onClick={done}>
            Let's go
          </button>
        </>
      }
    >
      <div className="onb-hero">
        <Logo variant="mark" height={58} />
        <h2>Welcome to GuruSat</h2>
        <p>Your own Bluebook-style practice room. Three quick questions and you're in.</p>
      </div>
      <div className="stack">
        <div className="field">
          <label>Your name</label>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown at the bottom of the test screen" />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>SAT test day</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Target score</label>
            <input
              className="input"
              type="number"
              min={400}
              max={1600}
              step={10}
              value={target}
              onChange={(e) => setTarget(Math.max(400, Math.min(1600, Number(e.target.value) || 400)))}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
