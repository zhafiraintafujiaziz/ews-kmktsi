import { and, asc, eq, gte, lte, max, min, ne } from 'drizzle-orm';
import { setTimeout as delay } from 'node:timers/promises';
import type { DatabaseConnection } from './database.ts';
import { ispuDailyReadings, ispuDailyRuns } from './schema.ts';
import { ispuCityKey, validateHistoryRange, type IspuDailyReading, type IspuHistoryRange, type IspuHistoryDirectory } from '../src/domain/ispuHistory.ts';

export type IspuRun = typeof ispuDailyRuns.$inferSelect;
const queues = new WeakMap<DatabaseConnection, Promise<unknown>>();

export function createIspuStore(connection: DatabaseConnection) {
  const { db } = connection;
  // Local callers share a libSQL client. The database transaction and unique
  // date also protect against separate Vercel instances using different clients.
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = (queues.get(connection) || Promise.resolve()).then(operation);
    queues.set(connection, result.catch(() => undefined));
    return result;
  }
  return {
    directory(): Promise<IspuHistoryDirectory> {
      return serialize(async () => {
        const latest = await connection.client.execute(`WITH latest AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY station_id ORDER BY collection_date DESC) AS rn,
            MIN(collection_date) OVER (PARTITION BY station_id) AS first_date FROM ispu_daily_readings
        ), coords AS (
          SELECT station_id, latitude, longitude, ROW_NUMBER() OVER (PARTITION BY station_id ORDER BY collection_date DESC) AS rn
          FROM ispu_daily_readings WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        ) SELECT l.station_id, l.name, l.city, l.province, l.first_date, l.collection_date, c.latitude, c.longitude
          FROM latest l LEFT JOIN coords c ON c.station_id = l.station_id AND c.rn = 1 WHERE l.rn = 1 ORDER BY l.name, l.station_id`);
        const stations = latest.rows.map(row => ({ stationId: String(row.station_id), name: String(row.name), city: String(row.city), province: String(row.province),
          cityKey: ispuCityKey(String(row.city), String(row.province)), latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude),
          firstCollectionDate: String(row.first_date), lastCollectionDate: String(row.collection_date) }));
        const associations = await db.select({ city: ispuDailyReadings.city, province: ispuDailyReadings.province, stationId: ispuDailyReadings.stationId,
          firstDate: min(ispuDailyReadings.collectionDate), lastDate: max(ispuDailyReadings.collectionDate) }).from(ispuDailyReadings)
          .groupBy(ispuDailyReadings.city, ispuDailyReadings.province, ispuDailyReadings.stationId);
        const cities = new Map<string, IspuHistoryDirectory['cities'][number]>();
        for (const row of associations) {
          const cityKey = ispuCityKey(row.city, row.province);
          if (!cityKey) continue;
          const city = cities.get(cityKey) ?? { cityKey, city: row.city, province: row.province, stationIds: [], firstCollectionDate: row.firstDate!, lastCollectionDate: row.lastDate! };
          if (row.firstDate! < city.firstCollectionDate) city.firstCollectionDate = row.firstDate!;
          if (row.lastDate! > city.lastCollectionDate) city.lastCollectionDate = row.lastDate!;
          if (!city.stationIds.includes(row.stationId)) city.stationIds.push(row.stationId);
          cities.set(cityKey, city);
        }
        const dates = await db.select({ date: ispuDailyRuns.collectionDate }).from(ispuDailyRuns).where(eq(ispuDailyRuns.status, 'success')).orderBy(asc(ispuDailyRuns.collectionDate));
        return { stations, cities: [...cities.values()].sort((a, b) => a.city.localeCompare(b.city, 'id') || a.province.localeCompare(b.province, 'id')), collectionDates: dates.map(row => row.date) };
      });
    },
    run(collectionDate: string): Promise<IspuRun | undefined> {
      return serialize(async () => (await db.select().from(ispuDailyRuns).where(eq(ispuDailyRuns.collectionDate, collectionDate)))[0]);
    },
    commit(run: IspuRun, readings: IspuDailyReading[]): Promise<boolean> {
      return serialize(async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await db.transaction(async tx => {
              const [existing] = await tx.select().from(ispuDailyRuns).where(eq(ispuDailyRuns.collectionDate, run.collectionDate));
              if (existing?.status === 'success') return false;
              if (run.status !== 'success' || !readings.length || readings.some(row => row.collectionDate !== run.collectionDate)
                || readings.length !== run.acceptedCount) throw new Error('Invalid successful ISPU snapshot.');
              await tx.insert(ispuDailyRuns).values(run).onConflictDoUpdate({ target: ispuDailyRuns.collectionDate, set: run });
              // Stay below SQLite's parameter limit and roll back every chunk together.
              for (let offset = 0; offset < readings.length; offset += 40) {
                await tx.insert(ispuDailyReadings).values(readings.slice(offset, offset + 40));
              }
              return true;
            });
          } catch (error) {
            const message = error instanceof Error ? `${error.message} ${error.cause}` : String(error);
            if (attempt >= 4 || !/SQLITE_BUSY|database is locked/i.test(message)) throw error;
            await delay(25 * (attempt + 1));
          }
        }
      });
    },
    failure(run: IspuRun): Promise<void> {
      return serialize(async () => {
        await db.insert(ispuDailyRuns).values(run).onConflictDoUpdate({ target: ispuDailyRuns.collectionDate,
          set: run, setWhere: ne(ispuDailyRuns.status, 'success') });
      });
    },
    history(range: IspuHistoryRange, limit = 1000, offset = 0): Promise<IspuDailyReading[]> {
      validateHistoryRange(range);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0) throw new Error('Invalid history pagination.');
      return serialize(() => db.select().from(ispuDailyReadings).where(and(
        gte(ispuDailyReadings.collectionDate, range.from), lte(ispuDailyReadings.collectionDate, range.to),
        range.stationId === undefined ? undefined : eq(ispuDailyReadings.stationId, range.stationId),
      )).orderBy(asc(ispuDailyReadings.collectionDate), asc(ispuDailyReadings.stationId)).limit(limit).offset(offset));
    },
  };
}
export type IspuStore = ReturnType<typeof createIspuStore>;
