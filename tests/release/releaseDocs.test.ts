/**
 * REL-4 release documentation evidence.
 *
 * These tests run the documentation checker as a command against the real
 * repository and against temporary fixture repositories. A checker that only
 * passes on the current README would not prove that a missing heading, a broken
 * link, a stale command, or placeholder text stops a release. Each failure mode
 * below mutates a complete fixture and asserts a non-zero exit.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

type CommandResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

type FixtureOptions = {
  readonly readme?: string;
  readonly release?: string;
  readonly packageScripts?: Record<string, string>;
};

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '../..');
const checkerPath = resolve(repositoryRoot, 'scripts/check-release-docs.mjs');

const temporaryRoots: string[] = [];

const README = `# Notes Detective

A fixture release document for the checker.

## What this is

A local-only evidence board.

## Requirements

Node 24.

## Install

\`\`\`bash
npm ci
\`\`\`

## Run locally

\`\`\`bash
npm run dev
\`\`\`

## Scripts

| Command | Purpose |
| --- | --- |
| \`npm run lint\` | Lint. |
| \`npm run typecheck\` | Typecheck. |
| \`npm run test\` | Unit tests. |
| \`npm run test:coverage\` | Coverage. |
| \`npm run test:e2e\` | Browser tests. |
| \`npm run build\` | Build. |
| \`npm run preview\` | Preview. |
| \`npm run validate:workflows\` | Workflow check. |

## Quality checks

\`\`\`bash
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run test:e2e
npm run build
npm run validate:workflows
node scripts/perf-budget.mjs
node scripts/check-pages-build.mjs
node scripts/check-bundle-budget.mjs
node scripts/check-release-docs.mjs
\`\`\`

Coverage thresholds and budgets are described here.

## Production preview

\`\`\`bash
VITE_BASE_PATH=/notes-detective/ npm run build
npm run preview -- --base /notes-detective/
\`\`\`

## Deploy to GitHub Pages

The deploy workflow runs on main only.

## Data and privacy

Everything stays in IndexedDB on the device.

## Backup and restore

Export one case to a plain ZIP file and restore it as a copy.

## Browser support

Current Chrome, Edge, Firefox, and Safari, plus Android Chrome and iOS Safari.

## Known limitations

Spatial editing is pointer-only.

## Documentation

[deployment](docs/DEPLOYMENT.md), [release](docs/RELEASE.md), and
[support](docs/SUPPORT.md).
`;

const RELEASE = `# Notes Detective v1 Release

A fixture release document for the checker.

## Version and date

| Field | Value |
| --- | --- |
| Release | v1.0 |
| Date | 2026-10-26 |

## Release checklist

- [x] Automated checks.
- [ ] Human acceptance.

## CI gates

\`\`\`bash
npm ci
npm run validate:workflows
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run test:e2e
node scripts/perf-budget.mjs
node scripts/check-pages-build.mjs
node scripts/check-bundle-budget.mjs
node scripts/check-release-docs.mjs
\`\`\`

Automated gates never replace the human gate.

## Human gates

Complete the deployed journey on tablet, phone, and desktop.

## Hard success signal

The reviewer would choose this board over re-reading their notes for a real exam.

## Post-v1 pilot

Three to five interviews after v1. This is not a shipping gate.

## Changelog

### v1.0 — 2026-10-26

First release.

## Release risks

The human gate is still open.

[deployment](DEPLOYMENT.md) and [support](SUPPORT.md).
`;

const DEFAULT_PACKAGE_SCRIPTS: Record<string, string> = {
  dev: 'vite',
  build: 'tsc -b && vite build',
  preview: 'vite preview',
  lint: 'eslint .',
  typecheck: 'tsc -b --pretty false',
  test: 'vitest run',
  'test:coverage': 'vitest run --coverage',
  'test:e2e': 'playwright test',
  'validate:workflows': 'node scripts/validate-workflows.mjs',
};

const FIXTURE_SCRIPTS = [
  'check-pages-build.mjs',
  'check-bundle-budget.mjs',
  'check-release-docs.mjs',
  'perf-budget.mjs',
  'validate-workflows.mjs',
  'copy-ocr-assets.mjs',
];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createFixture(options: FixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'notes-detective-release-docs-'));
  temporaryRoots.push(root);

  const docsDirectory = join(root, 'docs');
  mkdirSync(docsDirectory, { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });

  writeFileSync(join(root, 'README.md'), options.readme ?? README, 'utf8');
  writeFileSync(join(docsDirectory, 'RELEASE.md'), options.release ?? RELEASE, 'utf8');
  writeFileSync(join(docsDirectory, 'SUPPORT.md'), '# Support\n', 'utf8');
  writeFileSync(join(docsDirectory, 'DEPLOYMENT.md'), '# Deployment\n', 'utf8');

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'release-docs-fixture',
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: options.packageScripts ?? DEFAULT_PACKAGE_SCRIPTS,
      },
      null,
      2,
    ),
    'utf8',
  );

  for (const script of FIXTURE_SCRIPTS) {
    writeFileSync(join(root, 'scripts', script), '// fixture\n', 'utf8');
  }

  return root;
}

function runChecker(args: readonly string[]): CommandResult {
  const result = spawnSync(process.execPath, [checkerPath, ...args], {
    encoding: 'utf8',
    cwd: repositoryRoot,
  });

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('release documentation checker', () => {
  it('passes on the real README and docs/RELEASE.md', () => {
    const result = runChecker([]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Release docs check passed.');
    expect(result.stdout).toContain('README.md:');
    expect(result.stdout).toContain('docs/RELEASE.md:');
    expect(result.stderr).toBe('');
  });

  it('fails when a required heading is missing', () => {
    const readme = README.replace('## Backup and restore', '## Backups');
    const result = runChecker(['--root', createFixture({ readme })]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required heading "## Backup and restore"');
  });

  it('fails when a local link points at a missing file', () => {
    const readme = `${README}\n[Missing notes](docs/missing.md)\n`;
    const result = runChecker(['--root', createFixture({ readme })]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('points at a missing path');
  });

  it('fails when a required local link is removed', () => {
    const readme = README.replace('[support](docs/SUPPORT.md)', 'support');
    const result = runChecker(['--root', createFixture({ readme })]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required link to "docs/SUPPORT.md"');
  });

  it('fails when a local link points at a missing heading anchor', () => {
    const readme = `${README}\n[Missing tips](#missing-tips)\n`;
    const result = runChecker(['--root', createFixture({ readme })]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('points at missing heading "#missing-tips"');
  });

  it('fails when a required command is missing', () => {
    const readme = README.replaceAll('npm run test:coverage', 'npm run test');
    const result = runChecker(['--root', createFixture({ readme })]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required command "npm run test:coverage"');
  });

  it.each([
    ['TODO: fill in this section.', 'TODO'],
    ['TBD: decide before release.', 'TBD'],
    ['See https://example.com for the answer.', 'example.com'],
  ])('rejects placeholder text: %s', (placeholder, label) => {
    const readme = `${README}\n${placeholder}\n`;
    const result = runChecker(['--root', createFixture({ readme })]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`placeholder text "${label}"`);
  });

  it('fails when a documented npm script no longer exists', () => {
    const packageScripts = { ...DEFAULT_PACKAGE_SCRIPTS };
    delete packageScripts['test:coverage'];

    const result = runChecker(['--root', createFixture({ packageScripts })]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'npm script "test:coverage", which is missing from package.json',
    );
  });

  it('fails when a documented local script no longer exists', () => {
    const root = createFixture();
    rmSync(join(root, 'scripts', 'check-pages-build.mjs'));

    const result = runChecker(['--root', root]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('references "scripts/check-pages-build.mjs", which is missing');
  });

  it.each([
    ['The archive uses end-to-end encryption.', 'end-to-end encryption'],
    ['The app provides cloud sync between devices.', 'cloud sync'],
    ['The canvas reaches screen-reader parity.', 'screen-reader canvas parity'],
  ])('fails on the forbidden release claim: %s', (claim, label) => {
    const readme = `${README}\n${claim}\n`;
    const result = runChecker(['--root', createFixture({ readme })]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`forbidden release claim "${label}"`);
  });

  it('prints a structured JSON result for tooling', () => {
    const result = runChecker(['--root', createFixture(), '--json']);

    expect(result.status).toBe(0);
    const parsed: unknown = JSON.parse(result.stdout);
    expect(isRecord(parsed)).toBe(true);
    if (!isRecord(parsed)) {
      throw new Error('The docs checker did not print a JSON object.');
    }
    expect(parsed.ok).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(Array.isArray(parsed.documents)).toBe(true);
  });
});
