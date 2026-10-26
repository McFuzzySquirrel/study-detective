import { describe, expect, it } from 'vitest';

import {
  MAX_TAGS,
  MAX_TAG_LENGTH,
  addTag,
  normalizeTag,
  removeTag,
  validateTagSet,
} from '../../src/domain/tags';
import { DomainValidationError } from '../../src/domain/validation';

describe('normalizeTag', () => {
  it('trims surrounding whitespace and preserves display casing', () => {
    expect(normalizeTag('  Cell Biology  ')).toBe('Cell Biology');
    expect(normalizeTag('cell biology')).toBe('cell biology');
  });

  it('accepts exactly the 24-character limit', () => {
    const tag = 'a'.repeat(MAX_TAG_LENGTH);
    expect(normalizeTag(`  ${tag}  `)).toBe(tag);
  });

  it('rejects an empty tag and a tag over 24 characters', () => {
    expect(() => normalizeTag('   ')).toThrow(DomainValidationError);
    expect(() => normalizeTag('a'.repeat(MAX_TAG_LENGTH + 1))).toThrow(
      `at most ${MAX_TAG_LENGTH} characters`,
    );
  });
});

describe('addTag', () => {
  it('trims a new tag and returns a new array without mutating the input', () => {
    const tags = ['Cell biology'];
    const result = addTag(tags, '  Exam 1  ');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tag).toBe('Exam 1');
      expect(result.tags).toEqual(['Cell biology', 'Exam 1']);
    }
    expect(tags).toEqual(['Cell biology']);
  });

  it('rejects an eleventh tag', () => {
    const tags = Array.from({ length: MAX_TAGS }, (_value, index) => `Tag ${index + 1}`);
    const result = addTag(tags, 'Overflow');

    expect(result).toMatchObject({ ok: false, code: 'too-many' });
    expect(result.tags).toEqual(tags);
    expect(result.ok ? '' : result.message).toContain(`at most ${MAX_TAGS} tags`);
  });

  it('rejects a tag over 24 characters', () => {
    const result = addTag([], 'a'.repeat(MAX_TAG_LENGTH + 1));

    expect(result).toMatchObject({ ok: false, code: 'too-long' });
    expect(result.tags).toEqual([]);
  });

  it('rejects case-insensitive duplicates and keeps the first display casing', () => {
    const tags = ['Cell Biology'];
    const result = addTag(tags, '  cell biology  ');

    expect(result).toMatchObject({ ok: false, code: 'duplicate' });
    expect(result.tags).toEqual(['Cell Biology']);
    expect(result.ok ? '' : result.message).toContain('Cell Biology');
  });

  it('rejects an empty or whitespace-only tag', () => {
    expect(addTag([], '')).toMatchObject({ ok: false, code: 'empty' });
    expect(addTag(['One'], '   ')).toMatchObject({ ok: false, code: 'empty' });
  });
});

describe('removeTag', () => {
  it('removes by index and by case-insensitive label', () => {
    const tags = ['Cell biology', 'Exam 1', 'Mitosis'];

    expect(removeTag(tags, 0)).toEqual(['Exam 1', 'Mitosis']);
    expect(removeTag(tags, 'exam 1')).toEqual(['Cell biology', 'Mitosis']);
    expect(tags).toEqual(['Cell biology', 'Exam 1', 'Mitosis']);
  });

  it('returns the original set for an out-of-range index or empty label', () => {
    const tags = ['Cell biology'];
    expect(removeTag(tags, -1)).toBe(tags);
    expect(removeTag(tags, 4)).toBe(tags);
    expect(removeTag(tags, '   ')).toBe(tags);
  });
});

describe('validateTagSet', () => {
  it('returns trimmed, deduplicated tags that preserve the first casing', () => {
    expect(validateTagSet(['  Cell Biology ', 'exam 1'])).toEqual({
      valid: true,
      tags: ['Cell Biology', 'exam 1'],
    });
  });

  it('reports empty, overlong, duplicate, and eleventh tags without throwing', () => {
    const tooLong = 'a'.repeat(MAX_TAG_LENGTH + 1);
    const tags = ['Cell Biology', '  cell biology  ', '   ', tooLong];
    const result = validateTagSet(tags);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.code)).toEqual(['duplicate', 'empty', 'too-long']);
    }
  });

  it('reports an eleventh distinct tag', () => {
    const tags = Array.from({ length: MAX_TAGS + 1 }, (_value, index) => `Tag ${index + 1}`);
    const result = validateTagSet(tags);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.code)).toContain('too-many');
    }
  });

  it('does not treat the same tag in different casing as two tags', () => {
    const result = validateTagSet(['Exam', 'EXAM']);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.tags).toEqual(['Exam']);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.code).toBe('duplicate');
    }
  });
});
