import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
const shadowDatabaseUrl = migrationDatabaseUrl
  ? new URL(process.env.SHADOW_DATABASE_URL ?? migrationDatabaseUrl)
  : undefined;

if (shadowDatabaseUrl && !process.env.SHADOW_DATABASE_URL) {
  shadowDatabaseUrl.pathname = '/ekim_games_shadow';
}

export default defineConfig({
  schema: 'apps/api/prisma/schema.prisma',
  migrations: {
    path: 'apps/api/prisma/migrations',
  },
  datasource: migrationDatabaseUrl
    ? {
        url: migrationDatabaseUrl,
        shadowDatabaseUrl: shadowDatabaseUrl?.toString(),
      }
    : undefined,
});
