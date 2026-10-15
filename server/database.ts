import { createClient, type Config } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.ts';

config({ path: ['.env.local', '.env'].map(path => fileURLToPath(new URL(`../${path}`, import.meta.url))), quiet: true });

export function createDatabase(connection: Config) {
  const client = createClient(connection);
  return { client, db: drizzle(client, { schema }) };
}
export type DatabaseConnection = ReturnType<typeof createDatabase>;

export function databaseConfig(): Config {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  if (process.env.VERCEL && (!url || !/^(libsql|https):\/\//.test(url) || !process.env.TURSO_AUTH_TOKEN?.trim())) {
    throw new Error('Vercel requires a remote TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. Local SQLite is disabled on Vercel.');
  }
  return {
    url: url || 'file:local.sqlite',
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  };
}

let connection: DatabaseConnection | undefined;
export function getDatabase(): DatabaseConnection {
  connection ??= createDatabase(databaseConfig());
  return connection;
}
