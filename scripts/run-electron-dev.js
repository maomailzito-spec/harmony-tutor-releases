/* eslint-disable no-console */

const waitOn = require('wait-on');
const { spawn } = require('child_process');

function getPort() {
  const raw = String(process.env.VITE_PORT || '').trim();
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 5173;
}

async function main() {
  const port = getPort();
  const url = `http://127.0.0.1:${port}`;
  const resource = `http-get://127.0.0.1:${port}`;

  try {
    await waitOn({
      resources: [resource],
      timeout: 60_000,
      interval: 250,
      tcpTimeout: 2_000,
      window: 1_000,
    });
  } catch (err) {
    console.error(`[run-electron-dev] Dev server not ready: ${url}`);
    console.error(err);
    process.exit(1);
    return;
  }

  let electronPath;
  try {
    // eslint-disable-next-line global-require
    electronPath = require('electron');
  } catch (err) {
    console.error('[run-electron-dev] Cannot resolve electron binary. Did you run npm install?');
    console.error(err);
    process.exit(1);
    return;
  }

  // Options must come before the app path.
  const electronArgs = [
    '--disable-gpu',
    '--disable-gpu-compositing',
    '.',
  ];

  const child = spawn(electronPath, electronArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_START_URL: url,
    },
  });


  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

void main();
