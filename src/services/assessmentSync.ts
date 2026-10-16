import { KPWBI_OFFICES } from '../constants/kpwbiOffices';
import { BnpbIrbiService } from './bnpbIrbiService';
import { logSyncFailure } from './syncDiagnostics';

const IRBI_DATA_ENDPOINT = 'https://inarisk.bnpb.go.id/apiv4/data-irbi-full';

const assessments = [
  { source: 'BNPB IRBI', category: 'irbi', endpoint: IRBI_DATA_ENDPOINT,
    refresh: () => BnpbIrbiService.refreshAssessment(KPWBI_OFFICES) },
];
const running = new Map<string, Promise<void>>();

export function refreshBackgroundAssessments(throwOnError = false): Promise<void> {
  return Promise.all(assessments.map(({ source, category, endpoint, refresh }) => {
    const pending = running.get(category);
    if (pending) return pending;
    const request = Promise.resolve().then(refresh).catch(error => {
      logSyncFailure({ source, category, endpoint }, error);
      if (throwOnError) throw error;
    }).finally(() => running.delete(category));
    running.set(category, request);
    return request;
  })).then(() => {});
}
