import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const composeFile = join(workspaceRoot, 'tools/test/postgres.compose.yml');

export async function allocatePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Не удалось выбрать свободный TCP-порт для тестов');
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

export function run(command, args, env = process.env) {
  const executable =
    command === 'pnpm'
      ? process.platform === 'win32'
        ? 'pnpm.cmd'
        : 'pnpm'
      : command;
  const result = spawnSync(executable, args, {
    cwd: workspaceRoot,
    env,
    shell: process.platform === 'win32' && executable.endsWith('.cmd'),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} завершилась с кодом ${result.status ?? 'signal'}`,
    );
  }
}

function compose(args, env) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      env.TEST_COMPOSE_PROJECT,
      '--file',
      composeFile,
      ...args,
    ],
    { cwd: workspaceRoot, env, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `docker compose завершилась с кодом ${result.status ?? 'signal'}`,
    );
  }
}

export async function startIsolatedPostgres() {
  const port = await allocatePort();
  const env = {
    ...process.env,
    TEST_DATABASE_PORT: String(port),
    TEST_COMPOSE_PROJECT: `eg-test-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    DATABASE_URL: `postgresql://eg_test:eg_test_only@127.0.0.1:${port}/ekim_games_test?schema=public`,
    JWT_ACCESS_SECRET: randomUUID() + randomUUID(),
    JWT_REFRESH_SECRET: randomUUID() + randomUUID(),
    NODE_ENV: 'test',
    COOKIE_SECURE: 'false',
    WEB_ORIGIN: 'http://127.0.0.1:4200',
    NX_DAEMON: 'false',
    NX_SOCKET_DIR: join(workspaceRoot, '.nx/d'),
  };

  try {
    compose(['up', '--detach', '--wait', '--wait-timeout', '90'], env);
    run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], env);
    return {
      env,
      async dispose() {
        compose(['down', '--volumes', '--remove-orphans'], env);
      },
    };
  } catch (error) {
    try {
      compose(['down', '--volumes', '--remove-orphans'], env);
    } catch {
      // Preserve the original setup error; the unique Compose project can be removed manually.
    }
    throw error;
  }
}

export function workspacePath(...segments) {
  return join(workspaceRoot, ...segments);
}

export function terminateTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
      });
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}
