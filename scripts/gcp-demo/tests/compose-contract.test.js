const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const composeFile = path.join(repoRoot, 'deploy', 'gcp', 'compose.yaml');
const fixtureEnv = path.join(__dirname, 'fixtures', 'compose.env');

function composeCommand() {
  const plugin = spawnSync('docker', ['compose', 'version'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (plugin.status === 0) {
    return { executable: 'docker', prefix: ['compose'] };
  }
  return { executable: 'docker-compose', prefix: [] };
}

function runComposeConfig(envFile) {
  const { executable, prefix } = composeCommand();
  const result = spawnSync(
    executable,
    [
      ...prefix,
      '--profile',
      'tools',
      '--env-file',
      envFile,
      '-f',
      composeFile,
      'config',
      '--format',
      'json',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
    },
  );

  assert.equal(
    result.status,
    0,
    `Compose config failed:\n${result.stderr || result.stdout}`,
  );
  return result.stdout;
}

function networkNames(service) {
  return Object.keys(service.networks ?? {}).sort();
}

test('defines the isolated GPU demo topology', () => {
  const config = JSON.parse(runComposeConfig(fixtureEnv));

  assert.deepEqual(Object.keys(config.services).sort(), [
    'api',
    'cloudflared',
    'gateway',
    'migrate',
    'postgres',
    'worker',
  ]);

  for (const service of Object.values(config.services)) {
    assert.equal(service.ports, undefined);
    assert.ok(service.image, 'every service must have an explicit image');
    assert.doesNotMatch(service.image, /:latest$/);
  }

  assert.deepEqual(
    config.services.worker.deploy.resources.reservations.devices[0],
    {
      capabilities: ['gpu'],
      count: 1,
      driver: 'nvidia',
    },
  );
  assert.deepEqual(Object.keys(config.volumes).sort(), [
    'postgres-data',
    'uploads',
  ]);

  assert.deepEqual(networkNames(config.services.postgres), ['data']);
  assert.deepEqual(networkNames(config.services.migrate), ['data']);
  assert.deepEqual(networkNames(config.services.worker), ['app']);
  assert.deepEqual(networkNames(config.services.cloudflared), ['edge']);
  assert.deepEqual(networkNames(config.services.gateway), ['app', 'edge']);
  assert.deepEqual(networkNames(config.services.api), ['app', 'data']);

  assert.equal(config.networks.app.internal, true);
  assert.equal(config.networks.data.internal, true);
  assert.notEqual(config.networks.edge.internal, true);
  assert.deepEqual(config.services.migrate.profiles, ['tools']);
  assert.deepEqual(config.services.cloudflared.command, [
    'tunnel',
    '--no-autoupdate',
    '--url',
    'http://gateway:8080',
  ]);

  assert.ok(
    config.services.gateway.volumes.some(
      (volume) =>
        volume.target === '/etc/caddy/Caddyfile' && volume.read_only === true,
    ),
  );
  assert.ok(
    config.services.api.volumes.some(
      (volume) =>
        volume.source === 'uploads' &&
        volume.target === '/app/public/uploads',
    ),
  );

  assert.match(config.services.postgres.healthcheck.test.join(' '), /pg_isready/);
  assert.match(config.services.api.healthcheck.test.join(' '), /fetch\(/);
  assert.match(
    config.services.worker.healthcheck.test.join(' '),
    /urllib\.request/,
  );
  assert.match(config.services.gateway.healthcheck.test.join(' '), /wget/);
});

module.exports = { runComposeConfig };
