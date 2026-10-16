export interface SyncContext {
  source: string;
  category: string;
  endpoint?: string;
  officeId?: string;
  officeCount?: number;
  valueCount?: number;
  failedOfficeCount?: number;
}

export function syncErrorDetails(error: unknown): Record<string, unknown>[] {
  if (error instanceof AggregateError) return error.errors.flatMap(syncErrorDetails);
  const detail = error instanceof Error ? error as Error & { kind?: string; status?: number; endpoint?: string; officeId?: string } : null;
  const reason = detail?.message ?? String(error);
  const kind = detail?.kind ?? (/timed out|timeout|batas waktu|tidak merespons/i.test(reason) ? 'timeout'
    : error instanceof SyntaxError || /invalid|tidak valid|missing|bukan raster/i.test(reason) ? 'invalid_response'
    : /HTTP|Direct fetch failed/i.test(reason) ? 'http_error' : 'request_error');
  return [{ reason, kind, ...(detail?.status !== undefined ? { status: detail.status } : {}),
    ...(detail?.endpoint ? { endpoint: detail.endpoint } : {}), ...(detail?.officeId ? { officeId: detail.officeId } : {}) }];
}

export function logSyncFailure(context: SyncContext, error: unknown) {
  console.error('[sync] ' + context.source + ' gagal', {
    ...context, checkedAt: new Date().toISOString(), errors: syncErrorDetails(error),
  }, error);
}
