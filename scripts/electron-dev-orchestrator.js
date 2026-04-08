/* eslint-disable no-console */

const waitOn = require('wait-on');
const { spawn } = require('child_process');
const net = require('net');

function defaultPortForFlavor() {
  const raw = String(process.env.APP_FLAVOR || process.env.VITE_APP_FLAVOR || '').toLowerCase();
  if (raw === 'guitar') return 5174;
  if (raw === 'united') return 5175;
  return 5173; // grandstaff default
}

function desiredPort() {
  const raw = String(process.env.VITE_PORT || '').trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  return defaultPortForFlavor();
}

function canListen(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '127.0.0.1');
  });
}

async function findFreePort(startPort, maxTries = 20) {
  let p = startPort;
  for (let i = 0; i < maxTries; i++) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await canListen(p);
    if (ok) return p;
    p++;
  }
  return startPort;
}

function killTree(child) {
  try {
    if (!child || child.killed) return;
    // On macOS/Linux, negative pid kills the process group.
    try {
      process.kill(-child.pid, 'SIGTERM');
      return;
    } catch {
      // fallback
    }
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
}

async function main() {
  const start = desiredPort();
  const port = await findFreePort(start, 30);
  const url = `http://127.0.0.1:${port}`;
  const resource = `http-get://127.0.0.1:${port}`;

  if (port !== start) {
    console.warn(`[electron:dev] Port ${start} in use; using ${port}`);
  }

  // Start Vite dev server.
  const vite = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'dev'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_PORT: String(port),
      },
      detached: true,
    },
  );

  let electron;
  const shutdown = (code = 0) => {
    killTree(vite);
    killTree(electron);
    process.exit(code);
  };

  process.on('SIGINT', () => shutdown(130));
  process.on('SIGTERM', () => shutdown(143));

  vite.on('exit', (code) => {
    if (electron) killTree(electron);
    process.exit(code ?? 0);
  });

  try {
    await waitOn({
      resources: [resource],
      timeout: 60_000,
      interval: 250,
      tcpTimeout: 2_000,
      window: 1_000,
    });
  } catch (err) {
    console.error(`[electron:dev] Dev server not ready: ${url}`);
    console.error(err);
    shutdown(1);
    return;
  }

  let electronPath;
  try {
    // eslint-disable-next-line global-require
    electronPath = require('electron');
  } catch (err) {
    console.error('[electron:dev] Cannot resolve electron binary. Did you run npm install?');
    console.error(err);
    shutdown(1);
    return;
  }

  // Start Electron.
  const electronArgs = [
    '--disable-gpu',
    '--disable-gpu-compositing',
    '.',
  ];

  electron = spawn(electronPath, electronArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      VITE_PORT: String(port),
      ELECTRON_START_URL: url,
    },
    detached: true,
  });

  electron.on('exit', (code, signal) => {
    if (signal) {
      shutdown(0);
      return;
    }
    shutdown(code ?? 0);
  });
}

void main();
