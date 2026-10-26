/**
 * Shared board-capacity thresholds.
 *
 * The board and the capture route both import this module so a direct capture
 * address cannot create a 201st card. It is deliberately pure and free of
 * React, PixiJS, Dexie, and feature imports so the capture bundle never pulls
 * the renderer in through a capacity check.
 *
 * Contract:
 *
 * - 0-119 cards: no warning.
 * - 120-149 cards: dismissible soft warning.
 * - 150-199 cards: persistent warning advising a case split.
 * - 200 cards or more: hard stop; a new card is refused with a split message.
 */

/** The first count that shows the dismissible soft warning. */
export const SOFT_WARNING_CARD_COUNT = 120;

/** The first count that shows the persistent split-case warning. */
export const PERSISTENT_WARNING_CARD_COUNT = 150;

/** The hard ceiling. A case may hold this many cards but no more. */
export const MAX_BOARD_CARDS = 200;

export type BoardCapacityLevel = 'normal' | 'soft' | 'persistent' | 'blocked';

/** Normalise a possibly stale or corrupted count into a nonnegative integer. */
export function normalizeCardCount(cardCount: number): number {
  if (!Number.isFinite(cardCount) || cardCount <= 0) {
    return 0;
  }
  return Math.floor(cardCount);
}

/** Classify a card count into the four documented capacity states. */
export function boardCapacityLevel(cardCount: number): BoardCapacityLevel {
  const count = normalizeCardCount(cardCount);

  if (count >= MAX_BOARD_CARDS) {
    return 'blocked';
  }
  if (count >= PERSISTENT_WARNING_CARD_COUNT) {
    return 'persistent';
  }
  if (count >= SOFT_WARNING_CARD_COUNT) {
    return 'soft';
  }
  return 'normal';
}

/** True while a new card may still be created. 199 is allowed; 200 is not. */
export function canAddCard(cardCount: number): boolean {
  return normalizeCardCount(cardCount) < MAX_BOARD_CARDS;
}

/** How many cards can still be added before the hard stop. */
export function remainingCardCapacity(cardCount: number): number {
  return Math.max(0, MAX_BOARD_CARDS - normalizeCardCount(cardCount));
}

/** The hard-stop copy shared by the board warning and the capture route. */
export const SPLIT_CASE_MESSAGE =
  'This case is full at 200 cards. Create a new case and split these cards across the two boards so the board stays usable.';

/** The same message with the exact count, for diagnostic surfaces. */
export function splitCaseMessage(cardCount: number = MAX_BOARD_CARDS): string {
  const count = Math.max(normalizeCardCount(cardCount), MAX_BOARD_CARDS);
  return `This case is full at ${count} cards. Create a new case and split these cards across the two boards so the board stays usable.`;
}
