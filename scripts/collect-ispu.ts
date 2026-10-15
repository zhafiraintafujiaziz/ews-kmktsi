import { appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDatabase, databaseConfig } from '../server/database.ts';
import { createIspuCollector } from '../server/ispuCollector.ts';
import { createIspuStore } from '../server/ispuStore.ts';

// Resolve the SQLite file and env files from this checkout, even when Task
// Scheduler launches the command with a different working directory.
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const logDirectory = fileURLToPath(new URL('../logs/', import.meta.url));
const logFile = fileURLToPath(new URL('../logs/ispu-daily.jsonl', import.meta.url));
mkdirSync(logDirectory, { recursive: true });
const log = (event: Record<string, unknown>) => {
  const line = JSON.stringify(event);
  console.log(line);
  appendFileSync(logFile, line + '\n');
};

let connection: ReturnType<typeof createDatabase> | undefined;
try {
  const config = databaseConfig();
  if (!config.url.startsWith('file:')) throw new Error('Local ISPU collection requires TURSO_DATABASE_URL=file:local.sqlite or another SQLite file URL.');
  connection = createDatabase(config);
  await migrate(connection.db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  const result = await createIspuCollector(createIspuStore(connection), { log })();
  if (result.outcome === 'failed') process.exitCode = 1;
} catch (error) {
  log({ event: 'ispu_local_collection_failed', at: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally { connection?.client.close(); }
