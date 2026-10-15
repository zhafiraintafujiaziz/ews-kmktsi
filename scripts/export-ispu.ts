import { parseArgs } from 'node:util';
import { once } from 'node:events';
import { createDatabase, databaseConfig } from '../server/database.ts';
import { createIspuStore } from '../server/ispuStore.ts';
import { exportIspuCsv } from '../server/ispuHistory.ts';
import { validateHistoryRange } from '../src/domain/ispuHistory.ts';

const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' }, station: { type: 'string' } } });
const range = validateHistoryRange({ from: values.from || '', to: values.to || '', stationId: values.station });
const connection = createDatabase(databaseConfig());
try {
  for await (const line of exportIspuCsv(createIspuStore(connection), range)) {
    if (!process.stdout.write(line)) await once(process.stdout, 'drain');
  }
} finally { connection.client.close(); }
