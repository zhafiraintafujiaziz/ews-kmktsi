import { asc, desc, eq, sql } from 'drizzle-orm';
import type { DatabaseConnection } from './database.ts';
import { alertHistory, alertSnapshots, browserImports, checklistItems, reports } from './schema.ts';
import type { AlertSnapshot, BrowserImport, ChecklistItem, Report } from '../src/domain/persistence.ts';
import type { DisasterRecord } from '../src/domain/disasterRecord.ts';

export function createRepository({ db }: DatabaseConnection) {
  return {
    async saveAlertSnapshot(snapshot: AlertSnapshot) {
      await db.insert(alertSnapshots).values(snapshot).onConflictDoUpdate({
        target: alertSnapshots.feed,
        set: { checkedAt: snapshot.checkedAt, records: snapshot.records },
        setWhere: sql`${alertSnapshots.checkedAt} < ${snapshot.checkedAt}`,
      });
      return { saved: true };
    },
    async listAlertSnapshots() {
      return db.select().from(alertSnapshots).orderBy(asc(alertSnapshots.feed));
    },
    async saveReport(report: Report) {
      const { id, createdAt, ...data } = report;
      // A retry preserves the original immutable report and its creation time.
      await db.insert(reports).values({ id, createdAt, data }).onConflictDoNothing();
      const [saved] = await db.select().from(reports).where(eq(reports.id, id));
      return { ...saved.data, id: saved.id, createdAt: saved.createdAt };
    },
    async listReports(limit = 100, offset = 0) {
      const rows = await db.select().from(reports)
        .orderBy(desc(reports.createdAt), asc(reports.id)).limit(limit).offset(offset);
      return rows.map(row => ({ ...row.data, id: row.id, createdAt: row.createdAt }));
    },
    async listChecklist() {
      return db.select().from(checklistItems).orderBy(asc(checklistItems.officeId), asc(checklistItems.itemId));
    },
    async saveChecklist(item: ChecklistItem) {
      const updatedAt = new Date().toISOString();
      await db.insert(checklistItems).values({ ...item, updatedAt }).onConflictDoUpdate({
        target: [checklistItems.officeId, checklistItems.itemId],
        set: { checked: item.checked, updatedAt },
      });
      return { ...item, updatedAt };
    },
    async importBrowserData(input: BrowserImport) {
      return db.transaction(async tx => {
        const now = new Date().toISOString();
        const receipt = await tx.insert(browserImports).values({ browserId: input.browserId, importedAt: now })
          .onConflictDoNothing().returning();
        if (!receipt.length) return { imported: false };
        // Existing database values win over older browser snapshots.
        for (const { id, createdAt, ...data } of input.reports) {
          await tx.insert(reports).values({ id, createdAt, data }).onConflictDoNothing();
        }
        for (const item of input.checklistItems) {
          await tx.insert(checklistItems).values({ ...item, updatedAt: now }).onConflictDoNothing();
        }
        return { imported: true };
      });
    },
    async ingestAlerts(records: DisasterRecord[]) {
      const now = new Date().toISOString();
      await db.transaction(async tx => {
        for (const record of records) {
          await tx.insert(alertHistory).values({
            feed: record.provenance.feed, recordId: record.id, revision: record.revision,
            record, firstSeenAt: now, lastSeenAt: now,
          }).onConflictDoUpdate({
            target: [alertHistory.feed, alertHistory.recordId, alertHistory.revision],
            set: { lastSeenAt: sql`max(${alertHistory.lastSeenAt}, ${now})` },
          });
        }
      });
      return { accepted: records.length };
    },
    async listAlerts(limit = 100, offset = 0, feed?: string) {
      return db.select().from(alertHistory).where(feed ? eq(alertHistory.feed, feed) : undefined)
        .orderBy(desc(alertHistory.firstSeenAt), asc(alertHistory.feed), asc(alertHistory.recordId), asc(alertHistory.revision))
        .limit(limit).offset(offset);
    },
  };
}
export type Repository = ReturnType<typeof createRepository>;
