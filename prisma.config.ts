import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

const migrationDatabaseUrl = env('MIGRATION_DATABASE_URL');
const shadowDatabaseUrl = new URL(
  process.env.SHADOW_DATABASE_URL ?? migrationDatabaseUrl,
);

if (!process.env.SHADOW_DATABASE_URL) {
  shadowDatabaseUrl.pathname = '/ekim_games_shadow';
}

export default defineConfig({
  schema: 'apps/api/prisma/schema.prisma',
  migrations: {
    path: 'apps/api/prisma/migrations',
  },
  datasource: {
    url: migrationDatabaseUrl,
    shadowDatabaseUrl: shadowDatabaseUrl.toString(),
  },
});
