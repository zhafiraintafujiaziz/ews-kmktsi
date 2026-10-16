# Browser storage and public feeds

Vercel builds default to `browser` data mode. Vite development and local builds default to `local`, which preserves SQLite and the local collector. Set `VITE_DATA_MODE=browser` before starting Vite or building to test hosted behavior locally. Only this public mode setting uses a VITE prefix; database credentials and provider keys remain backend-only.

## What changes on Vercel

The app reads named `/api/feeds?feed=...` endpoints instead of forwarding entire upstream documents through `/api/proxy`. Source parsing runs in the function and returns the existing alert data, map geometry, source timestamps and validity periods. IRBI includes only the three required hazard fields for mapped office regions and their latest FINAL source years. Unmapped regions and unused fields never reach the browser.

Successful public responses specify `Vercel-CDN-Cache-Control` and contain an absolute `fetchedAt` / `freshUntil` window. The browser uses that original window, including when it receives an older CDN response. Failures are small `503` responses with `no-store`. The raw proxy returns `410` on Vercel and remains available for local diagnostics.

| Feed | Freshness window |
| --- | --- |
| Earthquakes, current weather warnings, volcanic ash | 5 minutes |
| ISPU, fire hotspots, airport closures | 15 minutes |
| Forecasts, province weather, volcano reports | 1 hour |
| IRBI reference scores | 24 hours |

Only overdue feeds request new data. Requests pause in hidden/offline pages and resume once overdue when visible/online. Source expiry rules still remove unusable alerts. A 30-second local scheduler checks due times and expires displayed records; it does not request every feed every 30 seconds. Concurrent calls share a promise; supported browsers also use Web Locks and storage events across same-origin tabs. Failed fetches back off for 30, 60, 120 and then 300 seconds. Manual page controls do not bypass fresh public caches.

No cloud database, Blob, KV, Runtime Cache or cron schedule is added. Temporary CDN response caching reduces origin transfer. Static bundles continue to use normal Vercel static hosting. The hosted frontend makes no requests to reports, checklist, import, alert-history, alert-cache, ISPU-history or collection APIs. Their existing local-server restrictions remain intact.

## Data saved in this browser

Reports and checklist entries use separate application-prefixed, versioned localStorage keys. Old browser report/checklist keys migrate without overwriting existing entries, and the original keys remain available for recovery. User-authored data is never automatically evicted. The hosted app does not retain a growing alert-history log; only current alert snapshots are cached.

Live-feed caches share a 1 MiB serialized UTF-16 budget. ISPU history uses a dictionary of repeated strings and compact rows, capped at 2 MiB and 90 days. Whole oldest days are removed when necessary. Cache data is replaceable; report saves may reclaim caches and oldest archived days before reporting a quota failure. A failed report or checklist save never displays a success message or clears the form.

Backup controls on the checklist and ISPU history panels export/import a versioned JSON file containing reports, checklists and retained ISPU history. Existing identities win on import. Validation happens before applying incoming records; if storage fills during import, successfully imported entries remain and the error is shown, so retrying is safe. Clearing browser/site storage removes these records. Different devices, browsers, preview hosts and production domains have separate storage; use a backup to move data.

## Browser ISPU history

The first successful current-day ISPU response obtained while the app is open creates that WIB day's snapshot. A previous-day cached response cannot create today's snapshot. The browser does not backfill missing days, fetch merely to fill an archive, or run when closed. Dates represent collection days and retain the original observation times and quality flags. Healthy and stale accepted observations remain in the archive; the existing ranking rules exclude ineligible observations. Charts, city/station lookup, rankings and Excel export query browser data in browser mode.

Local SQLite collection, its complete raw-response archive and Windows scheduling remain separate and unchanged.

## Verification and release

Run `npm test`, `npm run lint`, and builds in both modes. Test browser mode using `VITE_DATA_MODE=browser` and Vite on a dedicated localhost port. Check the browser's network panel for named feeds only, verify report/checklist persistence across reloads, and confirm archive charts and backups work without database endpoints. Use a second tab to check shared refreshes and saved checklist changes.

A local server can verify cache headers but cannot prove Vercel CDN hits. Before production release, verify a preview returns `x-vercel-cache: HIT` for repeated successful public-feed requests and has no database requests. Confirm the intended team, project, commit and data mode before deployment. After release, compare Fast Origin Transfer by direction, request counts and response sizes over equivalent periods; the exact saving depends on cache hits, activity and source payloads.
