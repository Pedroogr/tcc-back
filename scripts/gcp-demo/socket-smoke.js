const { io } = require('socket.io-client');

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) return null;
    values[key.slice(2)] = value;
  }
  const timeoutMs = Number(values['timeout-ms'] ?? 5000);
  if (!values.url || !Number.isInteger(timeoutMs) || timeoutMs < 1) return null;
  return { url: values.url, timeoutMs };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) {
    process.stderr.write('socket-smoke: failed\n');
    process.exitCode = 1;
    return;
  }

  const socket = io(options.url, {
    path: '/socket.io',
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: false,
    timeout: options.timeoutMs,
  });
  let finished = false;

  const finish = (success) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    socket.close();
    if (success) {
      process.stdout.write('socket-smoke: ready\n');
    } else {
      process.stderr.write('socket-smoke: failed\n');
      process.exitCode = 1;
    }
  };

  const confirmWebSocket = () => {
    if (socket.io.engine?.transport?.name === 'websocket') finish(true);
  };

  socket.on('connect', () => {
    confirmWebSocket();
    socket.io.engine?.once('upgrade', confirmWebSocket);
  });
  socket.on('connect_error', () => finish(false));
  const timer = setTimeout(() => finish(false), options.timeoutMs);
}

main();
