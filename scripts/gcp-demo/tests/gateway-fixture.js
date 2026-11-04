const http = require('node:http');

const ports = [3000, 8765];
const servers = ports.map((port) =>
  http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(request.url);
  }),
);

Promise.all(
  servers.map(
    (server, index) =>
      new Promise((resolve) => {
        server.listen(ports[index], '0.0.0.0', resolve);
      }),
  ),
).then(() => process.stdout.write('gateway-fixture-ready\n'));

function shutdown() {
  Promise.all(
    servers.map(
      (server) => new Promise((resolve) => server.close(resolve)),
    ),
  ).finally(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
