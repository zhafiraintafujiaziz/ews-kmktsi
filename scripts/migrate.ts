import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDatabase, databaseConfig } from '../server/database.ts';

const connection = createDatabase(databaseConfig());
try {
  await migrate(connection.db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  console.log('Database migrations applied.');
} finally {
  connection.client.close();
}
