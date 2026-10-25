/**
 * Typed failures for the persistence boundary.
 *
 * React and feature code should be able to tell "the record is gone" apart from
 * "the stored row is corrupt" and from "the write was rejected". Nothing here
 * logs user content: messages contain entity names and identifiers only.
 */

export type StorageEntity = 'case' | 'card' | 'connection' | 'attachment';

/**
 * Raised when a row exists in IndexedDB but fails the domain schema. Callers
 * must surface a recoverable storage error instead of returning partial data.
 */
export class StorageReadError extends Error {
  readonly entity: StorageEntity;
  readonly recordId: string;
  readonly cause: unknown;

  constructor(entity: StorageEntity, recordId: string, cause: unknown) {
    super(`Stored ${entity} "${recordId}" failed validation and cannot be read`);
    this.name = 'StorageReadError';
    this.entity = entity;
    this.recordId = recordId;
    this.cause = cause;
  }
}

/** Raised when a mutation targets a record that does not exist. */
export class RecordNotFoundError extends Error {
  readonly entity: StorageEntity;
  readonly recordId: string;

  constructor(entity: StorageEntity, recordId: string) {
    super(`${entity} "${recordId}" was not found`);
    this.name = 'RecordNotFoundError';
    this.entity = entity;
    this.recordId = recordId;
  }
}

/**
 * Convert any parse/validation failure into a typed read error. Already-typed
 * errors pass through so a nested read does not lose its entity context.
 */
export function readStored<T>(entity: StorageEntity, recordId: string, parse: () => T): T {
  try {
    return parse();
  } catch (cause) {
    if (cause instanceof StorageReadError) {
      throw cause;
    }
    throw new StorageReadError(entity, recordId, cause);
  }
}
