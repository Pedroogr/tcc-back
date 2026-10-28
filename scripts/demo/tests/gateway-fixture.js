const http = require('node:http');

function startStub(port) {
  return http
    .createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ path: request.url }));
    })
    .listen(port, '127.0.0.1');
}

const servers = [startStub(3000), startStub(8765)];

function stop() {
  let remaining = servers.length;
  for (const server of servers) {
    server.close(() => {
      remaining -= 1;
      if (remaining === 0) process.exit(0);
    });
  }
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

