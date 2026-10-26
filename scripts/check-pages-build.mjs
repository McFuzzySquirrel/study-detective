#!/usr/bin/env node
/**
 * Verify that a production build is deployable to a GitHub Pages project site.
 *
 * A green `vite build` is not enough. The build can reference root-absolute
 * `/assets/...` URLs, emit a manifest whose `start_url` and `scope` point at
 * the domain root, or ship icons that the manifest promises but the artifact
 * does not contain. Any of those regresses silently until a deep link or an
 * installed launch fails on Pages.
 *
 * This script reads only the emitted build. It performs no network request,
 * never reads user content, and does not need a browser. It checks:
 *
 *   - `index.html` exists and references only prefixed (or relative) assets;
 *   - no root-absolute `/assets/...` path leaks outside the base path;
 *   - every referenced local file exists in the build and is non-empty;
 *   - no reference targets another origin;
 *   - the manifest link resolves and `start_url`, `scope`, and `id` stay
 *     relative, so an installed app launches under the serving base path;
 *   - every manifest icon is relative, resolves under the base path, exists,
 *     is a PNG, and matches its declared size.
 *
 * With no `--base` the script infers the base from the built `index.html`, so
 * the same command validates a local relative build and a Pages build. The
 * deploy workflow passes `--base` explicitly so a silent fallback to `./`
 * cannot pass as a Pages deployment.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

/** Repository root, so the default path works from any current directory. */
export const REPOSITORY_ROOT = resolve(scriptDirectory, '..');
export const DEFAULT_DIST_DIRECTORY = resolve(REPOSITORY_ROOT, 'dist');
export const DEFAULT_MANIFEST_FILE = 'manifest.webmanifest';
export const RELATIVE_BASE = './';
export const ROOT_BASE = '/';

export class PagesBuildError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'PagesBuildError';
  }
}

const USAGE = `Usage: node scripts/check-pages-build.mjs [options]

Options:
  --dist <path>   Build directory to inspect (default: dist)
  --base <path>   Expected base path, e.g. /notes-detective/ or ./
                  (default: VITE_BASE_PATH if set, otherwise inferred)
  --json          Print machine-readable JSON to stdout
  -h, --help      Show this help

Exit code 0 means the build is safe to deploy to a Pages project site;
1 means a check failed.`;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalize a base path option. `null`/`''`/`.`/`./` mean a relative build,
 * `/` means the domain root, and `/repo` (or `repo`) becomes `/repo/`.
 */
export function normalizeBasePath(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '' || trimmed === '.' || trimmed === './') {
    return RELATIVE_BASE;
  }
  if (trimmed === '/') {
    return ROOT_BASE;
  }
  if (trimmed.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    throw new PagesBuildError(
      `Base path must be a same-origin path such as /notes-detective/, received "${trimmed}".`,
    );
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

/** Read `src` and `href` values from tags that fetch a static asset. */
export function parseAssetReferences(html) {
  const references = [];
  const tagPattern = /<(script|link|img|source|audio|video|track|iframe)\b([^>]*)>/gi;
  const attributePattern = /\b(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

  for (const tagMatch of html.matchAll(tagPattern)) {
    const tag = tagMatch[1].toLowerCase();
    const attributes = tagMatch[2] ?? '';

    for (const attributeMatch of attributes.matchAll(attributePattern)) {
      const attribute = attributeMatch[1].toLowerCase();
      const value = attributeMatch[2] ?? attributeMatch[3] ?? '';
      references.push({
        tag,
        attribute,
        value: value.trim(),
        rel: tag === 'link' ? readRel(attributes) : null,
      });
    }
  }

  return references;
}

function readRel(attributes) {
  const match = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
  if (match === null) {
    return null;
  }
  return (match[1] ?? match[2] ?? '').trim().toLowerCase();
}

function isExternalReference(value) {
  return /^https?:/i.test(value) || value.startsWith('//');
}

function isSkippableReference(value) {
  return value === '' || value.startsWith('#') || value.startsWith('data:');
}

/** Strip a query string and fragment from a reference. */
export function referencePath(value) {
  return value.split('#')[0].split('?')[0];
}

/**
 * Infer the base path the build was made with. Vite emits `<base>assets/...`
 * for every base: `./assets/...` for a relative build, `/assets/...` for the
 * root, and `/repo/assets/...` for a project site. Only asset URLs are used,
 * so an icon or manifest link cannot make the inferred base look inconsistent.
 */
export function inferBasePath(references) {
  const found = new Set();

  for (const { value } of references) {
    if (isSkippableReference(value) || isExternalReference(value)) {
      continue;
    }

    const path = referencePath(value);
    if (path === '') {
      continue;
    }

    const markerIndex = path.indexOf('/assets/');
    if (markerIndex >= 0) {
      found.add(markerIndex === 0 ? ROOT_BASE : `${path.slice(0, markerIndex)}/`);
    }
  }

  if (found.size === 0) {
    // No Vite asset URL to learn from. Fall back to the manifest directory,
    // which Vite emits beside index.html under the same base.
    const manifestLink = references.find(
      (reference) =>
        reference.tag === 'link' && (reference.rel ?? '').split(/\s+/).includes('manifest'),
    );
    const manifestPath = manifestLink === undefined ? '' : referencePath(manifestLink.value);
    if (manifestPath.startsWith('/')) {
      const directory = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
      found.add(directory === '' ? ROOT_BASE : directory);
    }
  }

  if (found.size === 0) {
    throw new PagesBuildError(
      'Could not infer a base path: index.html has no local asset references.',
    );
  }
  if (found.size > 1) {
    throw new PagesBuildError(
      `index.html mixes asset references from more than one base path: ${[...found].join(', ')}.`,
    );
  }

  return [...found][0];
}

/**
 * Check one build directory.
 *
 * Returns a structured result instead of throwing for ordinary build defects,
 * so callers can print every problem in one pass. A missing directory or an
 * unreadable file is a `PagesBuildError` because there is nothing to inspect.
 */
export function checkPagesBuild({ distDirectory = DEFAULT_DIST_DIRECTORY, basePath = null } = {}) {
  const errors = [];
  const absoluteDist = resolve(distDirectory);
  const indexPath = resolve(absoluteDist, 'index.html');

  if (!existsSync(absoluteDist) || !statSync(absoluteDist).isDirectory()) {
    throw new PagesBuildError(
      `Build directory "${absoluteDist}" does not exist. Run "npm run build" first.`,
    );
  }
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    throw new PagesBuildError(
      `index.html is missing from "${absoluteDist}". Run "npm run build" first.`,
    );
  }

  const html = readFileSync(indexPath, 'utf8');
  if (html.trim() === '') {
    errors.push('index.html is empty.');
  }

  const references = parseAssetReferences(html);
  if (references.length === 0) {
    errors.push('index.html references no scripts, styles, or other static assets.');
  }

  const explicitBase =
    basePath === null || basePath === undefined ? null : normalizeBasePath(basePath);
  const inferredBase =
    explicitBase === null && references.length > 0 ? inferBasePath(references) : null;
  const effectiveBase = explicitBase ?? inferredBase ?? RELATIVE_BASE;

  const files = [];
  for (const reference of references) {
    const label = `<${reference.tag} ${reference.attribute}="${reference.value}">`;

    if (isSkippableReference(reference.value)) {
      continue;
    }
    if (/^javascript:/i.test(reference.value)) {
      errors.push(`${label} uses a javascript: URL.`);
      continue;
    }
    if (isExternalReference(reference.value)) {
      errors.push(`${label} targets another origin. Only same-origin static assets are allowed.`);
      continue;
    }

    const path = referencePath(reference.value);
    if (path === '') {
      continue;
    }

    const problem = basePathProblem(path, effectiveBase);
    if (problem !== null) {
      errors.push(`${label} ${problem}`);
      continue;
    }

    const relativeFile = pathToBuildRelative(path, effectiveBase);
    const absoluteFile = resolveInside(absoluteDist, relativeFile);
    if (absoluteFile === null) {
      errors.push(`${label} escapes the build directory.`);
      continue;
    }
    if (!existsSync(absoluteFile) || !statSync(absoluteFile).isFile()) {
      errors.push(`${label} points at "${relativeFile}", which is missing from the build.`);
      continue;
    }
    const size = statSync(absoluteFile).size;
    if (size === 0) {
      errors.push(`${label} points at "${relativeFile}", which is empty.`);
      continue;
    }
    files.push({ tag: reference.tag, path: relativeFile, bytes: size });
  }

  // A root-absolute /assets URL is the classic project-site leak: it works at
  // the domain root and 404s under a repository subpath. Quote, whitespace,
  // `=` and `(` boundaries keep /repo/assets/... from matching.
  if (effectiveBase !== ROOT_BASE) {
    const leakPattern = /(?:^|[\s"'=(])\/assets\//g;
    for (const match of html.matchAll(leakPattern)) {
      errors.push(
        `index.html contains a root-absolute /assets path that ignores the "${effectiveBase}" base: ${match[0].trim()}`,
      );
    }
  }

  if (/https?:\/\//i.test(html)) {
    errors.push(
      'index.html contains an absolute http(s) URL; built asset references must be local.',
    );
  }

  const manifest = checkManifest({
    references,
    distDirectory: absoluteDist,
    basePath: effectiveBase,
    errors,
  });

  return {
    ok: errors.length === 0,
    distDirectory: absoluteDist,
    basePath: effectiveBase,
    baseSource: explicitBase !== null ? 'explicit' : 'inferred',
    indexPath,
    references,
    files,
    manifest,
    errors,
  };
}

function basePathProblem(path, basePath) {
  if (basePath === RELATIVE_BASE) {
    return path.startsWith('/')
      ? `is root-absolute and breaks under a project-site path (expected a relative reference).`
      : null;
  }

  if (basePath === ROOT_BASE) {
    return path.startsWith('/') ? null : 'must be root-absolute when the base path is "/".';
  }

  if (path.startsWith(basePath)) {
    return null;
  }
  if (path.startsWith('/assets/')) {
    return `is an absolute /assets reference that ignores the "${basePath}" base path.`;
  }
  return `is not prefixed with the "${basePath}" base path.`;
}

function pathToBuildRelative(path, basePath) {
  if (basePath === RELATIVE_BASE) {
    // A relative manifest URL still resolves to a root-relative pathname
    // (`/icons/icon-192.png`); both forms live at the build root.
    return path.replace(/^\.\//, '').replace(/^\//, '');
  }
  if (basePath === ROOT_BASE) {
    return path.replace(/^\//, '');
  }
  return path.slice(basePath.length);
}

/** Resolve a build-relative file and reject `..` traversal. */
function resolveInside(buildDirectory, relativeFile) {
  const absolute = resolve(buildDirectory, relativeFile);
  const prefix = buildDirectory.endsWith(sep) ? buildDirectory : `${buildDirectory}${sep}`;
  if (absolute === buildDirectory || !absolute.startsWith(prefix)) {
    return null;
  }
  return absolute;
}

function isRelativeUrl(value) {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    !value.startsWith('/') &&
    !value.startsWith('//') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(value)
  );
}

/** Resolve a manifest URL against the manifest's own location, as a browser does. */
function resolveAgainstManifest(value, basePath) {
  const manifestUrl = new URL(`${basePath}${DEFAULT_MANIFEST_FILE}`, 'https://pages.invalid/');
  return new URL(value, manifestUrl).pathname;
}

function pathStaysUnderBase(path, basePath) {
  if (basePath === RELATIVE_BASE || basePath === ROOT_BASE) {
    return true;
  }
  return path.startsWith(basePath);
}

function readPngSize(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < 24 || !signature.every((byte, index) => buffer[index] === byte)) {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function checkManifest({ references, distDirectory, basePath, errors }) {
  const manifestLink = references.find(
    (reference) =>
      reference.tag === 'link' && (reference.rel ?? '').split(/\s+/).includes('manifest'),
  );

  if (manifestLink === undefined) {
    errors.push('index.html has no <link rel="manifest">; the build is not installable.');
    return null;
  }

  const linkValue = manifestLink.value;
  const linkProblem = basePathProblem(referencePath(linkValue), basePath);
  if (linkProblem !== null) {
    errors.push(`The manifest link ${linkProblem}`);
    return null;
  }

  const manifestRelative = pathToBuildRelative(referencePath(linkValue), basePath);
  const manifestPath = resolveInside(distDirectory, manifestRelative);
  if (manifestPath === null || !existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
    errors.push(`The manifest link points at "${linkValue}", which is missing from the build.`);
    return null;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`The web app manifest is not valid JSON: ${message}`);
    return null;
  }

  if (!isRecord(manifest)) {
    errors.push('The web app manifest must be a JSON object.');
    return null;
  }

  for (const field of ['start_url', 'scope', 'id']) {
    const value = manifest[field];
    if (value === undefined) {
      if (field === 'start_url' || field === 'scope') {
        errors.push(`The web app manifest is missing "${field}".`);
      }
      continue;
    }
    if (!isRelativeUrl(value)) {
      errors.push(
        `The web app manifest "${field}" must be relative (for example "./"), received "${String(value)}".`,
      );
      continue;
    }
    const resolved = resolveAgainstManifest(value, basePath);
    if (!pathStaysUnderBase(resolved, basePath)) {
      errors.push(
        `The web app manifest "${field}" resolves to "${resolved}", outside "${basePath}".`,
      );
    }
  }

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  if (icons.length === 0) {
    errors.push('The web app manifest declares no icons.');
    return {
      path: manifestRelative,
      start_url: manifest.start_url,
      scope: manifest.scope,
      icons: [],
    };
  }

  const checkedIcons = [];
  for (const [index, icon] of icons.entries()) {
    const label = `Manifest icon ${index + 1}`;
    if (!isRecord(icon) || typeof icon.src !== 'string' || icon.src.trim() === '') {
      errors.push(`${label} has no src.`);
      continue;
    }
    if (!isRelativeUrl(icon.src)) {
      errors.push(`${label} ("${icon.src}") must be relative so it resolves under "${basePath}".`);
      continue;
    }

    const resolved = resolveAgainstManifest(icon.src, basePath);
    if (!pathStaysUnderBase(resolved, basePath)) {
      errors.push(`${label} resolves to "${resolved}", outside "${basePath}".`);
      continue;
    }

    const iconRelative = pathToBuildRelative(resolved, basePath);
    const iconPath = resolveInside(distDirectory, iconRelative);
    if (iconPath === null || !existsSync(iconPath) || !statSync(iconPath).isFile()) {
      errors.push(`${label} ("${icon.src}") is missing from the build.`);
      continue;
    }

    const bytes = readFileSync(iconPath);
    if (bytes.length === 0) {
      errors.push(`${label} ("${icon.src}") is empty.`);
      continue;
    }

    const declared = typeof icon.sizes === 'string' ? /^(\d+)x(\d+)$/.exec(icon.sizes) : null;
    if (declared === null) {
      errors.push(`${label} ("${icon.src}") must declare sizes as "<width>x<height>".`);
      continue;
    }

    const pngSize = readPngSize(bytes);
    if (pngSize === null) {
      errors.push(`${label} ("${icon.src}") is not a PNG file.`);
      continue;
    }

    const width = Number(declared[1]);
    const height = Number(declared[2]);
    if (pngSize.width !== width || pngSize.height !== height) {
      errors.push(
        `${label} ("${icon.src}") is ${pngSize.width}x${pngSize.height} but declares ${icon.sizes}.`,
      );
      continue;
    }

    checkedIcons.push({ src: icon.src, width, height, path: iconRelative, bytes: bytes.length });
  }

  return {
    path: manifestRelative,
    start_url: manifest.start_url,
    scope: manifest.scope,
    icons: checkedIcons,
  };
}

function formatPass(result) {
  const lines = [
    'Pages build check passed.',
    `build:    ${result.distDirectory}`,
    `base:     ${result.basePath} (${result.baseSource})`,
    `index:    ${result.files.length} asset reference(s), all inside the base path`,
    `manifest: ${result.manifest === null ? 'not found' : result.manifest.path} ` +
      `(start_url ${JSON.stringify(result.manifest.start_url)}, scope ${JSON.stringify(result.manifest.scope)})`,
  ];

  if (result.manifest !== null) {
    for (const icon of result.manifest.icons) {
      lines.push(`icon:     ${icon.path} ${icon.width}x${icon.height} (${icon.bytes} bytes)`);
    }
  }

  return lines.join('\n');
}

function formatFailure(result) {
  return [
    'Pages build check failed.',
    `build: ${result.distDirectory}`,
    `base:  ${result.basePath} (${result.baseSource})`,
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
      throw new PagesBuildError(`Option --${name} requires a value.`);
    }
    return { value, consumed: 2 };
  }
  return null;
}

export function parseArguments(argv) {
  const options = {
    distDirectory: DEFAULT_DIST_DIRECTORY,
    basePath: null,
    json: false,
    help: false,
  };

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

    const dist = readOption(argv, index, 'dist');
    if (dist !== null) {
      options.distDirectory = resolve(dist.value);
      index += dist.consumed;
      continue;
    }

    const base = readOption(argv, index, 'base');
    if (base !== null) {
      options.basePath = base.value;
      index += base.consumed;
      continue;
    }

    throw new PagesBuildError(`Unknown argument "${argument}". Use --help for usage.`);
  }

  if (options.basePath === null && typeof process.env.VITE_BASE_PATH === 'string') {
    options.basePath = process.env.VITE_BASE_PATH;
  }

  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const result = checkPagesBuild(options);

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
    console.error(`Pages build check failed: ${message}`);
    process.exitCode = 1;
  }
}
