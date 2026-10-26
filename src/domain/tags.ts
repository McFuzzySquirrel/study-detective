/**
 * Pure tag rules shared by every card form, the card detail screen, search, and
 * the repository validator.
 *
 * A tag is a short free-text label. The same case-insensitive key must never
 * appear twice, the first display casing wins, and a card may carry at most
 * `MAX_TAGS` tags. Nothing in this module touches storage or React; callers
 * persist the returned array through the repository boundary.
 */

import { MAX_TAGS, MAX_TAG_LENGTH } from './model';

export { MAX_TAGS, MAX_TAG_LENGTH };
export { normalizeTag } from './validation';

export type TagRuleCode = 'empty' | 'too-long' | 'duplicate' | 'too-many';

export interface TagRuleIssue {
  readonly code: TagRuleCode;
  /** Safe to show to a student; never includes storage or framework details. */
  readonly message: string;
  /** Position in the supplied array, when the issue belongs to one entry. */
  readonly index?: number;
}

export type TagSetValidation =
  | { readonly valid: true; readonly tags: readonly string[] }
  | {
      readonly valid: false;
      /** Best-effort normalized tags; never write this set while invalid. */
      readonly tags: readonly string[];
      readonly issues: readonly TagRuleIssue[];
    };

export type TagAddResult =
  | { readonly ok: true; readonly tag: string; readonly tags: readonly string[] }
  | {
      readonly ok: false;
      readonly code: TagRuleCode;
      readonly message: string;
      /** The unchanged input set, so a caller can keep rendering it. */
      readonly tags: readonly string[];
    };

function emptyMessage(): string {
  return 'Tags must not be empty.';
}

function tooLongMessage(): string {
  return `Tags can be at most ${MAX_TAG_LENGTH} characters.`;
}

function duplicateMessage(tag: string): string {
  return `“${tag}” is already a tag on this card.`;
}

function tooManyMessage(): string {
  return `A card can have at most ${MAX_TAGS} tags. Remove one before adding another.`;
}

/**
 * Validate a whole tag set without throwing. The returned `tags` array is
 * trimmed and deduplicated case-insensitively, preserving the first casing, so
 * a valid result can be persisted as-is. Duplicate, empty, overlong, and
 * eleventh tags are reported instead of silently dropped.
 */
export function validateTagSet(tags: readonly string[]): TagSetValidation {
  const issues: TagRuleIssue[] = [];
  const normalized: string[] = [];
  const seen = new Set<string>();

  tags.forEach((raw, index) => {
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      issues.push({ code: 'empty', message: emptyMessage(), index });
      return;
    }

    if (trimmed.length > MAX_TAG_LENGTH) {
      issues.push({ code: 'too-long', message: tooLongMessage(), index });
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      issues.push({ code: 'duplicate', message: duplicateMessage(trimmed), index });
      return;
    }

    seen.add(key);
    normalized.push(trimmed);
  });

  if (normalized.length > MAX_TAGS) {
    issues.push({
      code: 'too-many',
      message: tooManyMessage(),
      index: MAX_TAGS,
    });
  }

  if (issues.length > 0) {
    return { valid: false, tags: normalized, issues };
  }

  return { valid: true, tags: normalized };
}

/**
 * Add one raw tag. Surrounding whitespace is trimmed, the 24-character limit
 * and the 10-tag limit are enforced, and an existing tag is rejected by its
 * case-insensitive key so the original display casing survives.
 */
export function addTag(tags: readonly string[], raw: string): TagAddResult {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { ok: false, code: 'empty', message: emptyMessage(), tags };
  }

  if (trimmed.length > MAX_TAG_LENGTH) {
    return { ok: false, code: 'too-long', message: tooLongMessage(), tags };
  }

  const key = trimmed.toLowerCase();
  const duplicate = tags.find((tag) => tag.trim().toLowerCase() === key);
  if (duplicate !== undefined) {
    return {
      ok: false,
      code: 'duplicate',
      message: duplicateMessage(duplicate),
      tags,
    };
  }

  if (tags.length >= MAX_TAGS) {
    return { ok: false, code: 'too-many', message: tooManyMessage(), tags };
  }

  return { ok: true, tag: trimmed, tags: [...tags, trimmed] };
}

/**
 * Remove a tag by array index or by case-insensitive label. Returns a new
 * array; the caller owns persistence.
 */
export function removeTag(tags: readonly string[], target: string | number): readonly string[] {
  if (typeof target === 'number') {
    if (!Number.isInteger(target) || target < 0 || target >= tags.length) {
      return tags;
    }

    return tags.filter((_tag, index) => index !== target);
  }

  const key = target.trim().toLowerCase();
  if (key.length === 0) {
    return tags;
  }

  return tags.filter((tag) => tag.trim().toLowerCase() !== key);
}
