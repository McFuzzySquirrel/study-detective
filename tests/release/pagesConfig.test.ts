/**
 * REL-2 GitHub Pages evidence.
 *
 * Two things are verified here:
 *
 * 1. `.github/workflows/deploy-pages.yml` is a real Pages deployment: main-only,
 *    narrowly permissioned, environment-scoped, artifact-based, and free of a
 *    bypass or a secret.
 * 2. `scripts/check-pages-build.mjs` fails the way the workflow needs it to:
 *    an absolute `/assets` leak, an absolute manifest scope, a missing icon, a
 *    cross-origin script, or a base-path mismatch must all stop the deploy.
 *
 * The checker is exercised as a command against temporary build directories, so
 * the tests do not depend on whatever `dist/` happens to contain.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

type RecordValue = Record<string, unknown>;
type Step = Record<string, unknown>;

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '../..');
const checkerPath = resolve(repositoryRoot, 'scripts/check-pages-build.mjs');
const deployWorkflowPath = resolve(repositoryRoot, '.github/workflows/deploy-pages.yml');

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readDeployWorkflow(): RecordValue {
  const parsed: unknown = parse(readFileSync(deployWorkflowPath, 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error('The deploy workflow is not a YAML mapping.');
  }
  return parsed;
}

function workflowEvents(workflow: RecordValue): RecordValue {
  const raw = Object.hasOwn(workflow, 'on') ? workflow['on'] : workflow['true'];
  if (!isRecord(raw)) {
    throw new Error('The deploy workflow has no event mapping.');
  }
  return raw;
}

function workflowJobs(workflow: RecordValue): RecordValue {
  if (!isRecord(workflow.jobs)) {
    throw new Error('The deploy workflow has no jobs mapping.');
  }
  return workflow.jobs;
}

function job(name: string): RecordValue {
  const value = workflowJobs(readDeployWorkflow())[name];
  if (!isRecord(value)) {
    throw new Error(`The deploy workflow has no "${name}" job.`);
  }
  return value;
}

function stepsOf(owner: RecordValue): Step[] {
  const steps = owner.steps;
  if (!Array.isArray(steps) || !steps.every(isRecord)) {
    throw new Error('The job has no steps list.');
  }
  return steps;
}

function usesStep(owner: RecordValue, prefix: string): Step {
  const step = stepsOf(owner).find(
    (candidate) => typeof candidate.uses === 'string' && candidate.uses.startsWith(prefix),
  );
  if (step === undefined) {
    throw new Error(`The job has no step using ${prefix}.`);
  }
  return step;
}

function runStep(owner: RecordValue, command: string): Step {
  const step = stepsOf(owner).find(
    (candidate) =>
      typeof candidate.run === 'string' &&
      candidate.run.split(/\r?\n/).some((line) => line.trim() === command),
  );
  if (step === undefined) {
    throw new Error(`The job has no step running "${command}".`);
  }
  return step;
}

type CommandResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

function runChecker(args: string[], env: Record<string, string> = {}): CommandResult {
  const result = spawnSync(process.execPath, [checkerPath, ...args], {
    encoding: 'utf8',
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
  });

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Header-only PNG fixture: enough for the checker's signature/size assertion. */
function png(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13, 0);
  const type = Buffer.from('IHDR', 'ascii');
  const dimensions = Buffer.alloc(8);
  dimensions.writeUInt32BE(width, 0);
  dimensions.writeUInt32BE(height, 4);
  return Buffer.concat([signature, length, type, dimensions]);
}

const defaultIcons = [
  { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

function manifest(overrides: RecordValue = {}): RecordValue {
  return {
    name: 'Notes Detective',
    short_name: 'Notes Detective',
    start_url: './',
    scope: './',
    id: './',
    display: 'standalone',
    icons: defaultIcons,
    ...overrides,
  };
}

function indexHtml(base: string, body = ''): string {
  const prefix = base === './' ? './' : base;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Notes Detective</title>
    <script type="module" crossorigin src="${prefix}assets/app.js"></script>
    <link rel="stylesheet" crossorigin href="${prefix}assets/app.css" />
    <link rel="manifest" href="${prefix}manifest.webmanifest" />
  </head>
  <body>
    <div id="root"></div>${body}
  </body>
</html>
`;
}

interface FixtureOptions {
  readonly base: string;
  readonly index?: string;
  readonly manifest?: unknown;
  readonly iconFiles?: Readonly<Record<string, Buffer>>;
  readonly extraFiles?: Readonly<Record<string, string>>;
}

function createFixture(options: FixtureOptions): string {
  const root = mkdtempSync(join(tmpdir(), 'notes-detective-pages-'));
  temporaryRoots.push(root);

  mkdirSync(join(root, 'assets'), { recursive: true });
  mkdirSync(join(root, 'icons'), { recursive: true });

  writeFileSync(join(root, 'index.html'), options.index ?? indexHtml(options.base), 'utf8');
  writeFileSync(join(root, 'assets/app.js'), 'console.log("fixture");\n', 'utf8');
  writeFileSync(join(root, 'assets/app.css'), 'body { color: #2f241b; }\n', 'utf8');
  writeFileSync(
    join(root, 'manifest.webmanifest'),
    JSON.stringify(options.manifest ?? manifest(), null, 2),
    'utf8',
  );

  const icons = options.iconFiles ?? {
    'icon-192.png': png(192, 192),
    'icon-512.png': png(512, 512),
    'maskable-512.png': png(512, 512),
  };
  for (const [name, bytes] of Object.entries(icons)) {
    writeFileSync(join(root, 'icons', name), bytes);
  }

  for (const [name, contents] of Object.entries(options.extraFiles ?? {})) {
    writeFileSync(join(root, name), contents, 'utf8');
  }

  return root;
}

function check(dist: string, ...extra: string[]): CommandResult {
  return runChecker(['--dist', dist, ...extra]);
}

describe('GitHub Pages deploy workflow', () => {
  it('deploys only a push to main', () => {
    const events = workflowEvents(readDeployWorkflow());

    expect(Object.keys(events)).toEqual(['push']);
    const push = events.push;
    if (!isRecord(push) || !Array.isArray(push.branches)) {
      throw new Error('The deploy workflow does not restrict pushes to a branch.');
    }
    expect(push.branches).toEqual(['main']);
  });

  it('requests Pages identity permissions and no write access to contents', () => {
    const permissions = readDeployWorkflow().permissions;
    if (!isRecord(permissions)) {
      throw new Error('The deploy workflow has no permissions mapping.');
    }

    expect(permissions.contents).toBe('read');
    expect(permissions.pages).toBe('write');
    expect(permissions['id-token']).toBe('write');
  });

  it('builds with the repository base path and checks the artifact before upload', () => {
    const build = job('build');
    const buildStep = runStep(build, 'npm run build');
    const checkStep = runStep(build, 'node scripts/check-pages-build.mjs');

    expect(runStep(build, 'npm ci')).toBeDefined();
    expect(buildStep.env).toEqual({ VITE_BASE_PATH: '/${{ github.event.repository.name }}/' });
    expect(checkStep.env).toEqual({ VITE_BASE_PATH: '/${{ github.event.repository.name }}/' });

    const setupNode = usesStep(build, 'actions/setup-node@');
    const nodeVersion = isRecord(setupNode.with) ? setupNode.with['node-version'] : undefined;
    expect(String(nodeVersion)).toBe('24');

    const upload = usesStep(build, 'actions/upload-pages-artifact@');
    expect(upload.with).toEqual({ path: 'dist' });
  });

  it('deploys the uploaded artifact in the github-pages environment', () => {
    const deploy = job('deploy');
    expect(deploy.needs).toBe('build');

    const environment = deploy.environment;
    if (!isRecord(environment)) {
      throw new Error('The deploy job has no environment.');
    }
    expect(environment.name).toBe('github-pages');
    expect(String(environment.url)).toContain('deployment.outputs.page_url');

    const deployStep = usesStep(deploy, 'actions/deploy-pages@');
    expect(deployStep.id).toBe('deployment');
  });

  it('serializes deployments instead of cancelling a publish in flight', () => {
    const concurrency = readDeployWorkflow().concurrency;
    if (!isRecord(concurrency)) {
      throw new Error('The deploy workflow has no concurrency policy.');
    }

    expect(concurrency.group).toBe('pages');
    expect(concurrency['cancel-in-progress']).toBe(false);
  });

  it('contains no bypassed step, shell fallback, or secret', () => {
    const workflow = readDeployWorkflow();
    const source = JSON.stringify(workflow);

    for (const owner of Object.values(workflowJobs(workflow))) {
      if (!isRecord(owner)) {
        continue;
      }
      for (const step of stepsOf(owner)) {
        expect(step['continue-on-error']).not.toBe(true);
        if (typeof step.run === 'string') {
          expect(step.run).not.toMatch(/\|\|\s*true/);
          expect(step.run).not.toMatch(/\bexit 0\b/);
        }
      }
    }

    expect(source).not.toContain('secrets.');
    expect(source).not.toContain('pull_request');
    expect(source).not.toContain('workflow_run');
  });
});

describe('Pages build checker', () => {
  it('accepts a valid project-site build with the explicit base path', () => {
    const dist = createFixture({ base: '/notes-detective/' });
    const result = check(dist, '--base', '/notes-detective/');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Pages build check passed.');
    expect(result.stdout).toContain('base:     /notes-detective/ (explicit)');
    expect(result.stdout).toContain('manifest.webmanifest');
    expect(result.stdout).toContain('icons/icon-192.png 192x192');
    expect(result.stdout).toContain('icons/maskable-512.png 512x512');
  });

  it('infers a relative base when no base option is given', () => {
    const dist = createFixture({ base: './' });
    const result = check(dist);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('base:     ./ (inferred)');
  });

  it('reads VITE_BASE_PATH from the environment as the deploy workflow does', () => {
    const dist = createFixture({ base: '/notes-detective/' });
    const result = runChecker(['--dist', dist], {
      VITE_BASE_PATH: '/notes-detective/',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('base:     /notes-detective/ (explicit)');
  });

  it('fails on a root-absolute /assets reference in a project-site build', () => {
    const dist = createFixture({
      base: '/notes-detective/',
      index: indexHtml('/notes-detective/').replace(
        '/notes-detective/assets/app.js',
        '/assets/app.js',
      ),
    });
    const result = check(dist, '--base', '/notes-detective/');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Pages build check failed.');
    expect(result.stderr).toContain('/assets/');
    expect(result.stderr).toMatch(/ignores the "\/notes-detective\/" base path/i);
  });

  it('fails when a relative build is deployed as a project site', () => {
    const dist = createFixture({ base: './' });
    const result = check(dist, '--base', '/notes-detective/');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not prefixed with the "/notes-detective/" base path');
  });

  it('fails when the manifest start_url or scope is absolute', () => {
    const startUrlDist = createFixture({
      base: '/notes-detective/',
      manifest: manifest({ start_url: '/' }),
    });
    const startUrlResult = check(startUrlDist, '--base', '/notes-detective/');
    expect(startUrlResult.status).toBe(1);
    expect(startUrlResult.stderr).toContain('"start_url" must be relative');

    const scopeDist = createFixture({
      base: '/notes-detective/',
      manifest: manifest({ scope: 'https://example.com/' }),
    });
    const scopeResult = check(scopeDist, '--base', '/notes-detective/');
    expect(scopeResult.status).toBe(1);
    expect(scopeResult.stderr).toContain('"scope" must be relative');
  });

  it('fails when the manifest link is missing', () => {
    const dist = createFixture({
      base: '/notes-detective/',
      index: indexHtml('/notes-detective/').replace(/\s*<link rel="manifest"[^>]*>/, ''),
    });
    const result = check(dist, '--base', '/notes-detective/');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no <link rel="manifest">');
  });

  it('fails when a declared icon is missing from the build', () => {
    const dist = createFixture({
      base: '/notes-detective/',
      iconFiles: {
        'icon-192.png': png(192, 192),
        'maskable-512.png': png(512, 512),
      },
    });
    const result = check(dist, '--base', '/notes-detective/');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('icons/icon-512.png');
    expect(result.stderr).toContain('is missing from the build');
  });

  it('fails when an icon size does not match the declared manifest size', () => {
    const dist = createFixture({
      base: '/notes-detective/',
      iconFiles: {
        'icon-192.png': png(192, 192),
        'icon-512.png': png(192, 192),
        'maskable-512.png': png(512, 512),
      },
    });
    const result = check(dist, '--base', '/notes-detective/');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is 192x192 but declares 512x512');
  });

  it('fails when an asset targets another origin', () => {
    const dist = createFixture({
      base: './',
      index: indexHtml('./').replace(
        '<link rel="stylesheet" crossorigin href="./assets/app.css" />',
        '<link rel="stylesheet" href="https://cdn.example.com/app.css" />',
      ),
    });
    const result = check(dist, '--base', './');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('targets another origin');
  });

  it('fails when an icon src is absolute and escapes the base path', () => {
    const dist = createFixture({
      base: '/notes-detective/',
      manifest: manifest({
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      }),
    });
    const result = check(dist, '--base', '/notes-detective/');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must be relative');
  });

  it('fails with a build instruction when the dist directory is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'notes-detective-pages-missing-'));
    temporaryRoots.push(root);
    const result = check(join(root, 'dist'));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not exist');
    expect(result.stderr).toContain('npm run build');
  });

  it('rejects an absolute base URL instead of deploying to another origin', () => {
    const dist = createFixture({ base: './' });
    const result = check(dist, '--base', 'https://notes-detective.example.com/');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('same-origin path');
  });

  it('prints machine-readable JSON when asked', () => {
    const dist = createFixture({ base: '/notes-detective/' });
    const result = check(dist, '--base', '/notes-detective/', '--json');

    expect(result.status).toBe(0);
    const parsed: unknown = JSON.parse(result.stdout);
    expect(isRecord(parsed)).toBe(true);
    if (!isRecord(parsed)) {
      return;
    }
    expect(parsed.ok).toBe(true);
    expect(parsed.basePath).toBe('/notes-detective/');
    expect(parsed.baseSource).toBe('explicit');
    expect(Array.isArray(parsed.files)).toBe(true);
  });
});
