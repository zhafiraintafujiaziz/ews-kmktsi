import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { IspuQualityFlag } from '../src/domain/ispuHistory.ts';
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

export const ispuDailyRuns = sqliteTable('ispu_daily_runs', {
  collectionDate: text('collection_date').primaryKey(),
  scheduledAt: text('scheduled_at').notNull(),
  fetchedAt: text('fetched_at'),
  completedAt: text('completed_at').notNull(),
  status: text('status', { enum: ['success', 'failed'] }).notNull(),
  attemptCount: integer('attempt_count').notNull(),
  stationCount: integer('station_count').notNull(),
  acceptedCount: integer('accepted_count').notNull(),
  rejectedCount: integer('rejected_count').notNull(),
  staleCount: integer('stale_count').notNull(),
  undatedCount: integer('undated_count').notNull(),
  errorSummary: text('error_summary'),
  rawResponse: text('raw_response'),
});

export const ispuDailyReadings = sqliteTable('ispu_daily_readings', {
  collectionDate: text('collection_date').notNull().references(() => ispuDailyRuns.collectionDate),
  stationId: text('station_id').notNull(),
  name: text('name').notNull(),
  city: text('city').notNull(),
  province: text('province').notNull(),
  latitude: real('latitude'),
  longitude: real('longitude'),
  value: real('value').notNull(),
  category: text('category').notNull(),
  dominantPollutant: text('dominant_pollutant').notNull(),
  sourceTimeText: text('source_time_text').notNull(),
  sourceTimeLabel: text('source_time_label').notNull(),
  sourceTimezone: text('source_timezone').notNull(),
  observedAt: text('observed_at'),
  qualityFlags: text('quality_flags', { mode: 'json' }).$type<IspuQualityFlag[]>().notNull(),
}, table => [
  primaryKey({ columns: [table.collectionDate, table.stationId] }),
  index('ispu_readings_station_date_idx').on(table.stationId, table.collectionDate),
]);
