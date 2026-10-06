# Local database development

This app uses SQLite through Drizzle and `@libsql/client` for reports, preparedness
checklists, and alert history. Database access runs in the backend. The browser
only calls `/api` endpoints.

## Start locally

1. Run `npm install`.
2. Copy `.env.example` to `.env.local` if you want to override the defaults.
   The default connection is `TURSO_DATABASE_URL=file:local.sqlite` with no token.
3. Run `npm run dev`. Its `predev` script applies the committed migrations before
   Vite starts. The existing local API middleware also serves the database routes.

The SQLite file is created in the project directory. Reports and checklist
progress remain available after browser reloads and server restarts. `npm run
db:migrate` applies migrations explicitly; `npm run db:generate` creates a new
migration after a schema change. Run `npm run db:migrate` before `npm run preview`
when using a fresh database. No Turso account or CLI is required for local use.

## Browser data import

The first report/checklist request imports the existing
`ews-mktbi:laporan-kpw` and `ews-mktbi:kpw-checklist` browser data in one transaction.
The original keys remain intact. A stable browser ID and a receipt inside the
database prevent repeated imports. Existing database values win over older
browser snapshots. Failed imports can be retried; invalid browser data is retained
and reported in the UI. Switching to a new database imports those snapshots again
after a browser reload. Export current database data separately when moving it.

New reports use stable IDs so a retry after a lost response does not duplicate the
report. Checklist changes appear after the server confirms persistence. Failed
saves keep form inputs and show an error; checklist loading failures offer a retry.

## API

| Endpoint | Behavior |
|---|---|
| `GET /api/reports` | List reports, newest first |
| `POST /api/reports` | Save an immutable report with its ID and `createdAt` |
| `GET /api/checklist` | Load all office/item states |
| `PUT /api/checklist` | Upsert `{ officeId, itemId, checked }` |
| `POST /api/import` | Atomically import `{ browserId, reports, checklistItems }` once per browser/database |
| `POST /api/alerts` | Ingest `{ records }`, at most 100 normalized records per request |
| `GET /api/alerts` | List history with the original record and first/last collection times |
| `GET /api/alert-cache` | Load the latest complete successful snapshot of each feed |
| `POST /api/alert-cache` | Replace a feed snapshot with `{ feed, checkedAt, records }`, including an empty response |

Report and history lists accept `limit` up to 100 and an `offset`; history also
accepts `feed`. Lists never automatically delete older records. Request bodies
must be JSON and are limited to 4 MiB. Validation failures return 400, unsupported
methods 405, and database failures 503. Database credentials are never returned.

## Alert history

Validated records from successful feed polls are archived while
the dashboard is open. The key is feed + record ID + revision. Repeated sightings
update `lastSeenAt` while preserving the first payload and `firstSeenAt`; a new
revision creates a new row. Raw source records and GeoJSON are retained.

There is no independent collector, automatic retention cleanup, or history UI.
Closing the dashboard stops its polling and cancels pending history batches.
History write failures log a warning without blocking live alerts. Records
continue accumulating until manually deleted; track file size as history grows.
Current geographic calculations and alert freshness rules remain unchanged.

## Cached initial alerts

On opening the dashboard, saved feed snapshots load from SQLite while the usual
live polls run in parallel. Usable cached alerts appear without waiting for all
external feeds. The header shows `Cache`, the saved time in WIB, and whether a
refresh is running. Hover it to see the full saved date. Cached alerts do not
trigger automatic new-alert notifications until confirmed by a live response.

The existing freshness rules filter cached records at display time. Successful
live responses replace their feed's snapshot, including empty responses, while
failed feeds retain only currently usable cached alerts. A late cache response
cannot overwrite a successful live response. Older writes cannot overwrite a
newer saved snapshot. History remains separate and is never deleted by refreshes.

The first successful poll after this migration fills the snapshot cache. Existing
history is not used as a current snapshot because it includes revisions and
alerts that a source may have removed. An empty or unavailable cache falls back
to the normal live load. External requests and the 60-second refresh continue;
geographic assessment caches are unchanged. Closing the dashboard cancels cache
requests as well as history writes.

## Later Turso Cloud / Vercel setup

The connection supports a remote Turso libSQL URL and `TURSO_AUTH_TOKEN` without
changing the schema or query layer. Apply the same migrations to the cloud database
and export/import local records separately if needed. Store production credentials
only in Vercel's backend environment variables, never `VITE_*` variables.

The new database endpoints deliberately return 503 whenever `VERCEL` is set.
Before enabling them for a deployment, implement and test authentication and
authorization, then replace that guard with the access checks. The existing
external-feed proxy is unaffected. A SQLite file bundled into a Vercel deployment
is not persistent writable database storage.

## Verify

Run `npm test`, `npm run lint`, and `npm run build`. Persistence tests use temporary
databases, including close/reopen, repeatable migrations, deduplication, atomic
browser import, HTTP validation, failure handling, and browser reload scenarios.
