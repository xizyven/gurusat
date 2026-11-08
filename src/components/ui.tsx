// Shared UI primitives: modal, confirm dialog, toasts, logo, rendered markup.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { renderMarkup } from '../lib/markup';
import { Icon } from './Icon';

const BASE = import.meta.env.BASE_URL;

export function Logo({ variant = 'wordmark', height = 28 }: { variant?: 'wordmark' | 'mark'; height?: number }) {
  return (
    <img
      src={`${BASE}brand/${variant}.png`}
      alt="GuruSat"
      style={{ height, width: 'auto', display: 'block' }}
      draggable={false}
    />
  );
}

export function Markup({ src, className = '', as: Tag = 'div' }: { src?: string; className?: string; as?: 'div' | 'span' }) {
  return <Tag className={`mk ${className}`} dangerouslySetInnerHTML={{ __html: renderMarkup(src) }} />;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  icon,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  icon?: ReactNode;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        {title && (
          <div className="modal-head">
            {icon}
            <h3>{title}</h3>
            <span className="spacer" />
            <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ───── confirm() replacement ─────
type ConfirmReq = { title: string; body?: ReactNode; ok?: string; danger?: boolean; resolve: (v: boolean) => void };
let confirmReq: ConfirmReq | null = null;
const confirmListeners = new Set<() => void>();
export function confirmDialog(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    confirmReq = { ...opts, resolve };
    confirmListeners.forEach((l) => l());
  });
}

export function ConfirmHost() {
  const req = useSyncExternalStore(
    (cb) => {
      confirmListeners.add(cb);
      return () => confirmListeners.delete(cb);
    },
    () => confirmReq,
  );
  if (!req) return null;
  const done = (v: boolean) => {
    confirmReq = null;
    confirmListeners.forEach((l) => l());
    req.resolve(v);
  };
  return (
    <Modal
      title={req.title}
      onClose={() => done(false)}
      footer={
        <>
          <button className="btn" onClick={() => done(false)}>
            Cancel
          </button>
          <button className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => done(true)} autoFocus>
            {req.ok ?? 'OK'}
          </button>
        </>
      }
    >
      {req.body && <div className="muted">{req.body}</div>}
    </Modal>
  );
}

// ───── toasts ─────
let toasts: { id: number; text: string }[] = [];
const toastListeners = new Set<() => void>();
let toastId = 0;
export function toast(text: string) {
  const id = ++toastId;
  toasts = [...toasts, { id, text }];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    toastListeners.forEach((l) => l());
  }, 2800);
}

export function ToastHost() {
  const list = useSyncExternalStore(
    (cb) => {
      toastListeners.add(cb);
      return () => toastListeners.delete(cb);
    },
    () => toasts,
  );
  return createPortal(
    <div className="toasts">
      {list.map((t) => (
        <div className="toast" key={t.id}>
          <Icon name="check" size={18} className="ok" />
          {t.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'center', padding: 40, gap: 12, color: 'var(--muted)' }}>
      <div className="spinner" />
      {label}
    </div>
  );
}
