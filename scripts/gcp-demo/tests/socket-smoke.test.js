const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { Server } = require('socket.io');

const smokeScript = path.resolve(__dirname, '..', 'socket-smoke.js');

function runSmoke(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [smokeScript, '--url', url, '--timeout-ms', String(timeoutMs)],
      { env: process.env },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('connects and upgrades through the real Socket.IO path', async (t) => {
  const httpServer = http.createServer();
  const io = new Server(httpServer, { path: '/socket.io' });
  t.after(async () => {
    await new Promise((resolve) => io.close(resolve));
    if (httpServer.listening) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });

  const connected = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Socket.IO connection timeout')),
      2000,
    );
    io.once('connection', (socket) => {
      clearTimeout(timeout);
      resolve(socket);
    });
  });
  const port = await listen(httpServer);
  const [result] = await Promise.all([
    runSmoke(`http://127.0.0.1:${port}`),
    connected,
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /socket-smoke: ready/);
});

test('fails cleanly when no Socket.IO server is listening', async () => {
  const unused = http.createServer();
  const port = await listen(unused);
  await new Promise((resolve) => unused.close(resolve));

  const result = await runSmoke(`http://127.0.0.1:${port}`, 300);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /socket-smoke: failed/);
});
