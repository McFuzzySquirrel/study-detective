import { TITLE_MAX_LENGTH } from '../../domain/model';

/**
 * The first line of OCR output with at least one letter or digit,
 * whitespace-collapsed and bounded to the card-title limit. Punctuation-only
 * noise and blank lines are skipped. Returns null when OCR found no usable
 * title text.
 */
export function firstMeaningfulOcrLine(text: string): string | null {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (line.length === 0 || !/[\p{L}\p{N}]/u.test(line)) {
      continue;
    }

    return line.length > TITLE_MAX_LENGTH ? line.slice(0, TITLE_MAX_LENGTH).trimEnd() : line;
  }

  return null;
}
