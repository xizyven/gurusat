// Pick a PDF page and drag a box to crop a figure or a whole question.
import { useEffect, useRef, useState } from 'react';
import { cropImage, openPdf, renderPage } from '../lib/pdf';
import { Icon } from './Icon';
import { Modal, Spinner } from './ui';

// pages of the last opened PDF stay in memory while the app is open
export const pdfSession: { name: string; pages: string[] } = { name: '', pages: [] };

export async function loadPdfPages(file: File, onProgress?: (p: number) => void): Promise<string[]> {
  const doc = await openPdf(file);
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    pages.push(await renderPage(doc, i, 2));
    onProgress?.(i / doc.numPages);
  }
  pdfSession.name = file.name;
  pdfSession.pages = pages;
  return pages;
}

export function PdfCropper({ onCrop, onClose, title = 'Crop from PDF', multi }: { onCrop: (dataUrl: string) => void; onClose: () => void; title?: string; multi?: boolean }) {
  const [pages, setPages] = useState<string[]>(pdfSession.pages);
  const [page, setPage] = useState<number | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [count, setCount] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setRect(null), [page]);

  const pick = async (f?: File) => {
    if (!f) return;
    setLoading(0);
    try {
      const p = await loadPdfPages(f, (x) => setLoading(x));
      setPages(p);
      setPage(null);
    } finally {
      setLoading(null);
    }
  };

  const down = (e: React.PointerEvent) => {
    const box = boxRef.current!.getBoundingClientRect();
    const sx = (e.clientX - box.left) / box.width;
    const sy = (e.clientY - box.top) / box.height;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const cx = Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width));
      const cy = Math.max(0, Math.min(1, (ev.clientY - box.top) / box.height));
      setRect({ x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const use = async () => {
    if (page === null || !rect || rect.w < 0.01 || rect.h < 0.01) return;
    const url = await cropImage(pages[page], rect);
    onCrop(url);
    setCount((c) => c + 1);
    setRect(null);
    if (!multi) onClose();
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      icon={<Icon name="crop" />}
      footer={
        page !== null ? (
          <>
            {multi && count > 0 && <span className="muted" style={{ marginRight: 'auto', fontSize: 13 }}>{count} added</span>}
            <button className="btn" onClick={() => setPage(null)}>
              <Icon name="arrowLeft" size={16} /> All pages
            </button>
            <button className="btn btn-primary" disabled={!rect || rect.w < 0.01} onClick={use}>
              <Icon name="check" size={16} /> {multi ? 'Add this crop' : 'Use this crop'}
            </button>
          </>
        ) : undefined
      }
    >
      <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {loading !== null ? (
        <Spinner label={`Rendering pages… ${Math.round(loading * 100)}%`} />
      ) : !pages.length ? (
        <button className="dropzone" style={{ width: '100%' }} onClick={() => fileRef.current?.click()}>
          <div className="dropzone-ic">
            <Icon name="file" size={26} />
          </div>
          <h3>Choose a PDF</h3>
          <p>Pick the teacher's file, then drag a box around what you need.</p>
        </button>
      ) : page === null ? (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              {pdfSession.name} · {pages.length} pages — click a page
            </span>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              Different PDF
            </button>
          </div>
          <div className="pdf-pages">
            {pages.map((p, i) => (
              <button key={i} className="pdf-thumb" onClick={() => setPage(i)}>
                <img src={p} alt={`Page ${i + 1}`} loading="lazy" />
                <span>{i + 1}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="hint" style={{ marginBottom: 10 }}>
            Page {page + 1} — drag to draw a box around the graph, table, or whole question.
          </p>
          <div style={{ maxHeight: '62vh', overflow: 'auto', textAlign: 'center', background: '#f2f5f3', borderRadius: 12, padding: 10 }}>
            <div className="cropper" ref={boxRef} onPointerDown={down}>
              <img src={pages[page]} alt={`Page ${page + 1}`} draggable={false} />
              {rect && <div className="crop-rect" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} />}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
