# Office hazard assessment

The list, map, office risk calculation, automatic notifications, and report export use the same assessment resolver in src/utils/officeHazardAssessment.ts.

| Category | Low: index 0.20, factor 1 | Medium: index 0.50, factor 2 | High: index 0.80, factor 3 |
| --- | --- | --- | --- |
| Gunung Api | Nearest reference distance >100 km | >30 to 100 km | ≤30 km |
| Abu Vulkanik | Nearest reference distance >100 km | >30 to 100 km | ≤30 km |

Cuaca susceptibility uses the InaRISK Bahaya Banjir layer at layer_bahaya_banjir/ImageServer. It reads the raw numeric raster value at each office with getSamples, renderingRule None, and nearest-neighbor interpolation. This is a flood-hazard proxy for the Cuaca category, not a complete assessment of every extreme-weather hazard. Official index thresholds are low ≤0.3, medium >0.3 to 0.6, and high >0.6, with factors 1, 2, and 3. Zero is a valid low index; missing values stay null. All 48 offices remain listed. Province colors use the highest available office index. Weather dashboard risk is the BMKG alert severity × the InaRISK flood factor. The map, reports, and notifications use the same assessment. Forecast alerts remain excluded from live notifications.

Perkiraan still reads the BMKG provincial forecast table independently. Date headers identify today through two days ahead, today's warning expires at midnight WIB, and unknown or unavailable coverage remains distinct from explicit no-warning coverage. Changing the flood assessment does not change the forecast feed or warning severity.

Volcano and ash susceptibility use unrounded Haversine distances to the nearest of the 69 saved MAGMA/PVMBG reference points. They are labelled application-defined geographic estimates. Both categories use the same distance bands. The current office distribution is 21 low, 20 medium, and 7 high for each category. These classifications do not represent official exclusion zones or an ash forecast. Live volcano and ash risk multiplies the existing alert severity by the geographic factor. Ash exposure requires containment in an active SIGMET Polygon or MultiPolygon, includes exterior boundaries, and excludes holes and their boundaries. Multiple active warnings for the same volcano remain distinct.

Karhutla reads numeric InaRISK raster statistics from the ImageServer's computeStatisticsHistograms endpoint. Each office uses the mean of valid cells within a geodesic 25 km radius, represented by a 72-edge polygon. The request uses the native EPSG:3395 grid and 100 m pixels, with renderingRule set to None to disable the color rendering. It does not infer indices from PNG colors. NoData cells are excluded; numeric zero remains valid. The list shows mean, min/max, valid cell count, and approximate coverage. Coverage is valid cell count × raster cell area × sampling strides divided by the projected polygon area, capped at 100%. It is an estimate of data coverage, not an exposure probability.

Province colors summarize the highest office regional mean within that province. They are not province-wide raster averages. Selecting an office shows its 25 km assessment circle. The PNG overlay is removed. All 48 offices remain listed, with unavailable assessments below valid scores. Service errors, genuine empty areas, and loading have separate states. A manual recalculation retries the source. Requests run with at most four concurrent calculations, a 12-second request limit, and a 60-second batch limit. Successful results and genuine empty areas are cached for six hours; retries can bypass the cache. Regional calculations publish independently of live alert feeds.

Gempa, Cuaca, and karhutla retain official InaRISK thresholds: low ≤0.3, medium >0.3 to 0.6, high >0.6. Gempa and Cuaca use their exact-point factors. Karhutla uses the factor derived from its 25 km regional mean. Dashboard scores are alert severity × assessment factor. A legitimate zero index has low factor 1; an unavailable assessment stays null. Overall risk uses 1–3 low, 4–6 medium, 7–9 high. ISPU behavior is unchanged.

Verification uses local office-data fixtures and public regional raster requests. The browser checks numeric ranking, zero indices, NoData, service errors and retry, province colors, the selected 25 km circle, and screenshot capture. No repository office-coordinate list is sent externally during verification.
