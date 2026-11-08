import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Spinner, toast } from '../components/ui';
import { collectMistakes, type MistakeItem } from '../lib/analysis';
import { createAttempt, practiceTest } from '../lib/attempt';
import { db } from '../lib/db';
import { plainText } from '../lib/markup';
import { answerLabel } from '../lib/spr';
import { navigate, useAttempts } from '../lib/store';
import type { SectionKind } from '../lib/types';
import { fmtDate } from '../lib/util';
import { MISTAKE_TAGS } from './Review';
import '../styles/results.css';

export default function Mistakes() {
  const attempts = useAttempts();
  const [kind, setKind] = useState<'all' | SectionKind>('all');
  const [skill, setSkill] = useState('');
  const [tag, setTag] = useState('');
  const [showMastered, setShowMastered] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const all = useMemo(() => collectMistakes(attempts ?? []), [attempts]);
  if (!attempts) return <Spinner />;

  const skills = [...new Set(all.filter((m) => kind === 'all' || m.row.kind === kind).map((m) => m.row.skill))].sort();
  const list = all.filter(
    (m) =>
      (kind === 'all' || m.row.kind === kind) &&
      (!skill || m.row.skill === skill) &&
      (!tag || m.note?.tags.includes(tag)) &&
      (showMastered || !m.note?.mastered),
  );
  const mastered = all.filter((m) => m.note?.mastered).length;

  const practice = async (items: MistakeItem[]) => {
    if (!items.length) return;
    const t = practiceTest(`Mistake practice · ${items.length} question${items.length > 1 ? 's' : ''}`, items.map((m) => ({ kind: m.row.kind, q: m.row.q })));
    const a = await createAttempt(t, 'untimed', 'practice');
    navigate(`/test/${a.id}`);
  };

  const toggleMastered = async (m: MistakeItem) => {
    const a = await db.getAttempt(m.attemptId);
    if (!a) return;
    const n = a.notes?.[m.row.q.id] ?? { tags: [], text: '' };
    await db.putAttempt({ ...a, notes: { ...(a.notes ?? {}), [m.row.q.id]: { ...n, mastered: !n.mastered } } });
    toast(n.mastered ? 'Moved back to your notebook' : 'Marked as mastered');
  };

  const togglePick = (key: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <>
      <div className="ph">
        <div>
          <h1>Mistake Notebook</h1>
          <p>Every question you missed or skipped, from all your tests. Get it right in a retry and it leaves the notebook automatically.</p>
        </div>
        <div className="ph-actions">
          {picked.size > 0 && (
            <button className="btn" onClick={() => practice(list.filter((m) => picked.has(m.key)))}>
              Practice {picked.size} selected
            </button>
          )}
          <button className="btn btn-primary" disabled={!list.length} onClick={() => practice(list.slice(0, 30))}>
            <Icon name="play" size={14} fill="currentColor" /> Practice {Math.min(list.length, 30)} {list.length > 30 ? 'of these' : ''}
          </button>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="seg">
          {(['all', 'rw', 'math'] as const).map((k) => (
            <button
              key={k}
              className={kind === k ? 'on' : ''}
              onClick={() => {
                setKind(k);
                setSkill('');
              }}
            >
              {k === 'all' ? `All ${all.filter((m) => !m.note?.mastered).length}` : k === 'rw' ? 'Reading & Writing' : 'Math'}
            </button>
          ))}
        </div>
        <select className="select" style={{ width: 'auto', minWidth: 200 }} value={skill} onChange={(e) => setSkill(e.target.value)}>
          <option value="">All skills</option>
          {skills.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto', minWidth: 180 }} value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Any reason</option>
          {MISTAKE_TAGS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <span className="spacer" />
        {mastered > 0 && (
          <label className="row" style={{ fontSize: 13, gap: 8, cursor: 'pointer' }}>
            <span className="switch">
              <input type="checkbox" checked={showMastered} onChange={(e) => setShowMastered(e.target.checked)} />
              <span />
            </span>
            Show mastered ({mastered})
          </label>
        )}
      </div>

      {!list.length ? (
        <div className="card empty">
          <div className="empty-ic">
            <Icon name="target" size={26} />
          </div>
          <h3>{all.length ? 'Nothing matches these filters' : 'No mistakes yet'}</h3>
          <p>{all.length ? 'Try a different section or skill.' : 'Questions you miss in any test will collect here so you can retry them.'}</p>
        </div>
      ) : (
        <div className="mk-list">
          {list.map((m) => (
            <div className={`card mk-item ${m.note?.mastered ? 'mastered' : ''}`} key={m.key}>
              <label className="mk-check">
                <input type="checkbox" checked={picked.has(m.key)} onChange={() => togglePick(m.key)} />
              </label>
              <div className="mk-main" onClick={() => navigate(`/review/${m.attemptId}/${m.row.q.id}`)}>
                <div className="mk-top">
                  <span className={`rep-res ${m.row.status}`}>
                    <Icon name={m.row.status === 'wrong' ? 'x' : 'minus'} size={12} stroke={3} />
                    {m.row.status === 'wrong' ? 'Incorrect' : 'Omitted'}
                  </span>
                  <span className="badge">{m.row.kind === 'rw' ? 'R&W' : 'Math'}</span>
                  <span className="badge badge-green">{m.row.skill}</span>
                  {m.note?.tags.map((t) => (
                    <span className="badge badge-amber" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mk-text">{plainText(m.row.q.prompt || m.row.q.passage, 200) || (m.row.q.image ? '[image question]' : '')}</div>
                <div className="mk-meta">
                  {m.attemptTitle} · Q{m.row.n} · {fmtDate(m.date)} · You: <b>{m.row.answer ?? '—'}</b> · Correct: <b>{answerLabel(m.row.q)}</b>
                </div>
                {m.note?.text && <div className="mk-note">“{m.note.text}”</div>}
              </div>
              <div className="mk-actions">
                <button className="btn btn-sm" onClick={() => practice([m])}>
                  Retry
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => toggleMastered(m)} title={m.note?.mastered ? 'Unmark mastered' : 'I’ve got this now'}>
                  <Icon name={m.note?.mastered ? 'undo' : 'check'} size={15} /> {m.note?.mastered ? 'Unmaster' : 'Mastered'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
