import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ReportFields } from '../src/domain/persistence.ts';
import type { DisasterRecord } from '../src/domain/disasterRecord.ts';

export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
  data: text('data', { mode: 'json' }).$type<ReportFields>().notNull(),
}, table => [index('reports_created_at_idx').on(table.createdAt)]);

export const checklistItems = sqliteTable('checklist_items', {
  officeId: text('office_id').notNull(),
  itemId: text('item_id').notNull(),
  checked: integer('checked', { mode: 'boolean' }).notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [primaryKey({ columns: [table.officeId, table.itemId] })]);

export const alertHistory = sqliteTable('alert_history', {
  feed: text('feed').notNull(),
  recordId: text('record_id').notNull(),
  revision: text('revision').notNull(),
  record: text('record', { mode: 'json' }).$type<DisasterRecord>().notNull(),
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
}, table => [
  primaryKey({ columns: [table.feed, table.recordId, table.revision] }),
  index('alert_history_first_seen_idx').on(table.firstSeenAt),
]);

// A receipt belongs to this database, so switching files or moving to the cloud
// can import the preserved browser data again without overwriting newer edits.
export const browserImports = sqliteTable('browser_imports', {
  browserId: text('browser_id').primaryKey(),
  importedAt: text('imported_at').notNull(),
});

// The latest complete successful response, including an empty feed.
export const alertSnapshots = sqliteTable('alert_snapshots', {
  feed: text('feed').primaryKey(),
  checkedAt: text('checked_at').notNull(),
  records: text('records', { mode: 'json' }).$type<DisasterRecord[]>().notNull(),
});
