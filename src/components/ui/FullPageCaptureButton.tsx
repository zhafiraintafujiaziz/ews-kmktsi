import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import Alert from '@mui/material/Alert';

interface FullPageCaptureButtonProps {
  targetRef?: RefObject<HTMLElement | null>;
  filename?: string;
}

export default function FullPageCaptureButton({
  targetRef,
  filename = 'Dashboard_EWS',
}: FullPageCaptureButtonProps) {
  const [capturing, setCapturing] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captureInProgress = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureController = useRef<AbortController | null>(null);

  useEffect(() => () => {
    captureController.current?.abort();
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
  }, []);

  const handleCapture = async () => {
    if (captureInProgress.current || captured) return;
    captureInProgress.current = true;
    const controller = new AbortController();
    captureController.current = controller;
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    setCapturing(true);
    setCaptured(false);
    setError(null);

    try {
      const element = targetRef?.current
        || document.querySelector<HTMLElement>('main.dashboard-shell')
        || document.querySelector<HTMLElement>('main')
        || document.querySelector<HTMLElement>('.app-container')
        || document.body;
      const { default: html2canvas } = await import('html2canvas-pro');
      if (controller.signal.aborted) return;

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: '#ffffff',
        width: element.scrollWidth,
        height: element.scrollHeight,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight,
        signal: controller.signal,
        onclone: (clonedDocument) => {
          clonedDocument.querySelectorAll<HTMLElement>('[data-capture-control]').forEach((control) => {
            control.style.visibility = 'hidden';
          });
        },
      });
      if (controller.signal.aborted) return;

      const link = document.createElement('a');
      link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = canvas.toDataURL('image/png');
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
      }

      setCaptured(true);
      resetTimer.current = setTimeout(() => {
        setCaptured(false);
        resetTimer.current = null;
      }, 2200);
    } catch (captureError) {
      if (!controller.signal.aborted) {
        console.error('Gagal mengambil screenshot', captureError);
        setError('Gagal mengambil screenshot. Silakan coba lagi.');
      }
    } finally {
      captureInProgress.current = false;
      captureController.current = null;
      if (!controller.signal.aborted) setCapturing(false);
    }
  };

  return (
    <span className="full-page-capture-control" data-capture-control>
      <button
        className={`topbar-report-btn${captured ? ' screenshot-captured' : ''}`}
        type="button"
        onClick={handleCapture}
        disabled={capturing || captured}
        aria-busy={capturing}
        title="Screenshot Dashboard"
      >
        {capturing ? (
          <svg className="screenshot-capture-spinner" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="9" opacity="0.25" />
            <path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round" />
          </svg>
        ) : captured ? (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        )}
        <span aria-live="polite">{capturing ? 'Mengambil...' : captured ? 'Tersimpan!' : 'Screenshot'}</span>
      </button>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 300, zIndex: 10000 }}>
          {error}
        </Alert>
      )}
    </span>
  );
}
