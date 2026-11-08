// Test tools: Desmos calculator, reference sheet, directions, line reader, shortcuts.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import katex from 'katex';
import { Icon } from '../components/Icon';
import { Modal } from '../components/ui';
import type { SectionKind } from '../lib/types';

// ─────────────────────────── floating, draggable panel ───────────────────────────
export function FloatingPanel({
  title,
  onClose,
  children,
  initial,
  className = '',
  actions,
  hidden,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  initial: { x: number; y: number; w: number; h: number };
  className?: string;
  actions?: ReactNode;
  hidden?: boolean;
}) {
  const [pos, setPos] = useState({ x: initial.x, y: initial.y });
  const [size, setSize] = useState({ w: initial.w, h: initial.h });
  const [max, setMax] = useState(false);

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const sx = e.clientX - pos.x;
    const sy = e.clientY - pos.y;
    const move = (ev: PointerEvent) =>
      setPos({
        x: Math.max(-size.w + 120, Math.min(window.innerWidth - 120, ev.clientX - sx)),
        y: Math.max(0, Math.min(window.innerHeight - 50, ev.clientY - sy)),
      });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging');
    };
    document.body.classList.add('dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const { w, h } = size;
    const move = (ev: PointerEvent) => setSize({ w: Math.max(300, w + ev.clientX - sx), h: Math.max(260, h + ev.clientY - sy) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging');
    };
    document.body.classList.add('dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const style = max
    ? { left: 16, top: 84, width: Math.min(window.innerWidth - 32, 1100), height: window.innerHeight - 180 }
    : { left: pos.x, top: pos.y, width: size.w, height: size.h };

  return (
    <div className={`fpanel ${className}`} style={{ ...style, display: hidden ? 'none' : undefined }} role="dialog">
      <div className="fpanel-head" onPointerDown={startDrag}>
        <span className="fpanel-grip" aria-hidden>
          ⋮⋮
        </span>
        <span className="fpanel-title">{title}</span>
        <span className="spacer" />
        {actions}
        <button className="fpanel-btn" onClick={() => setMax((v) => !v)} title={max ? 'Collapse' : 'Expand'}>
          <Icon name={max ? 'collapse' : 'expand'} size={16} />
        </button>
        <button className="fpanel-btn" onClick={onClose} title="Close">
          <Icon name="close" size={17} />
        </button>
      </div>
      <div className="fpanel-body">{children}</div>
      {!max && <span className="fpanel-resize" onPointerDown={startResize} aria-hidden />}
    </div>
  );
}

// ─────────────────────────── Desmos calculator ───────────────────────────
const DESMOS_URLS = {
  graphing: 'https://www.desmos.com/testing/collegeboard/graphing',
  scientific: 'https://www.desmos.com/testing/collegeboard/scientific',
};

// Desmos' official embed API (public demo key from the Desmos API docs).
const DESMOS_API = 'https://www.desmos.com/api/v1.11/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6';
type DesmosCalc = { resize: () => void; destroy: () => void };
type DesmosLib = {
  GraphingCalculator: (el: HTMLElement, opts?: object) => DesmosCalc;
  ScientificCalculator: (el: HTMLElement, opts?: object) => DesmosCalc;
};
let desmosPromise: Promise<DesmosLib> | null = null;
function loadDesmos(): Promise<DesmosLib> {
  const w = window as unknown as { Desmos?: DesmosLib };
  if (w.Desmos) return Promise.resolve(w.Desmos);
  desmosPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = DESMOS_API;
    s.async = true;
    s.onload = () => (w.Desmos ? resolve(w.Desmos) : reject(new Error('Desmos missing')));
    s.onerror = () => {
      desmosPromise = null;
      reject(new Error('Desmos failed to load'));
    };
    document.head.appendChild(s);
  });
  return desmosPromise;
}

function DesmosPane({ kind, visible }: { kind: 'graphing' | 'scientific'; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let calc: DesmosCalc | null = null;
    let ro: ResizeObserver | null = null;
    let dead = false;
    loadDesmos()
      .then((D) => {
        if (dead || !ref.current) return;
        calc =
          kind === 'graphing'
            ? D.GraphingCalculator(ref.current, { keypad: true, expressions: true, settingsMenu: true, zoomButtons: true, border: false, pasteGraphLink: false })
            : D.ScientificCalculator(ref.current, { border: false });
        ro = new ResizeObserver(() => calc?.resize());
        ro.observe(ref.current);
      })
      .catch(() => !dead && setFailed(true));
    return () => {
      dead = true;
      ro?.disconnect();
      calc?.destroy();
    };
  }, [kind]);
  if (failed)
    return (
      <iframe
        title={`Desmos ${kind} calculator`}
        src={DESMOS_URLS[kind]}
        className="calc-frame"
        style={{ display: visible ? 'block' : 'none' }}
      />
    );
  return <div ref={ref} className="calc-frame" style={{ display: visible ? 'block' : 'none' }} />;
}

export function Calculator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<'graphing' | 'scientific'>('graphing');
  const [loaded, setLoaded] = useState<Record<string, boolean>>({ graphing: true });
  useEffect(() => {
    setLoaded((l) => ({ ...l, [mode]: true }));
  }, [mode]);
  return (
    <FloatingPanel
      title="Calculator"
      onClose={onClose}
      hidden={!open}
      className="calc-panel"
      initial={{ x: 16, y: 84, w: Math.min(520, window.innerWidth - 32), h: Math.min(640, window.innerHeight - 170) }}
      actions={
        <div className="calc-switch">
          {(['graphing', 'scientific'] as const).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {m === 'graphing' ? 'Graphing' : 'Scientific'}
            </button>
          ))}
        </div>
      }
    >
      {(['graphing', 'scientific'] as const).map((m) => loaded[m] && <DesmosPane key={m} kind={m} visible={mode === m} />)}
    </FloatingPanel>
  );
}

// ─────────────────────────── reference sheet ───────────────────────────
const tex = (s: string) => ({ __html: katex.renderToString(s, { throwOnError: false }) });

const S = { stroke: '#1d2a24', strokeWidth: 1.6, fill: 'none' } as const;
const T = { fontFamily: 'Source Serif 4 Variable, Georgia, serif', fontStyle: 'italic' as const, fontSize: 14, fill: '#1d2a24' };

function RefFigure({ children, formula }: { children: ReactNode; formula: string[] }) {
  return (
    <div className="ref-cell">
      <svg viewBox="0 0 140 96" width="140" height="96">
        {children}
      </svg>
      <div className="ref-formula">
        {formula.map((f) => (
          <span key={f} dangerouslySetInnerHTML={tex(f)} />
        ))}
      </div>
    </div>
  );
}

export function ReferenceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <FloatingPanel
      title="Reference"
      onClose={onClose}
      hidden={!open}
      className="ref-panel"
      initial={{ x: Math.max(16, window.innerWidth - 620), y: 84, w: Math.min(600, window.innerWidth - 32), h: Math.min(620, window.innerHeight - 170) }}
    >
      <div className="ref-sheet">
        <div className="ref-grid">
          <RefFigure formula={['A = \\pi r^2', 'C = 2\\pi r']}>
            <circle cx="70" cy="48" r="36" {...S} />
            <line x1="70" y1="48" x2="106" y2="48" {...S} />
            <circle cx="70" cy="48" r="2" fill="#1d2a24" />
            <text x="84" y="43" {...T}>r</text>
          </RefFigure>
          <RefFigure formula={['A = \\ell w']}>
            <rect x="22" y="24" width="96" height="50" {...S} />
            <text x="66" y="90" {...T}>ℓ</text>
            <text x="124" y="54" {...T}>w</text>
          </RefFigure>
          <RefFigure formula={['A = \\tfrac{1}{2}bh']}>
            <polygon points="16,78 124,78 52,16" {...S} />
            <line x1="52" y1="16" x2="52" y2="78" {...S} strokeDasharray="4 3" />
            <polyline points="52,70 60,70 60,78" {...S} />
            <text x="66" y="93" {...T}>b</text>
            <text x="40" y="54" {...T}>h</text>
          </RefFigure>
          <RefFigure formula={['c^2 = a^2 + b^2']}>
            <polygon points="24,78 116,78 24,18" {...S} />
            <polyline points="24,70 32,70 32,78" {...S} />
            <text x="74" y="44" {...T}>c</text>
            <text x="12" y="52" {...T}>a</text>
            <text x="66" y="93" {...T}>b</text>
          </RefFigure>
          <RefFigure formula={['\\text{Special right triangles}']}>
            <polygon points="8,80 70,80 8,22" {...S} />
            <text x="10" y="34" style={{ ...T, fontSize: 10 }}>30°</text>
            <text x="50" y="76" style={{ ...T, fontSize: 10 }}>60°</text>
            <text x="34" y="46" style={{ ...T, fontSize: 12 }}>2x</text>
            <text x="-2" y="56" style={{ ...T, fontSize: 12 }}>x√3</text>
            <text x="34" y="93" style={{ ...T, fontSize: 12 }}>x</text>
            <polygon points="80,80 134,80 80,26" {...S} />
            <text x="106" y="48" style={{ ...T, fontSize: 12 }}>s√2</text>
            <text x="70" y="56" style={{ ...T, fontSize: 12 }}>s</text>
            <text x="104" y="93" style={{ ...T, fontSize: 12 }}>s</text>
            <text x="82" y="40" style={{ ...T, fontSize: 9 }}>45°</text>
            <text x="114" y="77" style={{ ...T, fontSize: 9 }}>45°</text>
          </RefFigure>
          <RefFigure formula={['V = \\ell w h']}>
            <polygon points="20,36 92,36 92,82 20,82" {...S} />
            <polyline points="20,36 44,16 116,16 116,62 92,82" {...S} />
            <line x1="92" y1="36" x2="116" y2="16" {...S} />
            <text x="54" y="94" {...T}>ℓ</text>
            <text x="106" y="84" {...T}>w</text>
            <text x="122" y="44" {...T}>h</text>
          </RefFigure>
          <RefFigure formula={['V = \\pi r^2 h']}>
            <ellipse cx="70" cy="20" rx="34" ry="9" {...S} />
            <path d="M36 20v58M104 20v58" {...S} />
            <path d="M36 78a34 9 0 0 0 68 0" {...S} />
            <path d="M36 78a34 9 0 0 1 68 0" {...S} strokeDasharray="4 3" />
            <line x1="70" y1="20" x2="104" y2="20" {...S} />
            <text x="84" y="16" {...T}>r</text>
            <text x="110" y="54" {...T}>h</text>
          </RefFigure>
          <RefFigure formula={['V = \\tfrac{4}{3}\\pi r^3']}>
            <circle cx="70" cy="48" r="36" {...S} />
            <path d="M34 48a36 10 0 0 0 72 0" {...S} />
            <path d="M34 48a36 10 0 0 1 72 0" {...S} strokeDasharray="4 3" />
            <line x1="70" y1="48" x2="106" y2="48" {...S} />
            <text x="86" y="44" {...T}>r</text>
          </RefFigure>
          <RefFigure formula={['V = \\tfrac{1}{3}\\pi r^2 h']}>
            <path d="M36 76 70 12 104 76" {...S} />
            <path d="M36 76a34 9 0 0 0 68 0" {...S} />
            <path d="M36 76a34 9 0 0 1 68 0" {...S} strokeDasharray="4 3" />
            <line x1="70" y1="12" x2="70" y2="76" {...S} strokeDasharray="4 3" />
            <line x1="70" y1="76" x2="104" y2="76" {...S} />
            <text x="84" y="73" {...T}>r</text>
            <text x="58" y="50" {...T}>h</text>
          </RefFigure>
          <RefFigure formula={['V = \\tfrac{1}{3}\\ell w h']}>
            <polygon points="22,74 94,74 118,58 46,58" {...S} strokeDasharray="0" />
            <path d="M22 74 70 12 94 74M70 12 118 58" {...S} />
            <path d="M46 58 70 12" {...S} strokeDasharray="4 3" />
            <line x1="70" y1="12" x2="70" y2="66" {...S} strokeDasharray="4 3" />
            <text x="54" y="90" {...T}>ℓ</text>
            <text x="110" y="74" {...T}>w</text>
            <text x="58" y="44" {...T}>h</text>
          </RefFigure>
        </div>
        <ul className="ref-facts">
          <li>The number of degrees of arc in a circle is 360.</li>
          <li>
            The number of radians of arc in a circle is <span dangerouslySetInnerHTML={tex('2\\pi')} />.
          </li>
          <li>The sum of the measures in degrees of the angles of a triangle is 180.</li>
        </ul>
      </div>
    </FloatingPanel>
  );
}

// ─────────────────────────── directions ───────────────────────────
export function DirectionsText({ kind }: { kind: SectionKind }) {
  if (kind === 'rw')
    return (
      <div className="dir-text">
        <p>
          The questions in this section cover a range of important reading and writing skills. Each question includes one or more short passages, which may contain a table or graph. Read each passage and question carefully, then choose the best answer based on the passage(s).
        </p>
        <p>All questions in this section are multiple-choice with four answer choices. Each question has a single best answer.</p>
      </div>
    );
  return (
    <div className="dir-text">
      <p>
        The questions in this section cover a range of important math skills. You may use a calculator for every question. The reference sheet, calculator, and these directions are available throughout the test.
      </p>
      <p><b>Unless otherwise indicated:</b></p>
      <ul>
        <li>All variables and expressions represent real numbers.</li>
        <li>Figures provided are drawn to scale.</li>
        <li>All figures lie in a plane.</li>
        <li>The domain of a given function f is the set of all real numbers x for which f(x) is a real number.</li>
      </ul>
      <p>For <b>multiple-choice questions</b>, solve each problem and choose the correct answer from the choices provided. Each multiple-choice question has a single correct answer.</p>
      <p>For <b>student-produced response questions</b>, solve each problem and enter your answer as described in the directions shown beside the question.</p>
    </div>
  );
}

export function DirectionsPanel({ kind, onClose }: { kind: SectionKind; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="dir-scrim" onClick={onClose} />
      <div className="dir-panel" role="dialog" aria-label="Directions">
        <DirectionsText kind={kind} />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn rn-btn-acc" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────── line reader ───────────────────────────
export function LineReader({ onClose }: { onClose: () => void }) {
  const [y, setY] = useState(window.innerHeight / 2);
  const [h, setH] = useState(76);
  useEffect(() => {
    const m = (e: MouseEvent) => setY(e.clientY);
    const w = (e: WheelEvent) => {
      if (e.altKey) {
        e.preventDefault();
        setH((v) => Math.max(36, Math.min(260, v - Math.sign(e.deltaY) * 12)));
      }
    };
    window.addEventListener('mousemove', m);
    window.addEventListener('wheel', w, { passive: false });
    return () => {
      window.removeEventListener('mousemove', m);
      window.removeEventListener('wheel', w);
    };
  }, []);
  const top = y - h / 2;
  return (
    <div className="line-reader" aria-hidden>
      <div className="lr-mask" style={{ top: 0, height: Math.max(0, top) }} />
      <div className="lr-window" style={{ top, height: h }}>
        <button className="lr-close" onClick={onClose} title="Close line reader">
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="lr-mask" style={{ top: top + h, bottom: 0 }} />
    </div>
  );
}

// ─────────────────────────── shortcuts ───────────────────────────
export const SHORTCUTS: [string, string][] = [
  ['A – D  or  1 – 4', 'Select an answer choice'],
  ['Shift + A – D', 'Cross out an answer choice'],
  ['X', 'Turn the cross-out tool on/off'],
  ['M', 'Mark / unmark for review'],
  ['→  /  ←', 'Next / back'],
  ['Alt + C', 'Open the calculator (Math)'],
  ['R', 'Open the reference sheet (Math)'],
  ['L', 'Line reader on/off'],
  ['T', 'Hide / show the timer'],
  ['?', 'Show these shortcuts'],
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} icon={<Icon name="keyboard" />}>
      <div className="shortcut-list">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="shortcut-row">
            <span className="shortcut-keys">
              {k.split('  ').map((part, i) => (
                <span key={i} className="kbd">
                  {part.trim()}
                </span>
              ))}
            </span>
            <span>{v}</span>
          </div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        Tip: hold <span className="kbd">Alt</span> and scroll to resize the line reader. Use <span className="kbd">Ctrl</span> + <span className="kbd">+</span> / <span className="kbd">−</span> to zoom, just like on test day.
      </p>
    </Modal>
  );
}

// ─────────────────────────── generic popover menu ───────────────────────────
export function useClickOutside(ref: React.RefObject<HTMLElement>, onOut: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    const t = setTimeout(() => window.addEventListener('mousedown', h), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', h);
    };
  }, [ref, onOut, active]);
}

export function MoreMenu({
  items,
}: {
  items: { icon: string; label: string; onClick: () => void; danger?: boolean; checked?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div className="more-wrap" ref={ref}>
      <button className={`rn-tool ${open ? 'on' : ''}`} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <Icon name="more" size={22} stroke={3} />
        <span>More</span>
      </button>
      {open && (
        <div className="more-menu" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={`more-item ${it.danger ? 'danger' : ''}`}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              <Icon name={it.icon} size={18} />
              <span>{it.label}</span>
              {it.checked !== undefined && <span className={`more-check ${it.checked ? 'on' : ''}`}>{it.checked ? 'On' : 'Off'}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
