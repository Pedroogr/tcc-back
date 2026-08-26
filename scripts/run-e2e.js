const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

const e2eEnv = {
  ...process.env,
  DATABASE_URL:
    'postgresql://postgres:postgres@localhost:5435/cattle_auction_e2e',
  JWT_SECRET: 'cattle-auction-e2e-secret',
  FRONTEND_URL: 'http://localhost:5173',
  NODE_ENV: 'test',
  NODE_OPTIONS: [process.env.NODE_OPTIONS, '--experimental-vm-modules']
    .filter(Boolean)
    .join(' '),
};

const forwardedArgs = process.argv.slice(2);
const prismaCli = require.resolve('prisma/build/index.js');
const jestPackagePath = require.resolve('jest/package.json');
const jestBin = require(jestPackagePath).bin;
const jestCli = resolve(
  dirname(jestPackagePath),
  typeof jestBin === 'string' ? jestBin : jestBin.jest,
);

function runGit(args, options = {}) {
  return spawnSync('git', args, {
    encoding: 'utf8',
    ...options,
  });
}

function getChangedGeneratedPrismaFiles() {
  const result = runGit([
    'diff-files',
    '--name-only',
    '--',
    'generated/prisma',
  ]);
  if (result.status !== 0) {
    return new Set();
  }

  return new Set(result.stdout.split(/\r?\n/).filter(Boolean));
}

function getGeneratedPrismaStatus() {
  const result = runGit([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    'generated/prisma',
  ]);
  return result.status === 0 ? result.stdout : null;
}

function ensureGeneratedPrismaIsClean() {
  const status = getGeneratedPrismaStatus();
  if (status === null || status === '') {
    return true;
  }

  console.error(
    'Refusing to run E2E with changes under generated/prisma. Clear, commit, or stash them first.',
  );
  return false;
}

function expectsCrlf() {
  if (process.platform !== 'win32') {
    return false;
  }

  const result = runGit(['config', '--bool', 'core.autocrlf']);
  return result.status === 0 && result.stdout.trim().toLowerCase() === 'true';
}

function hasLfEolAttribute(file) {
  const result = runGit(['check-attr', 'eol', '--', file]);
  return result.status === 0 && /: eol: lf\s*$/i.test(result.stdout);
}

function toLf(content) {
  return content.replace(/\r\n/g, '\n');
}

function normalizeGeneratedPrismaLineEndings() {
  if (!expectsCrlf()) {
    return;
  }

  const changedFiles = getChangedGeneratedPrismaFiles();
  let normalizedCount = 0;

  for (const file of changedFiles) {
    if (!existsSync(file) || hasLfEolAttribute(file)) {
      continue;
    }

    const head = runGit(['show', `HEAD:${file}`]);
    if (head.status !== 0) {
      continue;
    }

    const currentContent = readFileSync(file, 'utf8');
    const headContent = head.stdout;
    if (toLf(currentContent) !== toLf(headContent)) {
      continue;
    }

    writeFileSync(file, toLf(currentContent).replace(/\n/g, '\r\n'));
    normalizedCount += 1;
  }

  if (normalizedCount > 0) {
    console.log(
      `Normalized CRLF in ${normalizedCount} generated Prisma file${normalizedCount === 1 ? '' : 's'}.`,
    );
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    env: e2eEnv,
    stdio: 'inherit',
  });

  return result.status ?? 1;
}

function main() {
  if (!ensureGeneratedPrismaIsClean()) {
    process.exitCode = 1;
    return;
  }

  let firstExitCode = 0;

  try {
    const commands = [
      [
        'docker',
        ['compose', '-f', 'docker-compose.e2e.yml', 'up', '-d', '--wait'],
      ],
      [process.execPath, [prismaCli, 'generate']],
      [process.execPath, [prismaCli, 'migrate', 'deploy']],
      [
        process.execPath,
        [
          jestCli,
          '--config',
          './test/jest-e2e.json',
          '--runInBand',
          '--no-cache',
          ...forwardedArgs,
        ],
      ],
    ];

    for (const [command, args] of commands) {
      const exitCode = run(command, args);
      if (exitCode !== 0) {
        firstExitCode = exitCode;
        break;
      }

      if (
        command === process.execPath &&
        args[0] === prismaCli &&
        args[1] === 'generate'
      ) {
        normalizeGeneratedPrismaLineEndings();
      }
    }
  } finally {
    const teardownExitCode = run('docker', [
      'compose',
      '-f',
      'docker-compose.e2e.yml',
      'down',
      '-v',
    ]);

    if (firstExitCode === 0 && teardownExitCode !== 0) {
      firstExitCode = teardownExitCode;
    }
  }

  process.exitCode = firstExitCode;
}

if (require.main === module) {
  main();
}

module.exports = { ensureGeneratedPrismaIsClean };
