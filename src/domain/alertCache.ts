import { toLegacyDisasterAlert, type DisasterRecord } from './disasterRecord.ts';
import { isCurrentlyUsable } from './freshness.ts';
import type { AlertSnapshot } from './persistence.ts';

export function applyAlertSnapshots(
  recordsByFeed: Map<string, DisasterRecord[]>,
  snapshots: AlertSnapshot[],
  successfulFeeds: ReadonlySet<string>,
  knownFeeds: ReadonlySet<string>,
  now = Date.now(),
): Map<string, string> {
  const restored = new Map<string, string>();
  for (const snapshot of snapshots) {
    // A slow cache response must never replace a live result, even an empty one.
    if (!knownFeeds.has(snapshot.feed) || successfulFeeds.has(snapshot.feed)) continue;
    const usable = snapshot.records.filter(record => {
      try { return isCurrentlyUsable(toLegacyDisasterAlert(record), now); }
      catch { return false; }
    });
    recordsByFeed.set(snapshot.feed, usable);
    if (usable.length) restored.set(snapshot.feed, snapshot.checkedAt);
  }
  return restored;
}
