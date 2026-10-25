import { z } from 'zod';
import type { ZodIssue } from 'zod';

import {
  MAX_TAGS,
  MAX_TAG_LENGTH,
  attachmentRecordSchema,
  buildPairKey,
  cardRecordSchema,
  caseRecordSchema,
  caseSummarySchema,
  connectionRecordSchema,
  isoDateSchema,
  isoTimestampSchema,
  uuidSchema,
  viewportSchema,
} from './model';
import type {
  AttachmentRecord,
  CardRecord,
  CardType,
  CaseRecord,
  CaseSummary,
  ConnectionRecord,
  ConnectionType,
  Viewport,
} from './model';

/**
 * Raised when a record, graph candidate, or archive-shaped object fails the
 * domain contract. Repositories surface this instead of writing or returning a
 * partially valid record.
 */
export class DomainValidationError extends Error {
  readonly issues: readonly ZodIssue[];

  constructor(message: string, issues: readonly ZodIssue[] = []) {
    super(message);
    this.name = 'DomainValidationError';
    this.issues = issues;
  }
}

export type ValidationResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: DomainValidationError };

function domainIssue(path: PropertyKey[], message: string): ZodIssue {
  return { code: 'custom', path, message };
}

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
  return `${path}: ${issue.message}`;
}

function throwIfIssues(issues: ZodIssue[], message: string): void {
  if (issues.length > 0) {
    throw new DomainValidationError(`${message}: ${issues.map(formatIssue).join('; ')}`, issues);
  }
}

/**
 * Validate an unknown value (typically an IndexedDB row or an imported
 * manifest entry) against a schema. Never trust stored data.
 */
export function validateRecord<T extends z.ZodType>(
  schema: T,
  input: unknown,
  label: string,
): ValidationResult<z.output<T>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }

  return {
    success: false,
    error: new DomainValidationError(
      `Invalid ${label}: ${parsed.error.issues.map(formatIssue).join('; ')}`,
      parsed.error.issues,
    ),
  };
}

export function parseRecord<T extends z.ZodType>(
  schema: T,
  input: unknown,
  label: string,
): z.output<T> {
  const result = validateRecord(schema, input, label);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

export function validateCaseRecord(input: unknown): ValidationResult<CaseRecord> {
  return validateRecord(caseRecordSchema, input, 'CaseRecord');
}

export function parseCaseRecord(input: unknown): CaseRecord {
  return parseRecord(caseRecordSchema, input, 'CaseRecord');
}

export function validateCardRecord(input: unknown): ValidationResult<CardRecord> {
  return validateRecord(cardRecordSchema, input, 'CardRecord');
}

export function parseCardRecord(input: unknown): CardRecord {
  return parseRecord(cardRecordSchema, input, 'CardRecord');
}

export function validateConnectionRecord(input: unknown): ValidationResult<ConnectionRecord> {
  return validateRecord(connectionRecordSchema, input, 'ConnectionRecord');
}

export function parseConnectionRecord(input: unknown): ConnectionRecord {
  return parseRecord(connectionRecordSchema, input, 'ConnectionRecord');
}

export function validateAttachmentRecord(input: unknown): ValidationResult<AttachmentRecord> {
  return validateRecord(attachmentRecordSchema, input, 'AttachmentRecord');
}

export function parseAttachmentRecord(input: unknown): AttachmentRecord {
  return parseRecord(attachmentRecordSchema, input, 'AttachmentRecord');
}

export function validateViewport(input: unknown): ValidationResult<Viewport> {
  return validateRecord(viewportSchema, input, 'Viewport');
}

export function parseViewport(input: unknown): Viewport {
  return parseRecord(viewportSchema, input, 'Viewport');
}

export function validateCaseSummary(input: unknown): ValidationResult<CaseSummary> {
  return validateRecord(caseSummarySchema, input, 'CaseSummary');
}

export function parseCaseSummary(input: unknown): CaseSummary {
  return parseRecord(caseSummarySchema, input, 'CaseSummary');
}

export function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

export function isIsoTimestamp(value: string): boolean {
  return isoTimestampSchema.safeParse(value).success;
}

export function isIsoDate(value: string): boolean {
  return isoDateSchema.safeParse(value).success;
}

/** True when `pairKey` is the canonical unordered key for this pair. */
export function isCanonicalPairKey(pairKey: string, cardIdA: string, cardIdB: string): boolean {
  return pairKey === buildPairKey(cardIdA, cardIdB);
}

/** Reject a stale or invented pair key before it reaches a unique index. */
export function assertCanonicalPairKey(pairKey: string, cardIdA: string, cardIdB: string): void {
  const expected = buildPairKey(cardIdA, cardIdB);
  if (pairKey !== expected) {
    throw new DomainValidationError(
      `Invalid pairKey: expected "${expected}" for the unordered pair`,
      [domainIssue(['pairKey'], `Expected "${expected}"`)],
    );
  }
}

/** Association strings may join any two distinct cards. */
export function isAssociationEligible(cardIdA: string, cardIdB: string): boolean {
  return cardIdA !== cardIdB;
}

/** Provenance is legal only between one Study Note and one Source. */
export function isProvenanceEligible(fromType: CardType, toType: CardType): boolean {
  return (
    (fromType === 'note' && toType === 'source') || (fromType === 'source' && toType === 'note')
  );
}

export type ConnectionCandidate = {
  readonly fromCardId: string;
  readonly toCardId: string;
  readonly type: ConnectionType;
};

/**
 * Check the type rules for a connection before it is written. Callers must
 * already have confirmed that both cards exist in the same case.
 */
export function assertConnectionEligible(
  candidate: ConnectionCandidate,
  fromType: CardType,
  toType: CardType,
): void {
  const issues: ZodIssue[] = [];

  if (!isAssociationEligible(candidate.fromCardId, candidate.toCardId)) {
    issues.push(domainIssue(['toCardId'], 'A connection cannot link a card to itself'));
  }

  if (candidate.type === 'provenance' && !isProvenanceEligible(fromType, toType)) {
    issues.push(
      domainIssue(['type'], 'Provenance is legal only between one Study Note and one Source'),
    );
  }

  throwIfIssues(issues, 'Invalid connection');
}

export type ConnectionEndpointCard = Pick<CardRecord, 'id' | 'caseId' | 'type'>;

/**
 * Validate a connection against the cards of its case: both endpoints exist,
 * belong to the same case, are distinct, use the canonical pair key, and obey
 * the provenance rule. This is the pure half of the repository boundary.
 */
export function assertConnectionInCase(
  connection: Pick<ConnectionRecord, 'caseId' | 'fromCardId' | 'toCardId' | 'pairKey' | 'type'>,
  cards: readonly ConnectionEndpointCard[],
): void {
  const issues: ZodIssue[] = [];
  const byId = new Map(cards.map((card) => [card.id, card] as const));
  const fromCard = byId.get(connection.fromCardId);
  const toCard = byId.get(connection.toCardId);

  if (fromCard === undefined) {
    issues.push(domainIssue(['fromCardId'], 'Connection endpoint does not exist in this case'));
  } else if (fromCard.caseId !== connection.caseId) {
    issues.push(domainIssue(['fromCardId'], 'Connection endpoint belongs to another case'));
  }

  if (toCard === undefined) {
    issues.push(domainIssue(['toCardId'], 'Connection endpoint does not exist in this case'));
  } else if (toCard.caseId !== connection.caseId) {
    issues.push(domainIssue(['toCardId'], 'Connection endpoint belongs to another case'));
  }

  if (connection.fromCardId === connection.toCardId) {
    issues.push(domainIssue(['toCardId'], 'A connection cannot link a card to itself'));
  }

  const expectedPairKey = buildPairKey(connection.fromCardId, connection.toCardId);
  if (connection.pairKey !== expectedPairKey) {
    issues.push(domainIssue(['pairKey'], `Expected the canonical pair key "${expectedPairKey}"`));
  }

  if (
    fromCard !== undefined &&
    toCard !== undefined &&
    fromCard.caseId === connection.caseId &&
    toCard.caseId === connection.caseId &&
    connection.type === 'provenance' &&
    !isProvenanceEligible(fromCard.type, toCard.type)
  ) {
    issues.push(
      domainIssue(['type'], 'Provenance is legal only between one Study Note and one Source'),
    );
  }

  throwIfIssues(issues, 'Connection is not valid for this case');
}

/** Trim a tag and reject the empty or overlong values the schema forbids. */
export function normalizeTag(tag: string): string {
  const normalized = tag.trim();
  if (normalized.length === 0) {
    throw new DomainValidationError('Invalid tag: tags must not be empty', [
      domainIssue(['tag'], 'Tag must not be empty'),
    ]);
  }
  if (normalized.length > MAX_TAG_LENGTH) {
    throw new DomainValidationError(
      `Invalid tag: tags must be at most ${MAX_TAG_LENGTH} characters`,
      [domainIssue(['tag'], `Tag must be at most ${MAX_TAG_LENGTH} characters`)],
    );
  }
  return normalized;
}

/**
 * Trim, deduplicate case-insensitively, and preserve the first display casing.
 * Rejects an eleventh distinct tag instead of silently dropping user input.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalizedTags: string[] = [];

  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalizedTags.push(normalized);
  }

  if (normalizedTags.length > MAX_TAGS) {
    throw new DomainValidationError(`Invalid tags: at most ${MAX_TAGS} distinct tags are allowed`, [
      domainIssue(['tags'], `At most ${MAX_TAGS} distinct tags are allowed`),
    ]);
  }

  return normalizedTags;
}
