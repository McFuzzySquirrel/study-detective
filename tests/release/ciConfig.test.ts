/**
 * REL-1 CI gate evidence.
 *
 * These tests run the real `scripts/validate-workflows.mjs` against the real
 * checked-in workflow and against deliberately broken copies. The validator
 * is exercised as a command, not mocked, so a workflow that parses but no
 * longer runs a required gate fails here before GitHub Actions trusts it.
 *
 * The same file asserts the Vitest coverage policy: 85% lines for the domain
 * and data directories, with every file counted so an entirely uncovered file
 * cannot hide behind a healthy aggregate.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, stringify } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { DOMAIN_DATA_LINE_COVERAGE, domainDataCoverageThresholds } from '../../vitest.coverage';

type Workflow = Record<string, unknown>;
type Step = Record<string, unknown>;

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '../..');
const workflowPath = resolve(repositoryRoot, '.github/workflows/ci.yml');
const validatorPath = resolve(repositoryRoot, 'scripts/validate-workflows.mjs');

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function isRecord(value: unknown): value is Workflow {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readWorkflow(): Workflow {
  const parsed: unknown = parse(readFileSync(workflowPath, 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error('The checked-in CI workflow is not a YAML mapping.');
  }
  return parsed;
}

function qualityJob(workflow: Workflow): Workflow {
  const jobs = workflow.jobs;
  if (!isRecord(jobs)) {
    throw new Error('The checked-in CI workflow has no jobs mapping.');
  }
  const job = jobs.quality;
  if (!isRecord(job)) {
    throw new Error('The checked-in CI workflow has no quality job.');
  }
  return job;
}

function qualitySteps(workflow: Workflow): Step[] {
  const steps = qualityJob(workflow).steps;
  if (!Array.isArray(steps) || !steps.every(isRecord)) {
    throw new Error('The checked-in quality job does not contain a steps list.');
  }
  return steps;
}

function stepRunning(workflow: Workflow, command: string): Step {
  const step = qualitySteps(workflow).find(
    (candidate) =>
      typeof candidate.run === 'string' &&
      candidate.run.split(/\r?\n/).some((line) => line.trim().startsWith(command)),
  );
  if (step === undefined) {
    throw new Error(`The checked-in CI workflow has no step running ${command}.`);
  }
  return step;
}

function writeWorkflow(workflow: Workflow): string {
  const root = mkdtempSync(join(tmpdir(), 'notes-detective-ci-'));
  temporaryRoots.push(root);
  const path = join(root, 'ci.yml');
  writeFileSync(path, stringify(workflow), 'utf8');
  return path;
}

type CommandResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

function runValidator(candidatePath?: string): CommandResult {
  const args = candidatePath === undefined ? [validatorPath] : [validatorPath, candidatePath];
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    cwd: repositoryRoot,
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('CI workflow validator', () => {
  it('accepts the checked-in ci.yml and reports every required gate', () => {
    const result = runValidator();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('CI workflow validation passed.');
    expect(result.stdout).toContain('job: quality');
    expect(result.stdout).toContain('node: 24');
    expect(result.stdout).toContain('triggers: push, pull_request');
    expect(result.stdout).toContain('npm ci');
    expect(result.stdout).toContain('npm run lint');
    expect(result.stdout).toContain('npm run typecheck');
    expect(result.stdout).toContain('npm run test:coverage');
    expect(result.stdout).toContain('npm run build');
    expect(result.stdout).toContain('npx playwright install --with-deps chromium firefox webkit');
    expect(result.stdout).toContain('npm run test:e2e');
  });

  it('fails when a required step is missing', () => {
    const workflow = readWorkflow();
    const steps = qualitySteps(workflow);
    const typecheckIndex = steps.findIndex(
      (step) => typeof step.run === 'string' && step.run.includes('npm run typecheck'),
    );
    expect(typecheckIndex).toBeGreaterThanOrEqual(0);
    steps.splice(typecheckIndex, 1);

    const result = runValidator(writeWorkflow(workflow));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CI workflow validation failed.');
    expect(result.stderr).toContain('Missing required step: Typecheck (npm run typecheck)');
  });

  it('fails when a required step may continue after an error', () => {
    const workflow = readWorkflow();
    stepRunning(workflow, 'npm run lint')['continue-on-error'] = true;

    const result = runValidator(writeWorkflow(workflow));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not set continue-on-error');
  });

  it('fails when a required command has a shell fallback that masks failure', () => {
    const workflow = readWorkflow();
    stepRunning(workflow, 'npm run lint').run = 'npm run lint || true';

    const result = runValidator(writeWorkflow(workflow));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('can mask failure');
  });

  it('fails when a required command is followed by an unconditional exit zero', () => {
    const workflow = readWorkflow();
    stepRunning(workflow, 'npm run test:coverage').run = 'npm run test:coverage; exit 0';

    const result = runValidator(writeWorkflow(workflow));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('exit 0');
  });

  it('fails when a required step is an unconditional success no-op', () => {
    const workflow = readWorkflow();
    stepRunning(workflow, 'npm run lint').run = 'exit 0';

    const result = runValidator(writeWorkflow(workflow));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('exit 0');
    expect(result.stderr).toContain('Missing required step: Lint (npm run lint)');
  });

  it('fails when a required step is conditional', () => {
    const workflow = readWorkflow();
    stepRunning(workflow, 'npm run build').if = 'always()';

    const result = runValidator(writeWorkflow(workflow));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not be conditional');
  });

  it('fails when setup-node is not Node 24', () => {
    const workflow = readWorkflow();
    const steps = qualitySteps(workflow);
    const setupNode = steps.find(
      (step) => typeof step.uses === 'string' && step.uses.startsWith('actions/setup-node@'),
    );
    expect(setupNode).toBeDefined();
    if (setupNode === undefined || !isRecord(setupNode.with)) {
      throw new Error('The checked-in CI workflow has no setup-node configuration.');
    }
    setupNode.with['node-version'] = '22';

    const result = runValidator(writeWorkflow(workflow));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Node 22 is not Node 24');
  });

  it('fails when pull_request is not a trigger', () => {
    const workflow = readWorkflow();
    const triggers = workflow.on;
    if (!isRecord(triggers)) {
      throw new Error('The checked-in CI workflow has no trigger mapping.');
    }
    delete triggers.pull_request;

    const result = runValidator(writeWorkflow(workflow));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must trigger on "pull_request"');
  });

  it('fails loudly when the workflow file cannot be read', () => {
    const root = mkdtempSync(join(tmpdir(), 'notes-detective-ci-missing-'));
    temporaryRoots.push(root);
    const result = runValidator(join(root, 'does-not-exist.yml'));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CI workflow validation failed.');
    expect(result.stderr).toContain('Could not read');
  });
});

describe('coverage policy', () => {
  it('sets an 85% line floor for domain and data and counts uncovered files', () => {
    expect(DOMAIN_DATA_LINE_COVERAGE).toBe(85);
    expect(domainDataCoverageThresholds).toEqual({
      'src/domain/**': { lines: 85, perFile: { lines: 1 } },
      'src/data/**': { lines: 85, perFile: { lines: 1 } },
    });

    const globs = ['src/domain/**', 'src/data/**'] as const;
    for (const glob of globs) {
      const threshold = domainDataCoverageThresholds[glob];
      if (threshold === undefined) {
        throw new Error(`No coverage threshold is configured for ${glob}.`);
      }
      expect(threshold.lines).toBe(85);
      expect(threshold.perFile.lines).toBeGreaterThan(0);
    }

    const configSource = readFileSync(resolve(repositoryRoot, 'vitest.config.ts'), 'utf8');
    expect(configSource).toContain('thresholds: domainDataCoverageThresholds');
    expect(configSource).toContain("include: ['src/**/*.{ts,tsx}']");
  });
});
