import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { AlertBatchSchema, AlertSnapshotSchema, BrowserImportSchema, ChecklistItemSchema, ListQuerySchema, ReportSchema } from '../src/domain/persistence.ts';
import { getDatabase } from './database.ts';
import { createRepository, type Repository } from './repository.ts';

type Request = IncomingMessage & { body?: unknown };
export type Resource = 'reports' | 'checklist' | 'alerts' | 'import' | 'alert-cache';
const BODY_LIMIT = 4 * 1024 * 1024;

class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req: Request): Promise<unknown> {
  if (req.body !== undefined) {
    const value = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(value) > BODY_LIMIT) throw new RequestError(413, 'Request too large');
    try { return JSON.parse(value); } catch { throw new RequestError(400, 'Invalid JSON'); }
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT) {
      req.resume();
      throw new RequestError(413, 'Request too large');
    }
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(400, 'Invalid JSON'); }
}

export function createHandler(resource: Resource, repository?: Repository) {
  return async (req: Request, res: ServerResponse) => {
    // These endpoints have no authentication yet. Never expose them on Vercel.
    if (process.env.VERCEL) {
      send(res, 503, { error: 'Database APIs are local-only until authentication is configured.' });
      return;
    }
    const allowed = resource === 'import' ? ['POST'] : resource === 'checklist' ? ['GET', 'PUT'] : ['GET', 'POST'];
    if (!allowed.includes(req.method || '')) {
      res.setHeader('Allow', allowed.join(', '));
      send(res, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      if (req.method !== 'GET') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new RequestError(403, 'Cross-origin writes are not allowed');
        if (!req.headers['content-type']?.startsWith('application/json')) throw new RequestError(415, 'Use application/json');
      }
      const query = new URL(req.url || '/', 'http://localhost').searchParams;
      const pagination = ListQuerySchema.parse(Object.fromEntries(query));
      // Validate before opening the database, so malformed input always gets 400.
      const body = req.method === 'GET' ? undefined : await readBody(req);
      if (resource === 'reports' && req.method === 'POST') {
        const report = ReportSchema.parse(body);
        const store = repository || createRepository(getDatabase());
        send(res, 200, { report: await store.saveReport(report) });
      } else if (resource === 'checklist' && req.method === 'PUT') {
        const item = ChecklistItemSchema.parse(body);
        const store = repository || createRepository(getDatabase());
        send(res, 200, { item: await store.saveChecklist(item) });
      } else if (resource === 'alerts' && req.method === 'POST') {
        const { records } = AlertBatchSchema.parse(body);
        const store = repository || createRepository(getDatabase());
        send(res, 200, await store.ingestAlerts(records));
      } else if (resource === 'alert-cache' && req.method === 'POST') {
        const snapshot = AlertSnapshotSchema.parse(body);
        const store = repository || createRepository(getDatabase());
        send(res, 200, await store.saveAlertSnapshot(snapshot));
      } else if (resource === 'import') {
        const input = BrowserImportSchema.parse(body);
        const store = repository || createRepository(getDatabase());
        send(res, 200, await store.importBrowserData(input));
      } else {
        const store = repository || createRepository(getDatabase());
        if (resource === 'reports') send(res, 200, { reports: await store.listReports(pagination.limit, pagination.offset) });
        else if (resource === 'checklist') send(res, 200, { items: await store.listChecklist() });
        else if (resource === 'alert-cache') send(res, 200, { snapshots: await store.listAlertSnapshots() });
        else send(res, 200, { records: await store.listAlerts(pagination.limit, pagination.offset, pagination.feed) });
      }
    } catch (error) {
      if (error instanceof ZodError) send(res, 400, { error: 'Invalid request', fields: error.issues.map(issue => issue.path.join('.')) });
      else if (error instanceof RequestError) send(res, error.status, { error: error.message });
      else send(res, 503, { error: 'Database unavailable. Check the backend connection and run npm run db:migrate.' });
    }
  };
}
