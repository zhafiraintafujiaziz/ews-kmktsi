import { z } from 'zod';
import { DisasterRecordSchema } from './disasterRecord.ts';

const key = z.string().min(1).max(200);
const field = z.string().max(10_000);
export const ReportFieldsSchema = z.object({
  officeId: key,
  officeName: field,
  sumberGangguan: field.min(1),
  lokasi: field,
  penyebab: field,
  dampak: field,
  dampakGedung: field,
  evakuasi: z.boolean(),
  responCepat: field,
}).strict();
export const ReportSchema = ReportFieldsSchema.extend({
  id: key,
  createdAt: z.string().datetime(),
}).strict();
export const ChecklistItemSchema = z.object({
  officeId: key,
  itemId: key,
  checked: z.boolean(),
}).strict();
export const BrowserImportSchema = z.object({
  browserId: z.string().uuid(),
  reports: z.array(ReportSchema).max(5_000),
  checklistItems: z.array(ChecklistItemSchema).max(5_000),
}).strict();
export const AlertBatchSchema = z.object({
  records: z.array(DisasterRecordSchema).min(1).max(100),
}).strict();
export const AlertSnapshotSchema = z.object({
  feed: key,
  checkedAt: z.string().datetime(),
  records: z.array(DisasterRecordSchema).max(5_000),
}).strict().refine(snapshot => snapshot.records.every(record => record.provenance.feed === snapshot.feed), {
  message: 'Snapshot records must belong to its feed', path: ['records'],
});
export const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  feed: key.optional(),
});

export type ReportFields = z.infer<typeof ReportFieldsSchema>;
export type Report = z.infer<typeof ReportSchema>;
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;
export type BrowserImport = z.infer<typeof BrowserImportSchema>;
export type AlertSnapshot = z.infer<typeof AlertSnapshotSchema>;
