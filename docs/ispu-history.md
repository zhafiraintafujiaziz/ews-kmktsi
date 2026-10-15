# Daily ISPU archive

The archive currently uses local SQLite, by default `local.sqlite` in the project directory. No Turso account, cloud token, Vercel connection or running dashboard is required. The collector requests the KemenLH `getStations` feed directly and shares the existing Drizzle/libSQL database with the app.

Run `npm run ispu:collect` for a single collection. The command applies committed migrations first, saves today's first successful snapshot, logs to `logs/ispu-daily.jsonl`, and exits. A failed collection exits with a nonzero code. Subsequent successful calls that day return `already_collected` without requesting the feed again. Logs and the SQLite file are gitignored.

`GET /api/cron/ispu` remains available through the local API server as an optional HTTP entry point. It requires `Authorization: Bearer <CRON_SECRET>` before opening the database or requesting the feed. The command-line collector does not need that secret. The existing reports, checklists, imports and alert history production restrictions remain in place. The Vercel cron schedule has been removed while cloud setup is deferred.

The collector makes at most three requests, each with a 10-second timeout covering headers and body. Network errors, timeouts, HTTP 408/429/5xx, invalid JSON and malformed/empty station responses retry after 2 and 5 seconds. Other HTTP errors fail immediately. Database failures do not trigger another upstream fetch.

## Storage and dates

Apply `drizzle/0003_chunky_sugar_man.sql` through the existing migration runner. `ispu_daily_runs` has one row per WIB calendar date. A failed row records the latest invocation's failure details and can be replaced by a later successful invocation that same day. Attempt counts are per invocation. A successful row is immutable.

`ispu_daily_readings` has a primary key on collection date and station ID, plus an index on station ID and date. The run and all its readings commit in one write transaction. A second successful collector sees the winner inside the transaction and does not change it. A late failure also cannot replace a successful run.

The archive keeps all accepted stations, including healthy and stale readings. A reading requires a nonblank station ID and a finite nonnegative ISPU value. Blank, null, boolean and invalid numeric values are rejected. Duplicate station IDs keep their first accepted row and count subsequent rows as rejected. Invalid coordinates become null and receive a flag. Every original row, including rejected rows, remains in the exact successful response text stored in `raw_response`.

Each reading preserves `waktu`, `waktu_text` and `time_z` separately. ISO timestamps with explicit offsets and recognized WIB/WITA/WIT/UTC/GMT source zones are parsed deterministically. An explicit `time_z` can resolve a timezone-free source timestamp. Unknown zones and ambiguous timestamps stay unresolved. No timestamp inherits the server timezone.

Flags distinguish observations older than 24 hours at fetch time, future observations, undated/ambiguous/invalid timestamps, and invalid coordinates. There is no automatic deletion. Collection never backfills an earlier day. A fetch that crosses WIB midnight fails, and a later invocation collects the new date. The scheduled time labels the day's nominal target; `fetched_at` records the actual request start and each station has its own observation time.

## Local setup and daily schedule

```powershell
# SQLite is already the default; .env.local is optional.
npm run ispu:collect

# Windows only: register or update this checkout's daily 08:30 WIB task.
npm run ispu:schedule
```

The connection variable retains its existing name, `TURSO_DATABASE_URL=file:local.sqlite`, even though this uses a local file and needs no Turso service. `TURSO_AUTH_TOKEN` can remain unset. The local collector rejects remote database URLs. A different SQLite file URL can be configured in `.env.local`; keep it consistent with the application and export command.

The Windows scheduler setup requires the computer timezone to be `SE Asia Standard Time`, UTC+07:00 WIB. It registers a task for the current user with limited privileges and a stable name containing this checkout's path hash. The action runs Node directly with the project as its working directory. It does not start Vite or a browser. Re-running setup updates only the task owned by this script. It never replaces another task with a conflicting name.

The task uses `StartWhenAvailable`, ignores overlapping starts and permits up to two minutes for the process. The collector's request timeouts and retry delays remain unchanged. The machine must be on and the Windows user logged in. Missed starts can run later when the task becomes available; any later collection records its actual WIB date and never backfills a missed day. The setup command prints the task name and next run time. Inspect that task in Windows Task Scheduler and use `logs/ispu-daily.jsonl` plus the database run rows to diagnose failures. To remove it later, delete that exact task in Task Scheduler.

Keep `local.sqlite` when restarting the app, updating the code or moving the checkout. If the checkout moves, remove the task that points to the old path and register it again from the new directory. Back up the SQLite file while no collector or application write is running. History begins with the first saved snapshot. Earlier daily readings cannot be reconstructed from today's feed.

Local validation on 2026-10-15 reached the source with HTTP 200. An isolated temporary database accepted all 120 stations, including 25 healthy readings, with no rejected, stale or undated rows in that response. Closing and reopening the database preserved the snapshot. A station query returned a null for the previous day and the saved value for the collection date. That temporary database was removed after verification.

Vercel/Turso deployment is deferred. Local SQLite also works for a local production build. Vercel-hosted functions still reject local SQLite to avoid treating their temporary filesystem as persistent history. No cloud environment or deployment changes are needed for this local workflow.

## CSV export

Run exports from this project directory using the same SQLite configuration as the collector. Date limits are inclusive. The station filter is optional and uses the source station ID exactly.

```powershell
npm.cmd run --silent ispu:export -- --from 2026-10-15 --to 2026-10-31 > ispu-history.csv
npm.cmd run --silent ispu:export -- --from 2026-10-15 --to 2026-10-31 --station DLH_MEDAN_02 > medan-ispu.csv
```

These PowerShell examples use `npm.cmd` so npm's PowerShell wrapper does not consume the argument separator. In other shells use `npm`. Use `--silent` so npm does not insert its script banner into the CSV. You can also run `node --experimental-strip-types scripts/export-ispu.ts --from 2026-10-15 --to 2026-10-31` directly. Output streams in pages of 1,000 rows and includes observation text, parsed time and flags. Quoting escapes commas, quotes and newlines; external text beginning with a spreadsheet formula prefix receives an apostrophe. No rows are invented for days without collection.

## History graphs and rankings in Kerentanan, Kualitas Udara

Open Kerentanan and select Kualitas Udara. The history sidebar appears on the right at desktop widths of 1280px and above. On smaller screens, history follows the map; on phones the office list follows history. The initial graph uses the archived station nearest Bank Indonesia Kantor Pusat. Choosing another office selects its nearest archived station and clears the manual override.

Search for a city to show a separate line for each station historically associated with that city and province. The station picker searches all archived stations and focuses on one station. Station lines never splice different station IDs together. Where a station has moved, city graphs include only that station's observations actually archived in the selected city. The latest valid archived coordinates determine distance to the selected office.

The initial range is 30 WIB calendar days ending today. Choose 7, 30 or 90 days, or enter inclusive custom dates up to 3,661 days. Missing days remain gaps; a single day displays individual points. The sidebar shows archive coverage, an interactive station legend, point details and an expandable daily-data table. Hollow points indicate quality flags. Point details support mouse, touch and keyboard interaction and retain original observation times. Choices persist while switching this screen's subtabs. Reading or refreshing history only queries SQLite and never runs the collector.

Both national top-10 tables appear below the graph. The Stasiun/Kota switch changes their grouping; city scores are the highest eligible station ISPU on the selected archived date. City rows name that contributing station and show the eligible station count. The date selector defaults to the latest successful collection date within the graph range and never mixes different collection days. Ranking scope remains nationwide regardless of the graph's city or station selection. Clicking a ranking row selects that location in the graph and brings its controls into view.

Rankings exclude stale, undated, ambiguous-time, invalid-time and future-time observations based on flags at collection time, rather than age relative to today. An invalid-coordinate flag alone does not exclude an otherwise eligible reading. Tables report excluded observations, show at most ten actual entries, and use stable tie ordering. City entries group matching city names within the same province. A missing city label is excluded from city rankings while its station can still qualify for station rankings.

### Read-only local API

`GET /api/ispu-history` returns JSON with `Cache-Control: no-store`. It supports the local development and preview servers and returns 503 on Vercel. No `CRON_SECRET` is required to read this local endpoint. Other methods return 405, malformed inputs return 400, and unavailable storage returns 503 without private database details.

| Action | Parameters | Response |
|---|---|---|
| `directory` | `action=directory` | Stations, cities with opaque `cityKey` values, archive coverage and successful collection dates |
| `series` | `action=series`, `from`, `to`, and exactly one of `stationId` or `cityKey` | Separate station series containing date, value and reading metadata |
| `rankings` | `action=rankings`, `date`, `groupBy=station` or `city` | Best/worst lists, eligible/excluded observation counts and ranked-location count |

City keys come from the directory; pass them through `URLSearchParams`. Raw upstream responses and backend credentials never appear in these responses. Frontend requests time out after 15 seconds, cancel when superseded or hidden, and cannot replace a newer selection with an older result.

### Archive query helpers

The data supports a daily time series per station. `queryIspuTimeSeries(store, { from, to, stationId })` in `server/ispuHistory.ts` returns points ordered by WIB collection date, with `value: null` and `reading: null` on missing days. The range is inclusive and limited to 3,661 days for a graph. CSV export supports longer ranges.

```ts
const series = await queryIspuTimeSeries(store, {
  from: '2026-10-15',
  to: '2026-11-14',
  stationId: 'JAKARTA',
});
// series.scale === 'ISPU'
// series.dateBasis === 'collection_date'
// series.timeZone === 'Asia/Jakarta'
// series.points = [{ date, value, reading }, ...]
```

Use collection date for the X axis and ISPU for the Y axis. Disable interpolation across nulls. Show the observation time and quality flags in tooltips, and distinguish stale/undated points from current observations. Repeated stale observations are repeated availability snapshots, not new daily measurements. This series is not a daily average, maximum, forecast or US AQI series.

Each source station ID stays a separate line. Office selection resolves a station for the requested series rather than splicing the nearest station from each different day. Station metadata stays on each point, so relocations or renamed stations can be inspected. Earlier daily snapshots cannot be reconstructed from this current feed. A useful multi-day graph starts accumulating only when collection begins.

The sidebar uses `queryIspuHistorySeries` for station/city selections and `queryIspuRankings` for comparisons. The single-station helper and CSV operator command remain compatible.

## Verification

`tests/ispuHistory.test.ts` checks WIB/year boundaries, explicit source zones and unresolved times, missing numeric values, all-station retention, duplicate/concurrent invocations, retries, midnight crossover, rollback, HTTP auth, local SQLite, Vercel guards, persistence, CSV pagination and series gaps. It also covers historical city membership, latest valid coordinates, nearest-station selection, same-day top-10 rankings, city maximum calculations, exclusions, ties, zero values, extreme chart values, read API validation, storage failures and cancellation. Run `npm test`, `npm run lint` and `npm run build` after code changes.
