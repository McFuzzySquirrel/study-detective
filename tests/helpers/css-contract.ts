import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export interface CssRule {
  readonly selector: string;
  readonly body: string;
  readonly media: string | null;
}

export function repositoryFile(relativePath: string): string {
  return resolve(process.cwd(), relativePath);
}

export function readRepositoryFile(relativePath: string): string {
  return readFileSync(repositoryFile(relativePath), 'utf8');
}

export function listComponentFiles(): string[] {
  return readdirSync(repositoryFile('src/components'))
    .filter((name) => name.endsWith('.tsx') || name.endsWith('.css') || name.endsWith('.ts'))
    .sort();
}

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function findMatchingBrace(css: string, openIndex: number): number {
  let depth = 0;

  for (let index = openIndex; index < css.length; index += 1) {
    if (css[index] === '{') {
      depth += 1;
    } else if (css[index] === '}') {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function parseBlock(css: string, media: string | null, rules: CssRule[]): void {
  let cursor = 0;

  while (cursor < css.length) {
    const open = css.indexOf('{', cursor);

    if (open === -1) {
      return;
    }

    const prelude = css.slice(cursor, open).trim();
    const close = findMatchingBrace(css, open);

    if (close === -1) {
      return;
    }

    const body = css.slice(open + 1, close);

    if (prelude.startsWith('@media')) {
      parseBlock(body, prelude, rules);
    } else if (prelude.startsWith('@supports') || prelude.startsWith('@layer')) {
      parseBlock(body, media, rules);
    } else if (!prelude.startsWith('@')) {
      rules.push({ selector: prelude, body, media });
    }

    cursor = close + 1;
  }
}

export function parseCssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  parseBlock(stripComments(css), null, rules);
  return rules;
}

function selectorList(rule: CssRule): string[] {
  return rule.selector
    .split(',')
    .map((selector) => selector.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

function parseDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();

  body.split(';').forEach((entry) => {
    const separator = entry.indexOf(':');

    if (separator === -1) {
      return;
    }

    const property = entry.slice(0, separator).trim().toLowerCase();
    const value = entry.slice(separator + 1).trim();

    if (property && value) {
      declarations.set(property, value);
    }
  });

  return declarations;
}

export interface DeclarationOptions {
  /** Only return declarations inside a media query containing this text. */
  readonly media?: string;
  /** Ignore media-query rules. */
  readonly topLevelOnly?: boolean;
}

export function declarationsFor(
  css: string,
  selector: string,
  options: DeclarationOptions = {},
): Map<string, string> {
  const declarations = new Map<string, string>();
  const normalizedTarget = selector.trim().replace(/\s+/g, ' ');

  parseCssRules(css).forEach((rule) => {
    if (!selectorList(rule).includes(normalizedTarget)) {
      return;
    }

    if (options.media && !(rule.media?.includes(options.media) ?? false)) {
      return;
    }

    if (options.topLevelOnly && rule.media !== null) {
      return;
    }

    parseDeclarations(rule.body).forEach((value, property) => {
      declarations.set(property, value);
    });
  });

  return declarations;
}

export function mediaBody(css: string, query: string): string {
  const clean = stripComments(css);
  let searchFrom = 0;

  while (searchFrom < clean.length) {
    const mediaIndex = clean.indexOf('@media', searchFrom);

    if (mediaIndex === -1) {
      return '';
    }

    const open = clean.indexOf('{', mediaIndex);

    if (open === -1) {
      return '';
    }

    const prelude = clean.slice(mediaIndex, open);

    if (prelude.includes(query)) {
      const close = findMatchingBrace(clean, open);
      return close === -1 ? '' : clean.slice(open + 1, close);
    }

    searchFrom = open + 1;
  }

  return '';
}

export function parseTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const clean = stripComments(css);
  const pattern = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let match = pattern.exec(clean);

  while (match) {
    const name = match[1];
    const value = match[2];

    if (name && value) {
      tokens.set(name, value.trim());
    }

    match = pattern.exec(clean);
  }

  return tokens;
}

export function resolveToken(
  tokens: Map<string, string>,
  name: string,
  seen: Set<string> = new Set(),
): string {
  if (seen.has(name)) {
    throw new Error(`Token ${name} contains a circular reference.`);
  }

  const value = tokens.get(name);

  if (value === undefined) {
    throw new Error(`Token ${name} is not defined.`);
  }

  seen.add(name);

  const reference = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/i.exec(value);

  if (reference) {
    const referencedName = reference[1];
    const fallback = reference[2];

    if (referencedName) {
      return resolveToken(tokens, referencedName, seen);
    }

    if (fallback) {
      return fallback.trim();
    }
  }

  return value;
}

export function parseHexColor(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());

  if (!match?.[1]) {
    throw new Error(`Expected a six-digit hex colour, received "${value}".`);
  }

  const digits = match[1];

  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
}

function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(color: string): number {
  const [red, green, blue] = parseHexColor(color);
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
}

export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function resolveColor(tokens: Map<string, string>, name: string): string {
  const value = resolveToken(tokens, name).trim();
  parseHexColor(value);
  return value;
}

export function resolveLengthPx(tokens: Map<string, string>, value: string | undefined): number {
  if (!value) {
    return Number.NaN;
  }

  const trimmed = value.trim();

  if (trimmed.startsWith('var(')) {
    return resolveLengthPx(
      tokens,
      resolveToken(tokens, trimmed.slice(4, trimmed.indexOf(')')).trim()),
    );
  }

  if (trimmed.endsWith('px')) {
    return Number.parseFloat(trimmed);
  }

  if (trimmed.endsWith('rem')) {
    return Number.parseFloat(trimmed) * 16;
  }

  return Number.NaN;
}
