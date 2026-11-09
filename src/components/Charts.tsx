// Hand-built SVG charts. Series colors: RW green #16704a, Math amber #d99212 (CVD-validated pair).
// Status (correct/incorrect/omitted) always ships with a second cue: texture, icon, label.
import { useMemo, useRef, useState } from 'react';
import { fmtDate, fmtDuration } from '../lib/util';
import '../styles/charts.css';

export const SERIES = { total: '#0f4c3a', rw: '#16704a', math: '#d99212' } as const;
export const STATUS = { right: '#1d8a4b', wrong: '#cf3d3d', omit: '#aab4af' } as const;

// ─────────────────────────── score ring (hero number) ───────────────────────────
export function ScoreRing({
  value,
  max = 1600,
  min = 400,
  size = 170,
  stroke = 12,
  label = 'Latest',
  track = 'rgba(255,255,255,.15)',
  color = '#7fd07c',
  target,
}: {
  value?: number;
  max?: number;
  min?: number;
  size?: number;
  stroke?: number;
  label?: string;
  track?: string;
  color?: string;
  target?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const tPct = target ? Math.max(0, Math.min(1, (target - min) / (max - min))) : null;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          style={{ transition: 'stroke-dasharray 1s cubic-bezier(.2,.8,.2,1)' }}
        />
        {tPct !== null && (
          <line
            x1={size / 2 + (r - stroke) * Math.cos(tPct * 2 * Math.PI)}
            y1={size / 2 + (r - stroke) * Math.sin(tPct * 2 * Math.PI)}
            x2={size / 2 + (r + stroke) * Math.cos(tPct * 2 * Math.PI)}
            y2={size / 2 + (r + stroke) * Math.sin(tPct * 2 * Math.PI)}
            stroke="#fff"
            strokeWidth={3}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="ring-center">
        <div>
          <div className="ring-num">{value ?? '—'}</div>
          <div className="ring-sub">{label}</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── score trend (line chart) ───────────────────────────
export interface TrendPoint {
  id: string;
  date: number;
  title: string;
  total?: number;
  rw?: number;
  math?: number;
}

export function TrendChart({ points, mode, target }: { points: TrendPoint[]; mode: 'total' | 'sections'; target?: number }) {
  const W = 640;
  const H = 240;
  const pad = { l: 44, r: 56, t: 16, b: 30 };
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);

  const series = mode === 'total' ? (['total'] as const) : (['rw', 'math'] as const);
  const vals = points.flatMap((p) => series.map((s) => p[s]).filter((v): v is number => v !== undefined));
  const isTotal = mode === 'total';
  const lo0 = isTotal ? 400 : 200;
  const hi0 = isTotal ? 1600 : 800;
  const step = isTotal ? 100 : 50;
  let lo = Math.max(lo0, Math.floor((Math.min(...vals, target && isTotal ? target : Infinity) - step) / step) * step);
  let hi = Math.min(hi0, Math.ceil((Math.max(...vals, target && isTotal ? target : -Infinity) + step) / step) * step);
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) {
    lo = lo0;
    hi = hi0;
  }
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const ticks: number[] = [];
  const tickStep = (hi - lo) / step > 6 ? step * 2 : step;
  for (let v = lo; v <= hi; v += tickStep) ticks.push(v);

  const onMove = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    let bd = Infinity;
    points.forEach((_, i) => {
      const d = Math.abs(x(i) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hp = hover !== null ? points[hover] : null;
  return (
    <div className="chart-wrap">
      {mode === 'sections' && (
        <div className="chart-legend">
          <span>
            <i style={{ background: SERIES.rw }} /> Reading &amp; Writing
          </span>
          <span>
            <i style={{ background: SERIES.math }} /> Math
          </span>
        </div>
      )}
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart-svg" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Score trend">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e8edea" strokeWidth={1} />
            <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" className="chart-tick">
              {t}
            </text>
          </g>
        ))}
        {target && isTotal && target >= lo && target <= hi && (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(target)} y2={y(target)} stroke="#4aa04a" strokeWidth={1.5} strokeDasharray="5 5" />
            <text x={W - pad.r + 6} y={y(target) + 4} className="chart-tick" style={{ fill: '#2b7c4c', fontWeight: 650 }}>
              Goal
            </text>
          </g>
        )}
        {points.map((p, i) => (
          <text key={p.id} x={x(i)} y={H - 8} textAnchor="middle" className="chart-tick">
            {points.length <= 8 || i % Math.ceil(points.length / 8) === 0 ? new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
          </text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#9aa6a0" strokeWidth={1} />}
        {series.map((s) => {
          const pts = points.map((p, i) => (p[s] !== undefined ? [x(i), y(p[s]!)] : null)).filter(Boolean) as number[][];
          if (!pts.length) return null;
          const d = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt[0]},${pt[1]}`).join(' ');
          const area = isTotal && pts.length > 1 ? `${d} L${pts[pts.length - 1][0]},${H - pad.b} L${pts[0][0]},${H - pad.b} Z` : '';
          const last = pts[pts.length - 1];
          const lastVal = [...points].reverse().find((p) => p[s] !== undefined)?.[s];
          return (
            <g key={s}>
              {area && <path d={area} fill="url(#trendFill)" />}
              <path d={d} fill="none" stroke={SERIES[s]} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((pt, i) => (
                <circle key={i} cx={pt[0]} cy={pt[1]} r={hover !== null && x(hover) === pt[0] ? 6 : 4.5} fill={SERIES[s]} stroke="#fff" strokeWidth={2} />
              ))}
              {mode === 'sections' && (
                <text x={last[0] + 10} y={last[1] + 4} className="chart-direct">
                  {s === 'rw' ? 'R&W' : 'Math'} {lastVal}
                </text>
              )}
            </g>
          );
        })}
        <defs>
          <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#4aa04a" stopOpacity="0.22" />
            <stop offset="1" stopColor="#4aa04a" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      {hp && (
        <div className="chart-tip" style={{ left: `${(x(hover!) / W) * 100}%` }}>
          <div className="chart-tip-title">{hp.title}</div>
          <div className="chart-tip-sub">{fmtDate(hp.date)}</div>
          {hp.total !== undefined && (
            <div className="chart-tip-row">
              <span>Total</span>
              <b>{hp.total}</b>
            </div>
          )}
          {hp.rw !== undefined && (
            <div className="chart-tip-row">
              <span>
                <i style={{ background: SERIES.rw }} />
                Reading &amp; Writing
              </span>
              <b>{hp.rw}</b>
            </div>
          )}
          {hp.math !== undefined && (
            <div className="chart-tip-row">
              <span>
                <i style={{ background: SERIES.math }} />
                Math
              </span>
              <b>{hp.math}</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── pacing (time per question) ───────────────────────────
export interface PaceItem {
  n: number;
  timeMs: number;
  status: 'right' | 'wrong' | 'omit' | 'nokey';
  qid: string;
}

export function PacingChart({ items, targetMs, onPick }: { items: PaceItem[]; targetMs: number; onPick?: (qid: string) => void }) {
  // wide viewBox so the chart fills the card; scrolls sideways on phones
  const minW = items.length * 24 + 70;
  const W = Math.max(960, minW);
  const H = 200;
  const pad = { l: 48, r: 12, t: 12, b: 26 };
  const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;
  const [hover, setHover] = useState<number | null>(null);
  const maxMs = Math.max(targetMs * 1.6, ...items.map((i) => i.timeMs), 60_000);
  const bw = (W - pad.l - pad.r) / Math.max(items.length, 1);
  const barW = Math.max(6, Math.min(18, bw - 4));
  const y = (ms: number) => pad.t + (1 - ms / maxMs) * (H - pad.t - pad.b);
  const ticks = useMemo(() => {
    const out: number[] = [];
    const stepS = maxMs > 6 * 60_000 ? 120 : maxMs > 3 * 60_000 ? 60 : 30;
    for (let s = 0; s * 1000 <= maxMs; s += stepS) out.push(s * 1000);
    return out;
  }, [maxMs]);
  const hi = hover !== null ? items[hover] : null;
  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        <span>
          <i style={{ background: STATUS.right }} /> Correct
        </span>
        <span>
          <i className="tex-wrong" /> Incorrect
        </span>
        <span>
          <i className="omit" /> Omitted
        </span>
        <span>
          <i className="dash" /> Target pace ({fmtDuration(targetMs)})
        </span>
      </div>
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: minW, maxWidth: 'none' }} className="chart-svg" role="img" aria-label="Time spent per question">
          <defs>
            <pattern id="hatchWrong" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={STATUS.wrong} />
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,.55)" strokeWidth="2.2" />
            </pattern>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#edf1ee" />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="chart-tick">
                {t === 0 ? '0' : clock(t)}
              </text>
            </g>
          ))}
          {items.map((it, i) => {
            const cx = pad.l + bw * i + bw / 2;
            const top = y(Math.max(it.timeMs, 1500));
            const fill = it.status === 'right' ? STATUS.right : it.status === 'wrong' ? 'url(#hatchWrong)' : '#fff';
            return (
              <g
                key={it.qid}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onClick={() => onPick?.(it.qid)}
                style={{ cursor: onPick ? 'pointer' : undefined }}
              >
                <rect x={cx - bw / 2} y={pad.t} width={bw} height={H - pad.t - pad.b} fill={hover === i ? 'rgba(15,76,58,.06)' : 'transparent'} />
                <path
                  d={`M${cx - barW / 2},${H - pad.b} V${top + 4} q0,-4 4,-4 h${barW - 8} q4,0 4,4 V${H - pad.b} Z`}
                  fill={fill}
                  stroke={it.status === 'omit' || it.status === 'nokey' ? STATUS.omit : 'none'}
                  strokeWidth={1.5}
                  strokeDasharray={it.status === 'omit' || it.status === 'nokey' ? '3 2' : undefined}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
                <text x={cx} y={H - 8} textAnchor="middle" className="chart-tick" style={{ fontWeight: hover === i ? 700 : 500 }}>
                  {it.n}
                </text>
              </g>
            );
          })}
          <line x1={pad.l} x2={W - pad.r} y1={y(targetMs)} y2={y(targetMs)} stroke="#33433c" strokeWidth={1.5} strokeDasharray="5 4" />
        </svg>
      </div>
      {hi && (
        <div className="chart-tip static">
          <div className="chart-tip-title">Question {hi.n}</div>
          <div className="chart-tip-row">
            <span>Time</span>
            <b>{fmtDuration(hi.timeMs)}</b>
          </div>
          <div className="chart-tip-row">
            <span>Result</span>
            <b>{hi.status === 'right' ? '✓ Correct' : hi.status === 'wrong' ? '✕ Incorrect' : hi.status === 'nokey' ? 'Not scored' : '— Omitted'}</b>
          </div>
          {hi.timeMs > targetMs * 1.5 && <div className="chart-tip-sub">Slower than your target pace</div>}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── score-report style pieces ───────────────────────────
/** 7-segment performance bar like the official score report. */
export function SegmentBar({ pct }: { pct: number }) {
  const filled = Math.round(Math.max(0, Math.min(1, pct)) * 7);
  return (
    <div className="seg-bar" role="img" aria-label={`${filled} of 7`}>
      {Array.from({ length: 7 }).map((_, i) => (
        <span key={i} className={i < filled ? 'on' : ''} />
      ))}
    </div>
  );
}

/** 200–800 (or 400–1600) scale with the score and its likely range. */
export function ScaleBar({ score, low, high, min, max }: { score: number; low: number; high: number; min: number; max: number }) {
  const p = (v: number) => ((v - min) / (max - min)) * 100;
  return (
    <div className="scale-bar">
      <div className="scale-track">
        <span className="scale-range" style={{ left: `${p(low)}%`, width: `${p(high) - p(low)}%` }} />
        <span className="scale-dot" style={{ left: `${p(score)}%` }} />
      </div>
      <div className="scale-labels">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
