// The Bluebook-style question layout: passage pane | divider | question pane.
// Used live during the test and read-only in the review screen.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { renderMarkup } from '../lib/markup';
import { sanitizeSpr, isCorrect } from '../lib/spr';
import type { Highlight, Question, Response, SectionKind } from '../lib/types';
import { LETTERS, uid } from '../lib/util';
import { Icon } from '../components/Icon';
import { applyHighlights, selectionOffsets } from './highlight';
import katex from 'katex';

// ─────────────────────────── highlightable rich text ───────────────────────────
const RichText = memo(function RichText({
  src,
  root,
  highlights,
  className,
}: {
  src: string;
  root: 'passage' | 'prompt';
  highlights: Highlight[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mine = highlights.filter((h) => h.root === root);
  const key = JSON.stringify(mine);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = renderMarkup(src);
    applyHighlights(el, mine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, key]);
  return <div ref={ref} className={`mk ${className ?? ''}`} data-hl-root={root} />;
});

// ─────────────────────────── highlight toolbar ───────────────────────────
type ToolbarState =
  | { mode: 'new'; root: 'passage' | 'prompt'; start: number; end: number; x: number; y: number }
  | { mode: 'edit'; id: string; x: number; y: number; editingNote?: boolean };

function HighlightToolbar({
  state,
  highlights,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}: {
  state: ToolbarState;
  highlights: Highlight[];
  onCreate: (color: Highlight['color'], underline?: boolean, withNote?: boolean) => void;
  onUpdate: (id: string, patch: Partial<Highlight>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const h = state.mode === 'edit' ? highlights.find((x) => x.id === state.id) : undefined;
  const [note, setNote] = useState(h?.note ?? '');
  const [noteOpen, setNoteOpen] = useState(state.mode === 'edit' && !!state.editingNote);
  useEffect(() => {
    setNote(h?.note ?? '');
  }, [h?.id, h?.note]);
  const colors: Highlight['color'][] = ['yellow', 'blue', 'pink'];
  const left = Math.max(12, Math.min(window.innerWidth - 300, state.x - 140));
  const top = Math.max(70, state.y);
  return (
    <div className="hl-toolbar" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="hl-toolbar-row">
        {colors.map((c) => (
          <button
            key={c}
            className={`hl-swatch hl-sw-${c} ${h?.color === c ? 'on' : ''}`}
            title={`Highlight ${c}`}
            onClick={() => (h ? onUpdate(h.id, { color: c }) : onCreate(c))}
          />
        ))}
        <span className="hl-sep" />
        <button
          className={`hl-tool ${h?.underline ? 'on' : ''}`}
          title="Underline"
          onClick={() => (h ? onUpdate(h.id, { underline: !h.underline }) : onCreate('yellow', true))}
        >
          <Icon name="underline" size={17} />
        </button>
        <button
          className={`hl-tool ${noteOpen ? 'on' : ''}`}
          title="Add a note"
          onClick={() => {
            if (!h) onCreate('yellow', false, true);
            else setNoteOpen((v) => !v);
          }}
        >
          <Icon name="note" size={17} />
        </button>
        {h && (
          <button className="hl-tool danger" title="Delete highlight" onClick={() => onDelete(h.id)}>
            <Icon name="trash" size={17} />
          </button>
        )}
        <button className="hl-tool" title="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {h && noteOpen && (
        <div className="hl-note">
          <textarea
            autoFocus
            placeholder="Type a note…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setNoteOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-sm rn-btn-acc"
              onClick={() => {
                onUpdate(h.id, { note: note.trim() || undefined });
                setNoteOpen(false);
                onClose();
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
      {h?.note && !noteOpen && <div className="hl-note-view" onClick={() => setNoteOpen(true)}>{h.note}</div>}
    </div>
  );
}

// ─────────────────────────── answer choices ───────────────────────────
function Choices({
  q,
  response,
  crossMode,
  onAnswer,
  onCross,
  review,
}: {
  q: Question;
  response?: Response;
  crossMode: boolean;
  onAnswer?: (a: string) => void;
  onCross?: (letter: string) => void;
  review?: boolean;
}) {
  return (
    <div className="choices" role="radiogroup">
      {q.choices.map((c, i) => {
        const L = LETTERS[i];
        const selected = response?.answer === L;
        const crossed = !review && (response?.crossed ?? []).includes(L);
        const isRight = review && q.answer === L;
        const isWrongPick = review && selected && !isRight;
        return (
          <div key={c.id} className={`choice-row ${crossed ? 'crossed' : ''}`}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              className={`choice ${selected ? 'selected' : ''} ${isRight ? 'is-right' : ''} ${isWrongPick ? 'is-wrong' : ''}`}
              onClick={() => !review && onAnswer?.(L)}
              disabled={review}
            >
              <span className="choice-letter">{L}</span>
              <span className="choice-text mk" dangerouslySetInnerHTML={{ __html: renderMarkup(c.text) || '' }} />
              {review && isRight && (
                <span className="choice-tag right">
                  <Icon name="check" size={15} stroke={2.6} /> Correct
                </span>
              )}
              {review && isWrongPick && (
                <span className="choice-tag wrong">
                  <Icon name="x" size={15} stroke={2.6} /> Your answer
                </span>
              )}
              {crossed && <span className="choice-strike" aria-hidden />}
            </button>
            {crossMode && !review && (
              <button
                type="button"
                className={`cross-btn ${crossed ? 'undo' : ''}`}
                onClick={() => onCross?.(L)}
                aria-label={crossed ? `Undo cross out ${L}` : `Cross out ${L}`}
              >
                {crossed ? 'Undo' : <span className="cross-letter">{L}</span>}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────── student-produced response ───────────────────────────
function sprPreview(v: string) {
  if (!v) return '';
  const m = v.match(/^(-?)([^/]*)\/(.*)$/);
  const tex = m ? `${m[1]}\\dfrac{${m[2] || '\\square'}}{${m[3] || '\\square'}}` : v;
  try {
    return katex.renderToString(tex, { throwOnError: false });
  } catch {
    return v;
  }
}

function SprInput({ value, onChange, review, q }: { value?: string; onChange?: (v: string) => void; review?: boolean; q: Question }) {
  const right = review && isCorrect(q, value);
  return (
    <div className="spr">
      <input
        className={`spr-input ${review ? (right ? 'is-right' : 'is-wrong') : ''}`}
        value={value ?? ''}
        readOnly={review}
        inputMode="decimal"
        aria-label="Your answer"
        onChange={(e) => onChange?.(sanitizeSpr(e.target.value))}
        onKeyDown={(e) => !e.altKey && e.stopPropagation()}
      />
      <div className="spr-preview">
        <span>Answer Preview:</span>
        <span className="spr-preview-val" dangerouslySetInnerHTML={{ __html: sprPreview(value ?? '') }} />
      </div>
    </div>
  );
}

export function SprDirections() {
  return (
    <div className="spr-dirs">
      <h3>Student-produced response directions</h3>
      <ul>
        <li>If you find <b>more than one correct answer</b>, enter only one answer.</li>
        <li>You can enter up to 5 characters for a <b>positive</b> answer and up to 6 characters (including the negative sign) for a <b>negative</b> answer.</li>
        <li>If your answer is a <b>fraction</b> that doesn't fit in the provided space, enter the decimal equivalent.</li>
        <li>If your answer is a <b>decimal</b> that doesn't fit in the provided space, enter it by truncating or rounding at the fourth digit.</li>
        <li>If your answer is a <b>mixed number</b> (such as 3½), enter it as an improper fraction (7/2) or its decimal equivalent (3.5).</li>
        <li>Don't enter <b>symbols</b> such as a percent sign, comma, or dollar sign.</li>
      </ul>
      <p className="spr-ex-title">Examples</p>
      <table className="spr-ex">
        <thead>
          <tr>
            <th>Answer</th>
            <th>Acceptable ways to enter answer</th>
            <th>Unacceptable: will NOT receive credit</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>3.5</td>
            <td>3.5<br />3.50<br />7/2</td>
            <td>31/2<br />3 1/2</td>
          </tr>
          <tr>
            <td dangerouslySetInnerHTML={{ __html: katex.renderToString('\\dfrac{2}{3}') }} />
            <td>2/3<br />.6666<br />.6667<br />0.666<br />0.667</td>
            <td>0.66<br />.66<br />0.67<br />.67</td>
          </tr>
          <tr>
            <td dangerouslySetInnerHTML={{ __html: katex.renderToString('-\\dfrac{1}{3}') }} />
            <td>-1/3<br />-.3333<br />-0.333</td>
            <td>-.33<br />-0.33</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────── the full layout ───────────────────────────
export interface QuestionViewProps {
  q: Question;
  kind: SectionKind;
  number: number;
  response?: Response;
  highlights?: Highlight[];
  crossMode?: boolean;
  review?: boolean;
  split: number;
  onSplit?: (v: number) => void;
  onAnswer?: (a: string) => void;
  onCross?: (letter: string) => void;
  onToggleMark?: () => void;
  onToggleCrossMode?: () => void;
  onHighlights?: (list: Highlight[]) => void;
  /** extra content under the choices (review explanation etc.) */
  footer?: ReactNode;
}

export function QuestionView(props: QuestionViewProps) {
  const { q, kind, number, response, highlights = [], crossMode = false, review, split } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const [expanded, setExpanded] = useState<'left' | 'right' | null>(null);

  // R&W: passage (and passage-placed figures) on the left. Math: single column, except grid-ins,
  // which show the student-produced response directions on the left — just like Bluebook.
  const imgOnLeft = !!q.image && kind === 'rw' && (q.imagePlacement ?? 'passage') === 'passage';
  const hasPassage = !!(q.passage && q.passage.trim()) || imgOnLeft;
  const isSpr = q.type === 'spr';
  const isSplit = kind === 'rw' ? hasPassage : isSpr;
  const leftIsDirections = kind === 'math' && isSpr;
  const imageInQuestion = !!q.image && !(isSplit && imgOnLeft);
  const stimulusInQuestion = !!q.passage && (kind === 'math' || !isSplit);

  useEffect(() => {
    setToolbar(null);
    setExpanded(null);
  }, [q.id]);

  // selection → toolbar
  const onMouseUp = useCallback(() => {
    if (!props.onHighlights) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const node = sel.anchorNode?.parentElement?.closest('[data-hl-root]') as HTMLElement | null;
      if (!node || !wrapRef.current?.contains(node)) return;
      const offs = selectionOffsets(node);
      if (!offs) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setToolbar({ mode: 'new', root: node.dataset.hlRoot as 'passage' | 'prompt', start: offs.start, end: offs.end, x: rect.left + rect.width / 2, y: rect.bottom + 8 });
    }, 0);
  }, [props.onHighlights]);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (!props.onHighlights) return;
      const mark = (e.target as HTMLElement).closest('mark[data-hid]') as HTMLElement | null;
      const sel = window.getSelection();
      if (mark && (!sel || sel.isCollapsed)) {
        const r = mark.getBoundingClientRect();
        setToolbar({ mode: 'edit', id: mark.dataset.hid!, x: r.left + r.width / 2, y: r.bottom + 8 });
      }
    },
    [props.onHighlights],
  );

  useEffect(() => {
    if (!toolbar) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.hl-toolbar') && !(e.target as HTMLElement).closest('mark[data-hid]')) {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) setToolbar(null);
      }
    };
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', close);
    };
  }, [toolbar]);

  const create = (color: Highlight['color'], underline?: boolean, withNote?: boolean) => {
    if (!toolbar || toolbar.mode !== 'new') return;
    const h: Highlight = { id: uid('h'), root: toolbar.root, start: toolbar.start, end: toolbar.end, color, underline };
    props.onHighlights?.([...highlights, h]);
    window.getSelection()?.removeAllRanges();
    setToolbar(withNote ? { mode: 'edit', id: h.id, x: toolbar.x, y: toolbar.y, editingNote: true } : null);
  };

  // draggable divider
  const dragDivider = (e: React.PointerEvent) => {
    if (!props.onSplit) return;
    e.preventDefault();
    const el = wrapRef.current!;
    const box = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const v = ((ev.clientX - box.left) / box.width) * 100;
      props.onSplit!(Math.max(22, Math.min(78, v)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging-col');
    };
    document.body.classList.add('dragging-col');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const questionPane = (
    <div className="q-pane">
      <div className="q-head">
        <span className="q-num">{number}</span>
        <button type="button" className={`q-mark ${response?.marked ? 'on' : ''}`} onClick={props.onToggleMark} disabled={review}>
          <Icon name="bookmark" size={19} fill={response?.marked ? 'currentColor' : 'none'} />
          <span>{review ? (response?.marked ? 'Marked for Review' : 'Not marked') : 'Mark for Review'}</span>
        </button>
        <span className="spacer" />
        {q.type === 'mcq' && !review && (
          <button
            type="button"
            className={`q-cross-toggle ${crossMode ? 'on' : ''}`}
            onClick={props.onToggleCrossMode}
            title="Cross out answer choices (X)"
            aria-pressed={crossMode}
          >
            <span>ABC</span>
          </button>
        )}
      </div>
      <div className="q-body">
        {imageInQuestion && <img className="q-figure" src={q.image} alt="Question figure" />}
        {stimulusInQuestion && <RichText src={q.passage!} root="passage" highlights={highlights} className="q-stimulus read" />}
        <RichText src={q.prompt} root="prompt" highlights={highlights} className="q-prompt read" />
        {q.type === 'mcq' ? (
          <Choices q={q} response={response} crossMode={crossMode} onAnswer={props.onAnswer} onCross={props.onCross} review={review} />
        ) : (
          <SprInput q={q} value={response?.answer} onChange={props.onAnswer} review={review} />
        )}
        {props.footer}
      </div>
    </div>
  );

  return (
    <div
      ref={wrapRef}
      className={`qv ${isSplit ? 'qv-split' : 'qv-single'} ${expanded ? 'qv-expanded-' + expanded : ''}`}
      style={isSplit ? ({ ['--split' as string]: `${split}%` } as React.CSSProperties) : undefined}
      onMouseUp={onMouseUp}
      onClick={onClick}
    >
      {isSplit && (
        <>
          <div className="qv-left">
            <button className="pane-expand" onClick={() => setExpanded(expanded === 'left' ? null : 'left')} title={expanded === 'left' ? 'Collapse' : 'Expand'}>
              <Icon name={expanded === 'left' ? 'collapse' : 'expand'} size={16} />
            </button>
            <div className="qv-left-inner">
              {leftIsDirections ? (
                <SprDirections />
              ) : (
                <>
                  {q.image && !imageInQuestion && <img className="q-figure" src={q.image} alt="Passage figure" />}
                  {q.passage && <RichText src={q.passage} root="passage" highlights={highlights} className="read passage" />}
                </>
              )}
            </div>
          </div>
          <div className="qv-divider" onPointerDown={dragDivider} role="separator" aria-orientation="vertical">
            <span className="qv-grip" />
          </div>
          <div className="qv-right">
            <button className="pane-expand" onClick={() => setExpanded(expanded === 'right' ? null : 'right')} title={expanded === 'right' ? 'Collapse' : 'Expand'}>
              <Icon name={expanded === 'right' ? 'collapse' : 'expand'} size={16} />
            </button>
            {questionPane}
          </div>
        </>
      )}
      {!isSplit && <div className="qv-center">{questionPane}</div>}
      {toolbar && (
        <HighlightToolbar
          state={toolbar}
          highlights={highlights}
          onCreate={create}
          onUpdate={(id, patch) => props.onHighlights?.(highlights.map((h) => (h.id === id ? { ...h, ...patch } : h)))}
          onDelete={(id) => {
            props.onHighlights?.(highlights.filter((h) => h.id !== id));
            setToolbar(null);
          }}
          onClose={() => setToolbar(null)}
        />
      )}
    </div>
  );
}
