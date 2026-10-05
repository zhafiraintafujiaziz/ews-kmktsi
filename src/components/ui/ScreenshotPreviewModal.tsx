import React from 'react';

interface ScreenshotPreviewModalProps {
  isOpen: boolean;
  imageDataUrl: string | null;
  onClose: () => void;
}

const ScreenshotPreviewModal: React.FC<ScreenshotPreviewModalProps> = ({ isOpen, imageDataUrl, onClose }) => {
  if (!isOpen || !imageDataUrl) return null;

  const handleDownload = () => {
    const link = document.createElement('a');
    link.download = `Peta_EWS_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = imageDataUrl;
    link.click();
  };

  return (
    <div className="screenshot-preview-overlay" onClick={onClose}>
      <div className="screenshot-preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="screenshot-preview-header">
          <span className="screenshot-preview-title">Pratinjau Screenshot</span>
          <button className="screenshot-preview-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="screenshot-preview-body">
          <img src={imageDataUrl} alt="Screenshot Preview" className="screenshot-preview-image" />
        </div>
        <div className="screenshot-preview-footer">
          <button className="screenshot-preview-cancel-btn" onClick={onClose}>Tutup</button>
          <button className="screenshot-preview-download-btn" onClick={handleDownload}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Unduh
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScreenshotPreviewModal;