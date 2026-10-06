import { createClient, type Config } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { config } from 'dotenv';
import * as schema from './schema.ts';

config({ path: ['.env.local', '.env'], quiet: true });

export function createDatabase(connection: Config) {
  const client = createClient(connection);
  return { client, db: drizzle(client, { schema }) };
}
export type DatabaseConnection = ReturnType<typeof createDatabase>;

export function databaseConfig(): Config {
  return {
    url: process.env.TURSO_DATABASE_URL || 'file:local.sqlite',
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  };
}

let connection: DatabaseConnection | undefined;
export function getDatabase(): DatabaseConnection {
  connection ??= createDatabase(databaseConfig());
  return connection;
}
