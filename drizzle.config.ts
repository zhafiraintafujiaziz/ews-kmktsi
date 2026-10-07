import { defineConfig } from 'drizzle-kit';
import { databaseConfig } from './server/database.ts';

const connection = databaseConfig();
export default defineConfig({
  schema: './server/schema.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: { url: connection.url, authToken: connection.authToken },
});
