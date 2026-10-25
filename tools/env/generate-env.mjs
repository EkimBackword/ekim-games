import { randomBytes } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const templatePath = join(workspaceRoot, '.env.example');
const outputPath = join(workspaceRoot, '.env');

const secrets = {
  POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
  MIGRATION_DB_PASSWORD: randomBytes(32).toString('hex'),
  APP_DB_PASSWORD: randomBytes(32).toString('hex'),
  JWT_ACCESS_SECRET: randomBytes(32).toString('base64url'),
  JWT_REFRESH_SECRET: randomBytes(32).toString('base64url'),
};

const envValues = {
  ...secrets,
  DATABASE_URL: `postgresql://ekim_games_app:${secrets.APP_DB_PASSWORD}@localhost:5432/ekim_games?schema=public`,
  MIGRATION_DATABASE_URL: `postgresql://ekim_games_migrate:${secrets.MIGRATION_DB_PASSWORD}@localhost:5432/ekim_games?schema=public`,
  SHADOW_DATABASE_URL: `postgresql://ekim_games_migrate:${secrets.MIGRATION_DB_PASSWORD}@localhost:5432/ekim_games_shadow?schema=public`,
};

const template = await readFile(templatePath, 'utf8');
const keys = new Set();
const generated = template.replace(/^([A-Z][A-Z0-9_]*)=.*$/gm, (line, key) => {
  keys.add(key);
  if (!(key in envValues)) return line;

  return `${key}="${envValues[key]}"`;
});

const missingKeys = Object.keys(envValues).filter((key) => !keys.has(key));
if (missingKeys.length > 0) {
  throw new Error(
    `В .env.example отсутствуют обязательные параметры: ${missingKeys.join(', ')}`,
  );
}

let fileHandle;
try {
  fileHandle = await open(outputPath, 'wx', 0o600);
  await fileHandle.writeFile(generated, 'utf8');
} catch (error) {
  if (error.code === 'EEXIST') {
    console.error('.env уже существует; файл не изменён.');
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await fileHandle?.close();
}

if (process.exitCode !== 1) {
  console.log('Создан .env с уникальными случайными секретами.');
}
