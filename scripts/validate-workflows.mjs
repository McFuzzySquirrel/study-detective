#!/usr/bin/env node
/**
 * Validate the Notes Detective CI workflow before GitHub Actions runs it.
 *
 * A workflow file can parse successfully and still be a false quality gate:
 * a required command may be missing, Node may be the wrong major, a step may
 * be conditional, or a command may be wrapped in `|| true` / `continue-on-error`
 * so a failure never reaches the merge check. This script asserts the gate as
 * data and exits non-zero on any of those conditions.
 *
 * It reads one local YAML file and performs no network request. It is run by
 * CI itself and by `npm test -- tests/release/ciConfig.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

/** Repository root, so the default path works from any current directory. */
export const REPOSITORY_ROOT = resolve(scriptDirectory, '..');
export const DEFAULT_WORKFLOW_PATH = resolve(REPOSITORY_ROOT, '.github/workflows/ci.yml');
export const REQUIRED_JOB_ID = 'quality';
export const REQUIRED_NODE_MAJOR = 24;
export const REQUIRED_EVENTS = ['push', 'pull_request'];

export class WorkflowValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

/**
 * Each rule describes one required command. The label is used in failure
 * messages; the matcher sees one trimmed shell line at a time.
 */
export const REQUIRED_STEP_RULES = [
  {
    id: 'install',
    label: 'Install dependencies (npm ci)',
    matches: (line) => /^npm ci(?:\s|$)/.test(line),
  },
  {
    id: 'lint',
    label: 'Lint (npm run lint)',
    matches: (line) => /^npm run lint(?:\s|$)/.test(line),
  },
  {
    id: 'typecheck',
    label: 'Typecheck (npm run typecheck)',
    matches: (line) => /^npm run typecheck(?:\s|$)/.test(line),
  },
  {
    id: 'coverage',
    label: 'Unit and component coverage (npm run test:coverage)',
    matches: (line) => /^npm run test:coverage(?:\s|$)/.test(line),
  },
  {
    id: 'build',
    label: 'Production build (npm run build)',
    matches: (line) => /^npm run build(?:\s|$)/.test(line),
  },
  {
    id: 'playwright-browsers',
    label: 'Playwright browsers (npx playwright install --with-deps chromium firefox webkit)',
    matches: (line) => {
      const install = /^(?:npx|npm exec)\s+playwright\s+install(?:\s|$)/.test(line);
      if (!install || !/--with-deps(?:\s|$)/.test(line)) {
        return false;
      }
      return ['chromium', 'firefox', 'webkit'].every((browser) =>
        new RegExp(`\\b${browser}\\b`).test(line),
      );
    },
  },
  {
    id: 'e2e',
    label: 'Playwright end-to-end journeys (npm run test:e2e)',
    matches: (line) =>
      /^npm run test:e2e(?:\s|$)/.test(line) ||
      /^(?:npx|npm exec)\s+playwright\s+test(?:\s|$)/.test(line),
  },
];

const NODE_VERSION_PATTERN = /^(?:\^|~)?24(?:\.(?:\d+|x|\*)){0,2}$/;

/** Shell constructs that can turn a failing required command into a green run. */
const SUCCESS_MASKING_PATTERNS = [
  {
    pattern: /(?:^|[\s;&|])exit\s+0(?:\s|$|;|&|\|)/,
    reason: 'contains "exit 0"',
  },
  {
    pattern: /(?:^|[\s;&|])true(?:\s|$|;|&|\|)/,
    reason: 'runs the "true" no-op command',
  },
  {
    pattern: /(?:^|[\s;&|]):(?:\s|$|;|&|\|)/,
    reason: 'runs the ":" no-op command',
  },
  {
    pattern: /(?:^|[\s;&|])set\s+\+[a-z]*e/,
    reason: 'disables errexit with "set +e"',
  },
  {
    pattern: /--if-present(?:\s|$)/,
    reason: 'uses --if-present, which succeeds when the npm script is missing',
  },
];

const USAGE = `Usage: node scripts/validate-workflows.mjs [workflow.yml]

Validates the CI quality gate:
  - triggers on push and pull_request;
  - uses the "quality" job, Node 24, and npm ci;
  - runs lint, typecheck, coverage, build, and Playwright E2E;
  - installs Chromium, Firefox, and WebKit with dependencies;
  - rejects conditional, continue-on-error, and always-green required steps.

Default workflow: .github/workflows/ci.yml
Exit code 0 means the gate is structurally valid; 1 means it is not.`;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readRunLines(step) {
  if (!isRecord(step) || typeof step.run !== 'string') {
    return [];
  }

  return step.run
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function stepDescription(step, index) {
  const name = isRecord(step) && typeof step.name === 'string' ? step.name : null;
  return name === null ? `step ${index + 1}` : `"${name}"`;
}

function isContinueOnError(value) {
  if (value === false || value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string' && value.trim().toLowerCase() === 'false') {
    return false;
  }
  return true;
}

function workflowEvents(workflow) {
  // YAML 1.2 keeps `on` as a string key. The `true` fallback keeps the check
  // honest if a YAML 1.1 parser ever reads the file.
  const raw = Object.hasOwn(workflow, 'on') ? workflow.on : workflow[true];

  if (typeof raw === 'string') {
    return [raw];
  }
  if (Array.isArray(raw)) {
    return raw.filter((entry) => typeof entry === 'string');
  }
  if (isRecord(raw)) {
    return Object.keys(raw);
  }
  return [];
}

function normalizeNodeVersion(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return String(value);
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return null;
}

/**
 * Validate a parsed workflow object.
 *
 * Returns every problem it finds instead of stopping at the first one, so a
 * reviewer can fix the gate in one pass. `ok` is true only when `errors` is
 * empty.
 */
export function validateWorkflow(workflow, { source = 'workflow' } = {}) {
  const errors = [];

  if (!isRecord(workflow)) {
    return {
      ok: false,
      source,
      errors: ['The workflow file must contain a YAML mapping at the top level.'],
      events: [],
      nodeVersion: null,
      jobId: REQUIRED_JOB_ID,
      requiredSteps: {},
    };
  }

  const events = workflowEvents(workflow);
  for (const event of REQUIRED_EVENTS) {
    if (!events.includes(event)) {
      errors.push(`The workflow must trigger on "${event}".`);
    }
  }

  const jobs = workflow.jobs;
  if (!isRecord(jobs)) {
    errors.push('The workflow must define a jobs mapping.');
    return {
      ok: false,
      source,
      errors,
      events,
      nodeVersion: null,
      jobId: REQUIRED_JOB_ID,
      requiredSteps: {},
    };
  }

  const job = jobs[REQUIRED_JOB_ID];
  if (!isRecord(job)) {
    errors.push(
      `The workflow must define the "${REQUIRED_JOB_ID}" job; that job is the merge-blocking quality gate.`,
    );
    return {
      ok: false,
      source,
      errors,
      events,
      nodeVersion: null,
      jobId: REQUIRED_JOB_ID,
      requiredSteps: {},
    };
  }

  if (job.if !== undefined) {
    errors.push(`The "${REQUIRED_JOB_ID}" job must not be conditional (found "if").`);
  }
  if (isContinueOnError(job['continue-on-error'])) {
    errors.push(`The "${REQUIRED_JOB_ID}" job must not set continue-on-error.`);
  }

  const steps = Array.isArray(job.steps) ? job.steps : [];
  if (!Array.isArray(job.steps) || steps.length === 0) {
    errors.push(`The "${REQUIRED_JOB_ID}" job must define a non-empty steps list.`);
  }

  for (const [index, step] of steps.entries()) {
    if (!isRecord(step)) {
      errors.push(`Step ${index + 1} must be a mapping.`);
      continue;
    }

    if (isContinueOnError(step['continue-on-error'])) {
      errors.push(`${stepDescription(step, index)} must not set continue-on-error.`);
    }

    for (const line of readRunLines(step)) {
      for (const { pattern, reason } of SUCCESS_MASKING_PATTERNS) {
        if (pattern.test(line)) {
          errors.push(`${stepDescription(step, index)} ${reason}: ${line}`);
        }
      }
    }
  }

  const nodeSteps = steps.filter(
    (step) =>
      isRecord(step) &&
      typeof step.uses === 'string' &&
      /^actions\/setup-node@/i.test(step.uses.trim()),
  );
  if (nodeSteps.length === 0) {
    errors.push('The quality job must use actions/setup-node.');
  }

  const nodeVersions = [];
  for (const step of nodeSteps) {
    const value = isRecord(step.with) ? step.with['node-version'] : undefined;
    const normalized = normalizeNodeVersion(value);
    if (normalized === null) {
      errors.push(
        'actions/setup-node must declare a literal node-version of 24 (node-version-file is not inspected).',
      );
      continue;
    }
    nodeVersions.push(normalized);
    if (!NODE_VERSION_PATTERN.test(normalized)) {
      errors.push(`Node ${normalized} is not Node ${REQUIRED_NODE_MAJOR}; CI must use Node 24.`);
    }
  }

  const requiredSteps = {};
  for (const rule of REQUIRED_STEP_RULES) {
    const match = steps
      .map((step, index) => ({ step, index }))
      .find(({ step }) => isRecord(step) && readRunLines(step).some((line) => rule.matches(line)));

    if (match === undefined) {
      errors.push(`Missing required step: ${rule.label}.`);
      continue;
    }

    requiredSteps[rule.id] = {
      index: match.index,
      name: isRecord(match.step) && typeof match.step.name === 'string' ? match.step.name : null,
    };

    if (isRecord(match.step) && match.step.if !== undefined) {
      errors.push(
        `Required step "${stepDescription(match.step, match.index)}" must not be conditional (found "if").`,
      );
    }

    const runLines = readRunLines(match.step);
    if (runLines.some((line) => line.includes('||'))) {
      errors.push(
        `Required step "${stepDescription(match.step, match.index)}" uses a shell "||" fallback that can mask failure.`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    source,
    errors,
    events,
    nodeVersion: nodeVersions.length === 0 ? null : nodeVersions[0],
    jobId: REQUIRED_JOB_ID,
    requiredSteps,
  };
}

/** Read and validate one workflow file. Parse/read failures are validation errors. */
export function validateWorkflowFile(workflowPath = DEFAULT_WORKFLOW_PATH) {
  const absolutePath = resolve(workflowPath);
  let source;

  try {
    source = readFileSync(absolutePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkflowValidationError(`Could not read ${absolutePath}: ${message}`);
  }

  let workflow;
  try {
    workflow = parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkflowValidationError(`${absolutePath} is not valid YAML: ${message}`);
  }

  return validateWorkflow(workflow, {
    source: relative(REPOSITORY_ROOT, absolutePath) || absolutePath,
  });
}

function formatPass(result) {
  return [
    'CI workflow validation passed.',
    `workflow: ${result.source}`,
    `job: ${result.jobId}`,
    `node: ${result.nodeVersion}`,
    `triggers: ${result.events.join(', ')}`,
    `required steps: ${REQUIRED_STEP_RULES.map((rule) => rule.label).join(' | ')}`,
  ].join('\n');
}

function formatFailure(result) {
  return [
    'CI workflow validation failed.',
    `workflow: ${result.source}`,
    ...result.errors.map((error) => ` - ${error}`),
  ].join('\n');
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length > 1) {
    console.error(`Too many arguments. Expected at most one workflow path.\n\n${USAGE}`);
    return 1;
  }

  const workflowPath = argv[0] === undefined ? DEFAULT_WORKFLOW_PATH : resolve(argv[0]);

  try {
    const result = validateWorkflowFile(workflowPath);
    if (!result.ok) {
      console.error(formatFailure(result));
      return 1;
    }
    console.log(formatPass(result));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`CI workflow validation failed.\n - ${message}`);
    return 1;
  }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  process.exitCode = main();
}
