import { lazy, Suspense, useState } from 'react';
import DisasterDashboard from './components/dashboard/DisasterDashboard';
import KerentananScreen from './components/kerentanan/KerentananScreen';
const PerkiraanScreen = lazy(() => import('./components/perkiraan/PerkiraanScreen'));

type AppScreen = 'dashboard' | 'kerentanan' | 'gunungapi' | 'perkiraan';

function App() {
  const [screen, setScreen] = useState<AppScreen>('dashboard');

  return (
    <div className="app-container">
      {screen === 'dashboard' && (
        <DisasterDashboard
          onSwitchToKerentanan={() => setScreen('kerentanan')}
          onSwitchToPerkiraan={() => setScreen('perkiraan')}
        />
      )}
      {screen === 'kerentanan' && (
        <KerentananScreen onBack={() => setScreen('dashboard')} />
      )}
      {screen === 'perkiraan' && (
        <Suspense fallback={<div className="screen-loading" role="status">Memuat halaman Perkiraan...</div>}>
          <PerkiraanScreen onBack={() => setScreen('dashboard')} />
        </Suspense>
      )}
    </div>
  );
}

export default App;

