import { run, startIsolatedPostgres } from './isolated-postgres.mjs';

const database = await startIsolatedPostgres();
try {
  run(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'apps/api/vitest.config.mts'],
    database.env,
  );
} finally {
  await database.dispose();
}
