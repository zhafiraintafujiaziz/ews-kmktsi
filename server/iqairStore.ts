import { eq } from 'drizzle-orm';
import type { DatabaseConnection } from './database.ts';
import { iqairLocations, iqairSnapshots } from './schema.ts';
import type { IqairLocation } from '../src/domain/iqair.ts';

const queues = new WeakMap<DatabaseConnection, Promise<unknown>>();

export function createIqairStore(connection: DatabaseConnection) {
  const { db, client } = connection;
  const store = {
    async read<T>(key: string): Promise<{ at: number; value: T } | undefined> {
      const [row] = await db.select().from(iqairSnapshots).where(eq(iqairSnapshots.key, key));
      return row ? { at: row.retrievedAt, value: JSON.parse(row.data) as T } : undefined;
    },
    async write(key: string, value: unknown, at: number) {
      await db.insert(iqairSnapshots).values({ key, retrievedAt: at, data: JSON.stringify(value) }).onConflictDoUpdate({ target: iqairSnapshots.key, set: { retrievedAt: at, data: JSON.stringify(value) } });
    },
    async saveLocations(locations: IqairLocation[]) {
      for (const item of locations) await db.insert(iqairLocations).values({ id: item.id, province: item.province, data: JSON.stringify(item) }).onConflictDoUpdate({ target: iqairLocations.id, set: { province: item.province, data: JSON.stringify(item) } });
    },
    async locations(): Promise<IqairLocation[]> {
      return (await db.select().from(iqairLocations)).map(row => JSON.parse(row.data) as IqairLocation);
    },
    async websiteAvailability() {
      const control = await client.execute("SELECT until FROM iqair_controls WHERE key = 'website'");
      const last = await client.execute("SELECT MAX(attempted_at) AS last FROM iqair_requests WHERE method = 'website'");
      return { pausedUntil: Number(control.rows[0]?.until || 0), nextAttemptAt: last.rows[0]?.last == null ? 0 : Number(last.rows[0].last) + 15_000 };
    },
    async reserve(method: 'website' | 'api', now: number) {
      // An immediate transaction reserves the attempt before HTTP, including failures.
      const tx = await client.transaction('write');
      try {
        const pause = await tx.execute({ sql: 'SELECT until FROM iqair_controls WHERE key = ?', args: [method] });
        if (Number(pause.rows[0]?.until || 0) > now) throw new Error('Sumber sedang dalam jeda permintaan.');
        if (method === 'website') {
          const last = await tx.execute({ sql: 'SELECT MAX(attempted_at) AS last FROM iqair_requests WHERE method = ?', args: [method] });
          if (last.rows[0]?.last != null && now - Number(last.rows[0].last) < 15_000) throw new Error('Website dibatasi satu permintaan setiap 15 detik. Coba lagi setelah jeda.');
        } else {
          for (const [duration, limit] of [[60_000, 5], [86400_000, 500], [31 * 86400_000, 10000]]) {
            const count = await tx.execute({ sql: 'SELECT COUNT(*) AS count FROM iqair_requests WHERE method = ? AND attempted_at > ?', args: [method, now - duration] });
            if (Number(count.rows[0].count) >= limit) throw new Error('Kuota API IQAir tercapai.');
          }
        }
        await tx.execute({ sql: 'DELETE FROM iqair_requests WHERE attempted_at < ?', args: [now - 31 * 86400_000] });
        await tx.execute({ sql: 'INSERT INTO iqair_requests(method, attempted_at) VALUES (?, ?)', args: [method, now] });
        await tx.commit();
      } finally { tx.close(); }
    },
    async pause(until: number) {
      await client.execute({ sql: "INSERT INTO iqair_controls(key, until) VALUES ('website', ?) ON CONFLICT(key) DO UPDATE SET until = MAX(until, excluded.until)", args: [until] });
    },
  };
  // libSQL transactions share a client. Serialize its IQAir operations so a
  // directory write cannot interleave with an open quota reservation.
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = (queues.get(connection) || Promise.resolve()).then(operation);
    queues.set(connection, result.catch(() => undefined)); return result;
  }
  return Object.fromEntries(Object.entries(store).map(([key, method]) => [key,
    (...args: never[]) => serialize(() => (method as (...args: never[]) => Promise<unknown>)(...args)),
  ])) as typeof store;
}
export type IqairStore = ReturnType<typeof createIqairStore>;
