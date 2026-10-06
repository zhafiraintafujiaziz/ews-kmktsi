import { useSyncExternalStore } from 'react';
import { BnpbInariskService } from '../services/bnpbInariskService';
import { KarhutlaRegionalService } from '../services/karhutlaRegionalService';
import { subscribeForecast, getForecastRevision } from '../services/weatherForecastAssessment';
function subscribe(listener: () => void) {
  const a = BnpbInariskService.subscribe(listener), b = subscribeForecast(listener), c = KarhutlaRegionalService.subscribe(listener);
  return () => { a(); b(); c(); };
}
const getRevision = () => BnpbInariskService.getRevision() + getForecastRevision() + KarhutlaRegionalService.getRevision();
export function useInariskRevision() { return useSyncExternalStore(subscribe, getRevision); }
