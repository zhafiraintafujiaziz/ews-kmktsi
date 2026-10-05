import React, { useState } from 'react';
import MingguanTab from './MingguanTab';
import JangkaPanjangTab from './JangkaPanjangTab';

type MainTab = 'mingguan' | 'jangka_panjang';

interface PerkiraanScreenProps {
  onBack: () => void;
}

const PerkiraanScreen: React.FC<PerkiraanScreenProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<MainTab>('mingguan');

  return (
    <div className="perkiraan-container">
      <header className="topbar-container">
        <div className="topbar-first-row">
          <div className="topbar-brand">
            <button className="topbar-back-btn" onClick={onBack}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Kembali
            </button>
            <div className="topbar-divider-v" />
            <div className="topbar-brand-text">
              <h1 className="topbar-title">Halaman <span>Perkiraan</span></h1>
              <span className="topbar-brand-sub">DEWA - Kesiapsiagaan KPw BI</span>
            </div>
          </div>

          <div className="topbar-right">
            <div className={`topbar-status ${activeTab === 'mingguan' ? 'monitoring' : 'clear'}`}>
              <span className="topbar-status-dot" />
              <span>{activeTab === 'mingguan' ? '📅 Prakiraan 3 Hari' : '📊 Analisis Strategis'}</span>
            </div>
          </div>
        </div>

        {/* Center: tab switcher — pills always expanded */}
        <div className="topbar-center">
          <div className="topbar-filter-group perkiraan">
            <button
              className={`topbar-filter-pill perkiraan-pill${activeTab === 'mingguan' ? ' active' : ''}`}
              onClick={() => setActiveTab('mingguan')}
            >
              <span>📅</span>
              <span>Mingguan</span>
            </button>
            <button
              className={`topbar-filter-pill perkiraan-pill${activeTab === 'jangka_panjang' ? ' active' : ''}`}
              onClick={() => setActiveTab('jangka_panjang')}
            >
              <span>📊</span>
              <span>Jangka Panjang</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main content area */}
      <div className="perkiraan-body">
        {activeTab === 'mingguan' && (
          <div className="mingguan-container" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <div className="perkiraan-subtabs">
              <button className="perkiraan-subtab-btn active">
                <span>🌦️</span>
                <span>Cuaca</span>
              </button>
            </div>
            <div className="mingguan-body" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <MingguanTab />
            </div>
          </div>
        )}
        {activeTab === 'jangka_panjang' && <JangkaPanjangTab />}
      </div>
    </div>
  );
};

export default PerkiraanScreen;
