#!/usr/bin/env node
/**
 * Release documentation contract for Notes Detective.
 *
 * A release document can look complete and still be unusable: a section can
 * disappear, a link can point at a file that no longer exists, a documented
 * command can drift from `package.json`, or a placeholder can ship as if it
 * were an instruction. This checker reads the two release documents, checks
 * the required headings, local links, documented commands, placeholders, and
 * a small set of claims the product must never make, and exits non-zero on
 * any violation.
 *
 * The checker performs no network request, reads no user content, and does not
 * prove that a command passed. It proves that the documentation is complete
 * enough for a human to run those commands and read the result. Command
 * evidence stays in the release report and the human acceptance record.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

/** Repository root, so the default path works from any current directory. */
export const REPOSITORY_ROOT = resolve(scriptDirectory, '..');
export const RELEASE_DOCUMENTS = Object.freeze(['README.md', 'docs/RELEASE.md']);

/**
 * Required document structure. Heading levels are part of the contract: the
 * repository name is the only H1, and every release topic is an H2 so the
 * GitHub outline is predictable.
 */
export const REQUIRED_HEADINGS = Object.freeze({
  'README.md': Object.freeze([
    { level: 1, text: 'Notes Detective' },
    { level: 2, text: 'What this is' },
    { level: 2, text: 'Requirements' },
    { level: 2, text: 'Install' },
    { level: 2, text: 'Run locally' },
    { level: 2, text: 'Scripts' },
    { level: 2, text: 'Quality checks' },
    { level: 2, text: 'Production preview' },
    { level: 2, text: 'Deploy to GitHub Pages' },
    { level: 2, text: 'Data and privacy' },
    { level: 2, text: 'Backup and restore' },
    { level: 2, text: 'Browser support' },
    { level: 2, text: 'Known limitations' },
    { level: 2, text: 'Documentation' },
  ]),
  'docs/RELEASE.md': Object.freeze([
    { level: 1, text: 'Notes Detective v1 Release' },
    { level: 2, text: 'Version and date' },
    { level: 2, text: 'Release checklist' },
    { level: 2, text: 'CI gates' },
    { level: 2, text: 'Human gates' },
    { level: 2, text: 'Hard success signal' },
    { level: 2, text: 'Post-v1 pilot' },
    { level: 2, text: 'Changelog' },
    { level: 2, text: 'Release risks' },
  ]),
});

/**
 * Commands the release documents must show verbatim. The checker also verifies
 * that every `npm run <script>` and `node scripts/<file>.mjs` named here still
 * exists, so documentation cannot drift away from the repository.
 */
export const REQUIRED_COMMANDS = Object.freeze({
  'README.md': Object.freeze([
    'npm ci',
    'npm run dev',
    'npm run lint',
    'npm run typecheck',
    'npm run test',
    'npm run test:coverage',
    'npm run test:e2e',
    'npm run build',
    'npm run preview',
    'VITE_BASE_PATH=/notes-detective/ npm run build',
    'npm run preview -- --base /notes-detective/',
    'npm run validate:workflows',
    'node scripts/perf-budget.mjs',
    'node scripts/check-pages-build.mjs',
    'node scripts/check-bundle-budget.mjs',
    'node scripts/check-release-docs.mjs',
  ]),
  'docs/RELEASE.md': Object.freeze([
    'npm ci',
    'npm run validate:workflows',
    'npm run lint',
    'npm run typecheck',
    'npm run test:coverage',
    'npm run build',
    'npm run test:e2e',
    'node scripts/perf-budget.mjs',
    'node scripts/check-pages-build.mjs',
    'node scripts/check-bundle-budget.mjs',
    'node scripts/check-release-docs.mjs',
  ]),
});

/** Local documents every release doc must link to. */
export const REQUIRED_LINKS = Object.freeze({
  'README.md': Object.freeze([
    'docs/PRD.md',
    'docs/features/release-and-field-review.md',
    'docs/DEPLOYMENT.md',
    'docs/RELEASE.md',
  ]),
  'docs/RELEASE.md': Object.freeze([
    'docs/PRD.md',
    'docs/features/release-and-field-review.md',
    'docs/DEPLOYMENT.md',
  ]),
});

/** Placeholder text that must never ship in a release document. */
export const PLACEHOLDER_PATTERNS = Object.freeze([
  { label: 'TODO', pattern: /\bTODO\b/ },
  { label: 'TBD', pattern: /\bTBD\b/ },
  { label: 'FIXME', pattern: /\bFIXME\b/ },
  { label: 'lorem ipsum', pattern: /\blorem ipsum\b/i },
  { label: 'example.com', pattern: /\bexample\.com\b/i },
]);

/**
 * Claims this product must not make. They describe capabilities v1 does not
 * have; the documents state the honest limitation in plain terms instead.
 */
export const FORBIDDEN_CLAIM_PATTERNS = Object.freeze([
  { label: 'end-to-end encryption', pattern: /end[- ]to[- ]end[- ]encrypt/i },
  { label: 'AES encryption', pattern: /\bAES[- ]?(?:128|192|256)\b/i },
  { label: 'cloud sync', pattern: /\bcloud[- ](?:sync|backup|storage)\b/i },
  {
    label: 'screen-reader canvas parity',
    pattern: /screen[- ]reader[^.\n]{0,32}\b(?:parity|equivalen(?:ce|t))\b/i,
  },
]);

export class ReleaseDocsError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ReleaseDocsError';
  }
}

const USAGE = `Usage: node scripts/check-release-docs.mjs [options]

Options:
  --root <path>   Repository root containing README.md and docs/RELEASE.md
                  (default: the repository that contains this script)
  --json          Print machine-readable JSON to stdout
  -h, --help      Show this help

Exit code 0 means both release documents satisfy the documentation contract.
Exit code 1 means a requirement is missing or a forbidden placeholder or claim
is present. The checker does not run the documented commands.`;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Replace fenced code blocks and inline code spans with whitespace while
 * preserving line numbers. Links and headings inside examples are not part of
 * the document structure, and a command inside a code block is still available
 * to the raw-text command check.
 */
export function maskCode(markdown) {
  const lines = markdown.split(/\r?\n/);
  let fenceCharacter = null;
  let fenceLength = 0;

  return lines
    .map((line) => {
      if (fenceCharacter === null) {
        const opening = /^\s*(`{3,}|~{3,})/.exec(line);
        if (opening !== null) {
          fenceCharacter = opening[1][0];
          fenceLength = opening[1].length;
          return '';
        }
        return line.replace(/`[^`\n]*`/g, (span) => ' '.repeat(span.length));
      }

      const closing = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (
        closing !== null &&
        closing[1][0] === fenceCharacter &&
        closing[1].length >= fenceLength
      ) {
        fenceCharacter = null;
        fenceLength = 0;
      }
      return '';
    })
    .join('\n');
}

function stripInlineMarkdown(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * GitHub-compatible heading anchor. Punctuation is removed, letters and
 * numbers are lowercased, and each remaining space becomes a hyphen.
 */
export function slugifyHeading(text) {
  return stripInlineMarkdown(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Extract ATX headings from a document, assigning duplicate anchors a suffix. */
export function extractHeadings(markdown) {
  const masked = maskCode(markdown);
  const headings = [];
  const occurrences = new Map();

  for (const [index, line] of masked.split('\n').entries()) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match === null) {
      continue;
    }

    const text = stripInlineMarkdown(match[2]);
    if (text === '') {
      continue;
    }

    const base = slugifyHeading(text);
    const count = occurrences.get(base) ?? 0;
    occurrences.set(base, count + 1);
    headings.push({
      level: match[1].length,
      text,
      raw: match[2],
      line: index + 1,
      anchor: count === 0 ? base : `${base}-${count}`,
    });
  }

  return headings;
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

/**
 * Extract Markdown links from a document, ignoring links inside code. The
 * result keeps the raw target so the caller can decide whether it is local.
 */
export function extractLinks(markdown) {
  const masked = maskCode(markdown);
  const links = [];
  const pattern = /(!?)\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

  for (const match of masked.matchAll(pattern)) {
    const target = match[3].replace(/^<|>$/g, '').trim();
    links.push({
      isImage: match[1] === '!',
      text: match[2].trim(),
      target,
      line: lineNumberAt(masked, match.index ?? 0),
    });
  }

  return links;
}

function isExternalTarget(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
}

function splitTarget(target) {
  const hashIndex = target.indexOf('#');
  const beforeHash = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : target.slice(hashIndex + 1);
  const queryIndex = beforeHash.indexOf('?');
  const path = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);

  return { path, fragment };
}

function decode(value, label, file, errors) {
  try {
    return decodeURIComponent(value);
  } catch {
    errors.push(`${file}: ${label} "${value}" is not valid URL encoding.`);
    return value;
  }
}

function pathInsideRoot(rootDirectory, absolutePath) {
  const relativePath = relative(rootDirectory, absolutePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function normalizeRepositoryPath(rootDirectory, absolutePath) {
  return relative(rootDirectory, absolutePath).split(sep).join('/');
}

/**
 * Validate every local link and require the links that connect the release
 * documents to the PRD, feature specification, deployment guide, and each
 * other. Anchors are checked against the target document's own headings.
 */
export function checkLinks({ rootDirectory, file, source, requiredLinks = [], errors }) {
  const absoluteDocument = resolve(rootDirectory, file);
  const checked = [];

  for (const link of extractLinks(source)) {
    const { target } = link;
    if (target === '' || isExternalTarget(target)) {
      continue;
    }

    const { path, fragment } = splitTarget(target);
    const decodedPath = decode(path, 'link path', file, errors);
    const decodedFragment = decode(fragment, 'anchor', file, errors);

    let absoluteTarget = absoluteDocument;
    if (decodedPath !== '') {
      absoluteTarget = decodedPath.startsWith('/')
        ? resolve(rootDirectory, `.${decodedPath}`)
        : resolve(dirname(absoluteDocument), decodedPath);
    }

    if (!pathInsideRoot(rootDirectory, absoluteTarget)) {
      errors.push(`${file}:${link.line}: link "${target}" resolves outside the repository.`);
      continue;
    }

    if (!existsSync(absoluteTarget)) {
      errors.push(`${file}:${link.line}: link "${target}" points at a missing path.`);
      continue;
    }

    const targetStats = statSync(absoluteTarget);
    if (!targetStats.isFile() && !targetStats.isDirectory()) {
      errors.push(`${file}:${link.line}: link "${target}" is not a file or directory.`);
      continue;
    }

    if (
      decodedFragment !== '' &&
      targetStats.isFile() &&
      extname(absoluteTarget).toLowerCase() === '.md'
    ) {
      const targetHeadings = extractHeadings(readFileSync(absoluteTarget, 'utf8'));
      const anchors = new Set(targetHeadings.map((heading) => heading.anchor));
      if (!anchors.has(decodedFragment.toLowerCase())) {
        errors.push(
          `${file}:${link.line}: link "${target}" points at missing heading "#${decodedFragment}" ` +
            `in "${normalizeRepositoryPath(rootDirectory, absoluteTarget)}".`,
        );
        continue;
      }
    }

    checked.push({
      text: link.text,
      target,
      line: link.line,
      file: normalizeRepositoryPath(rootDirectory, absoluteTarget),
      fragment: decodedFragment,
    });
  }

  for (const required of requiredLinks) {
    const requiredPath = required.split('#')[0];
    const found = checked.some((link) => link.file === requiredPath);
    if (!found) {
      errors.push(`${file}: missing required link to "${required}".`);
    }
  }

  return checked;
}

function findPattern(source, pattern) {
  const match = pattern.exec(source);
  if (match === null) {
    return null;
  }
  return { text: match[0], line: lineNumberAt(source, match.index) };
}

function checkHeadings({ file, source, requiredHeadings, errors }) {
  const headings = extractHeadings(source);

  for (const required of requiredHeadings) {
    const found = headings.some(
      (heading) =>
        heading.level === required.level &&
        heading.text.toLowerCase() === required.text.toLowerCase(),
    );
    if (!found) {
      const marker = '#'.repeat(required.level);
      errors.push(`${file}: missing required heading "${marker} ${required.text}".`);
    }
  }

  return headings;
}

function checkCommands({ file, source, requiredCommands, errors }) {
  const present = [];

  for (const command of requiredCommands) {
    if (source.includes(command)) {
      present.push(command);
      continue;
    }
    errors.push(`${file}: missing required command "${command}".`);
  }

  return present;
}

function checkPlaceholders({ file, source, errors }) {
  for (const { label, pattern } of PLACEHOLDER_PATTERNS) {
    const found = findPattern(source, pattern);
    if (found !== null) {
      errors.push(
        `${file}:${found.line}: placeholder text "${label}" is not allowed in a release document.`,
      );
    }
  }
}

function checkForbiddenClaims({ file, source, errors }) {
  for (const { label, pattern } of FORBIDDEN_CLAIM_PATTERNS) {
    const found = findPattern(source, pattern);
    if (found !== null) {
      errors.push(
        `${file}:${found.line}: forbidden release claim "${label}" (matched "${found.text}"). ` +
          'Document the limitation instead.',
      );
    }
  }
}

/**
 * Verify that documented commands still point at real package scripts and
 * local scripts. This catches the common documentation rot where a command is
 * correct-looking but no longer exists.
 */
export function checkDocumentedCommands(rootDirectory, commands, errors) {
  const packagePath = resolve(rootDirectory, 'package.json');
  let packageScripts = {};

  if (!existsSync(packagePath) || !statSync(packagePath).isFile()) {
    errors.push('package.json is missing; documented npm commands cannot be verified.');
  } else {
    try {
      const parsed = JSON.parse(readFileSync(packagePath, 'utf8'));
      if (isRecord(parsed) && isRecord(parsed.scripts)) {
        packageScripts = parsed.scripts;
      }
      if (!isRecord(parsed) || !isRecord(parsed.scripts)) {
        errors.push(
          'package.json has no scripts object; documented npm commands cannot be verified.',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`package.json is not valid JSON: ${message}`);
    }
  }

  const npmScripts = new Set();
  const nodeScripts = new Map();

  for (const command of commands) {
    for (const match of command.matchAll(/npm run ([A-Za-z0-9:._-]+)/g)) {
      npmScripts.add(match[1]);
    }
    for (const match of command.matchAll(/node\s+(\.?\/?scripts\/[A-Za-z0-9._/-]+\.mjs)/g)) {
      const script = match[1].replace(/^\.\//, '');
      nodeScripts.set(script, command);
    }
  }

  for (const script of npmScripts) {
    if (!Object.hasOwn(packageScripts, script)) {
      errors.push(
        `A documented command references npm script "${script}", which is missing from package.json.`,
      );
    }
  }

  for (const script of nodeScripts.keys()) {
    if (!existsSync(resolve(rootDirectory, script))) {
      errors.push(
        `A documented command references "${script}", which is missing from the repository.`,
      );
    }
  }
}

function checkDocument({ rootDirectory, file, errors }) {
  const absolutePath = resolve(rootDirectory, file);

  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    errors.push(`${file}: required release document is missing.`);
    return { file, headings: [], links: [], commands: [] };
  }

  const source = readFileSync(absolutePath, 'utf8');
  if (source.trim() === '') {
    errors.push(`${file}: required release document is empty.`);
  }

  const headings = checkHeadings({
    file,
    source,
    requiredHeadings: REQUIRED_HEADINGS[file] ?? [],
    errors,
  });
  const links = checkLinks({
    rootDirectory,
    file,
    source,
    requiredLinks: REQUIRED_LINKS[file] ?? [],
    errors,
  });
  const commands = checkCommands({
    file,
    source,
    requiredCommands: REQUIRED_COMMANDS[file] ?? [],
    errors,
  });

  checkPlaceholders({ file, source, errors });
  checkForbiddenClaims({ file, source, errors });

  return { file, headings, links, commands };
}

/**
 * Check both release documents and every documented command. Returns a
 * structured result so the CLI and tests can report every failure in one pass.
 */
export function checkReleaseDocs({ rootDirectory = REPOSITORY_ROOT } = {}) {
  const absoluteRoot = resolve(rootDirectory);
  if (!existsSync(absoluteRoot) || !statSync(absoluteRoot).isDirectory()) {
    throw new ReleaseDocsError(`Release documentation root "${absoluteRoot}" does not exist.`);
  }

  const errors = [];
  const documents = RELEASE_DOCUMENTS.map((file) =>
    checkDocument({ rootDirectory: absoluteRoot, file, errors }),
  );

  const allCommands = [...new Set(Object.values(REQUIRED_COMMANDS).flat())];
  checkDocumentedCommands(absoluteRoot, allCommands, errors);

  return {
    ok: errors.length === 0,
    rootDirectory: absoluteRoot,
    documents,
    errors,
  };
}

function formatPass(result) {
  const lines = [
    'Release docs check passed.',
    `repository: ${result.rootDirectory}`,
    ...result.documents.map(
      (document) =>
        `${document.file}: ${document.headings.length} heading(s), ` +
        `${document.links.length} local link(s), ${document.commands.length} required command(s)`,
    ),
  ];
  return lines.join('\n');
}

function formatFailure(result) {
  return [
    'Release docs check failed.',
    `repository: ${result.rootDirectory}`,
    ...result.errors.map((error) => ` - ${error}`),
  ].join('\n');
}

function readOption(argv, index, name) {
  const argument = argv[index];
  const prefix = `--${name}=`;
  if (argument.startsWith(prefix)) {
    return { value: argument.slice(prefix.length), consumed: 1 };
  }
  if (argument === `--${name}`) {
    const value = argv[index + 1];
    if (value === undefined) {
      throw new ReleaseDocsError(`Option --${name} requires a value.`);
    }
    return { value, consumed: 2 };
  }
  return null;
}

export function parseArguments(argv) {
  const options = { rootDirectory: REPOSITORY_ROOT, json: false, help: false };

  let index = 0;
  while (index < argv.length) {
    const argument = argv[index];
    if (argument === undefined) {
      break;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      index += 1;
      continue;
    }
    if (argument === '--json') {
      options.json = true;
      index += 1;
      continue;
    }

    const root = readOption(argv, index, 'root');
    if (root !== null) {
      options.rootDirectory = resolve(root.value);
      index += root.consumed;
      continue;
    }

    throw new ReleaseDocsError(`Unknown argument "${argument}". Use --help for usage.`);
  }

  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const result = checkReleaseDocs({ rootDirectory: options.rootDirectory });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(formatPass(result));
  } else {
    console.error(formatFailure(result));
  }

  return result.ok ? 0 : 1;
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  try {
    process.exitCode = main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Release docs check failed: ${message}`);
    process.exitCode = 1;
  }
}
