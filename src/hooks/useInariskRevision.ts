import { useSyncExternalStore } from 'react';
import { BnpbIrbiService } from '../services/bnpbIrbiService';
import { subscribeForecast, getForecastRevision } from '../services/weatherForecastAssessment';
function subscribe(listener: () => void) {
  const a = BnpbIrbiService.subscribe(listener), b = subscribeForecast(listener);
  return () => { a(); b(); };
}
const getRevision = () => BnpbIrbiService.getRevision() + getForecastRevision();
export function useInariskRevision() { return useSyncExternalStore(subscribe, getRevision); }
