import 'fake-indexeddb/auto';

import { createNotesDetectiveDatabase } from '../../src/data/db';
import type { NotesDetectiveDatabase } from '../../src/data/db';

let databaseCounter = 0;

/**
 * Every test gets a fresh IndexedDB database. fake-indexeddb shares a single
 * in-process factory, so the name must be unique inside a test file.
 */
export async function openTestDatabase(label: string): Promise<NotesDetectiveDatabase> {
  databaseCounter += 1;
  const db = createNotesDetectiveDatabase(`notes-detective-test-${label}-${databaseCounter}`);
  await db.open();
  return db;
}

/** Close and remove a test database so a failed assertion cannot leak rows. */
export async function closeTestDatabase(db: NotesDetectiveDatabase): Promise<void> {
  db.close();
  await db.delete();
}

/** Read a known fixture row without sprinkling non-null assertions in tests. */
export async function requireRow<T>(value: Promise<T | undefined>): Promise<T> {
  const row = await value;
  if (row === undefined) {
    throw new Error('Expected a fixture row but the table returned nothing');
  }
  return row;
}

/** A clock that advances one second per read so updatedAt changes are visible. */
export function advancingClock(start = '2026-01-02T03:04:05.000Z'): () => Date {
  let milliseconds = Date.parse(start);
  return () => {
    const value = new Date(milliseconds);
    milliseconds += 1000;
    return value;
  };
}
