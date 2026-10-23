import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  allocatePort,
  run,
  startIsolatedPostgres,
  terminateTree,
  workspacePath,
} from '../test/isolated-postgres.mjs';

const database = await startIsolatedPostgres();
const apiPort = await allocatePort();
let webPort = await allocatePort();
while (webPort === apiPort) webPort = await allocatePort();
const tempDirectory = workspacePath('.nx', 'e2e');
const proxyPath = join(tempDirectory, `proxy-${randomUUID()}.json`);
let webServer;

async function waitForServer(url, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Nx serve завершился с кодом ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The dev servers may need time to compile and bind their ports.
    }
    await delay(500);
  }
  throw new Error(`Сервер не запустился за 120 секунд: ${url}`);
}

async function stopWebServer(child) {
  if (!child) return;
  terminateTree(child);
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(10_000),
  ]);
}

try {
  await mkdir(tempDirectory, { recursive: true });
  await writeFile(
    proxyPath,
    JSON.stringify({
      '/api': { target: `http://127.0.0.1:${apiPort}`, secure: false },
      '/socket.io': {
        target: `http://127.0.0.1:${apiPort}`,
        secure: false,
        ws: true,
      },
    }),
  );

  const env = {
    ...database.env,
    API_PORT: String(apiPort),
    PORT: String(webPort),
    WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
  };
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  webServer = spawn(
    command,
    [
      'nx',
      'serve',
      'web',
      `--port=${webPort}`,
      '--host=127.0.0.1',
      `--proxyConfig=${proxyPath}`,
    ],
    {
      cwd: workspacePath(),
      env,
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
      stdio: 'inherit',
    },
  );
  await waitForServer(`http://127.0.0.1:${webPort}`, webServer);
  run(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      '--config',
      'apps/web/playwright.config.mts',
    ],
    { ...env, BASE_URL: `http://127.0.0.1:${webPort}` },
  );
} finally {
  await stopWebServer(webServer);
  await rm(proxyPath, { force: true });
  await database.dispose();
}
