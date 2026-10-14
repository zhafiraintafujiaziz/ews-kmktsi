# IQAir in Kerentanan

The IQAir tab is separate from ISPU assessments, office risk scores, and notifications. It runs through the local Vite server in development and preview. It is not a deployed serverless API.

Run `npm install` and `npm run db:migrate`, then `npm run dev`. For preview, run `npm run build`, `npm run db:migrate`, and `npm run preview`. Restart Vite after changing environment variables.

Website extraction works without a key. An optional Community API key can be set as `IQAIR_API_KEY` in `.env.local`. Never prefix it with `VITE_`; the browser calls only `/api/iqair` and receives no credentials. API backup uses only `states`, `cities`, and `city`, with country fixed to Indonesia. Names must match the API directory exactly, so a province with a different website/API name may need selection through the API directory.

## Default view

The IQAir tab opens with an Indonesian explanation and **Buka peta kualitas udara IQAir**, linking to https://www.iqair.com/id/air-quality-map in a new tab with noopener noreferrer. IQAir controls the external map's coverage, initial viewport, and availability. The app does not reproduce its nationwide AQI markers or colored pollution layer, and the link does not force an Indonesian viewport.

**Lihat detail kota di aplikasi** is initially collapsed. Until opened, no city-directory or observation requests run and no Leaflet map mounts. Expanding it enables the existing city lookup while the IQAir tab is active. Collapsing it or leaving the tab cancels pending browser requests, including city-URL submission, and stops polling. A server request already received may still finish; existing caches and source cooldowns are unchanged. City lookup state is retained while collapsed. Collection may remain unavailable when IQAir blocks requests.

## Sources and freshness

The selected city uses a fresh persisted cache first, then the public website, then API backup when configured. Failed collection returns the last success marked outdated, or an unavailable state. Source-specific snapshots prevent website concentrations and forecasts from appearing on an API reading. Every reading includes its source URL, original method, retrieval time, and identifiable observation times.

Observation age and retrieval age are separate. Readings older than two hours are outdated even if just retrieved. Localized page times without a resolvable year and timezone remain unknown. The extractor accepts explicit ISO timestamps with offsets and does not infer concentrations from AQI. It preserves the website's index label and category. US AQI categories apply only to API readings.

The parser reads explicit embedded current JSON objects and labeled current HTML. It excludes forecast, ranking, history, and article sections. Unrecognized markup or units stay unavailable. Forecast entries require explicitly resolvable times and scale labels. Coordinates must be explicitly supplied by the response; the map has no inferred city positions.

## Request limits

SQLite stores discovered locations, source snapshots, attempts, and website cooldowns. Directories cache for 24 hours, observations for one hour. Concurrent observations and API directory requests share an in-flight promise. Manual refresh uses the same cache and limits. Only the selected city refreshes while the tab and browser document are visible.

Each website HTTP request has a ten-second timeout and at least fifteen seconds between attempts. Requests during that interval fail over instead of waiting. HTTP 403/429 and verification pages pause website collection for at least thirty minutes, or longer when `Retry-After` specifies it. Redirects must retain the exact permitted Indonesian public-page identity and follow the same spacing restriction.

API attempts use a transactional reservation before fetching, including directory calls and failures. Limits are five per rolling minute, five hundred per rolling day, and ten thousand per rolling 31 days. Quotas and cooldowns survive server restart and apply across browser tabs.

When city details are first expanded, discovered cities appear with no province filter or selected city. This is a partial directory, not a nationwide map. Search matches city and province names. The public-page crawler follows the Indonesia country directory and every discovered province directory, including city links found directly on the country page. It processes one directory page per request with at least fifteen seconds between upstream attempts. Active, visible clients with city details expanded advance the crawl while browsing the list; opening city details pauses that client's crawling to give observations the request slot. Closing details resumes it. Collapsing city details, hiding the browser document, or leaving the IQAir tab also stops that client's polling. Cached pages and discovered locations persist, so the crawl resumes after reopening the app or restarting the server. A progress indicator reports completed directory pages and paused collection. A completed crawl means it has checked the discovered directory links, not that IQAir guarantees exhaustive coverage of Indonesia.

HTTP 403/429 or verification pages pause the crawl through the existing persisted cooldown. Other failed directory pages retry after thirty minutes. Previously discovered cities remain visible while crawling or blocked. Jakarta is bootstrapped. A validated city URL can be saved even while IQAir is blocked; its observations still require city identity validation. Only a selected city's observation is fetched. There is no nationwide reading poll, station crawl, historical archive, undocumented website API, challenge solver, or browser-verification bypass.

## Verification and live limitations

The source-map default was checked at desktop and 390-pixel mobile widths. Browser network inspection confirmed no IQAir requests before expanding city details. Temporary browser-only responses verified blocked-source messages and cancellation of pending directory, observation, and city-URL requests on collapse, plus observation cancellation when leaving the IQAir tab. The source link's exact URL, new-tab target, and noopener noreferrer attributes were checked. Test interception and viewport overrides were removed. All 22 IQAir tests, TypeScript/production build, and repository lint passed. The build reported its existing large-chunk warning.

The all-city crawler tests cover cross-province discovery, direct country-page city links, restart recovery, spacing and blocked-page pauses. Browser checks with a temporary three-city directory verified the default list, text search and province filtering. The fixture was removed after verification. A live country-directory request returned HTTP 429, so national collection remained paused.

`npm test` includes synthetic HTML fixtures and SQLite-backed cases for parsing, missing fields, blocked requests, stale observations, fallback, directory retention, cache persistence, request deduplication, and rolling quotas. Synthetic fixtures validate supported parsing shapes; they do not establish current live website compatibility.

Browser checks covered the unchanged ISPU tab, retained city selection, missing map coordinates, and a 390-pixel mobile layout. A temporary synthetic observation verified source badges, concentrations, weather, forecast, and explicit coordinates without writing synthetic data to SQLite. Clearing the city aborted a held response and removed its details. Interception and the viewport override were removed after testing.

A limited direct Jakarta request on October 13, 2026 returned HTTP 429 and a Vercel Security Checkpoint page. Live extraction was blocked. Community API access can be tested when a backend key is configured. Keyless live observations are not guaranteed.

IQAir's [terms](https://www.iqair.com/id/legal/terms-conditions) restrict automated extraction and systematic collection without permission. This local implementation does not establish that permission.
