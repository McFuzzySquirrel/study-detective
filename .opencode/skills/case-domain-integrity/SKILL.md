---
name: case-domain-integrity
description: "Pure domain schemas, graph invariants, normalized tags, deterministic search and filter selectors, readiness and lifecycle derivation, and transactional IndexedDB repository rules for a single-case evidence board."
---

# Case Domain Integrity

Use this skill whenever a Notes Detective change touches a persisted record, a graph rule, a case lifecycle state, tag normalization, search/filter semantics, or a repository transaction. The domain layer is the product's durable truth: React and Pixi code may render it, but only repositories write it, and only pure selectors decide readiness.

Load `references/domain-contracts.md` when defining or changing Case, Card, Connection, Attachment, Tag, readiness, or lifecycle fields and invariants.

Load `references/repository-rules.md` when writing a Dexie migration, repository method, cascade plan, transaction, persistence check, or multi-tab refresh path.

## Process

### Step 1: Classify the change before editing

Decide which layer owns the change. If the change alters a stored field, a validation boundary, or an index, then update the domain schema and mappers first. If it only derives a view value, then keep it in a pure selector and write no column. If it writes more than one table, then it belongs in one repository transaction.

Never add a "readiness", "looseThreadCount", "solved", "score", or "status" column to make a read cheaper. Those are derived from the graph on every read.

### Step 2: Lock the record and graph contract

Use UUID strings for IDs, ISO 8601 strings for every timestamp, and a strict schema that rejects unknown fields. Validate titles at 1-80 trimmed characters, tags at 10 maximum and 24 characters each, and viewport scale at 0.25-2.5.

Canonicalize every connection with an unordered `pairKey` built from the two card IDs (sort the two UUID strings, then join). One row per pair regardless of type. Association may join any two distinct cards; provenance is legal only between a Study Note and a Source. Retype updates the existing row and preserves its ID.

### Step 3: Derive readiness and lifecycle purely

Compute readiness from cards plus connections. A Study Note is loose when it lacks provenance to a Source or lacks an association to a Topic. A Topic is loose only when it has zero connections. Sources never produce loose threads. Topic status counts distinct linked notes: `orphan` at 0, `developing` at 1, `solved` at 2 or more; a topic with one connection but no linked note is orphan yet not loose.

Treat `closedAt` as metadata, never a lock. If a closed case is edited into loose threads, then keep `closedAt`, show `Closed · loose threads`, and require a fresh Close after repair. Reopen is explicit and confirmed; never auto-reopen or archive by exam date.

### Step 4: Implement the write path atomically

Every mutation commits in one read-write Dexie transaction. Case deletion cascades cases, cards, connections, and attachment Blobs together. Card deletion removes its connections and Blobs in the same transaction. Connection deletion is a single row write; connection cascade follows its endpoint card.

Validate on read as well as write. If a stored row fails schema parsing, then surface a recoverable storage error instead of returning partial data. A transaction failure must leave the previous graph exactly as it was.

### Step 5: Prove the invariants with tests

Write the failing boundary first: invalid title, bad date, unknown field, A-B then B-A, provenance between a note and a topic, readiness reason codes, tag dedupe, filter combination, rollback, and cascade with zero dangling rows.

Default command set:

```bash
npm test -- tests/domain/model.test.ts tests/domain/validation.test.ts
npm test -- tests/domain/connections.test.ts tests/domain/readiness.test.ts tests/domain/tags.test.ts
npm test -- tests/data/caseRepository.test.ts tests/data/connectionRepository.test.ts
npm run typecheck
```

If that doesn't work because the named test file does not exist yet, then create it as part of the task rather than weakening the command. Run the repository suite against `fake-indexeddb`, not a hand-written mock of Dexie.

## Gotchas

- **Unordered duplicates slip through when the key is computed at read time.** Persist the canonical `pairKey` at write time and put a unique index on it, or A-B and B-A become two rows.
- **Provenance validation is endpoint-sensitive.** A provenance row between two Notes, two Sources, or a Note and a Topic must fail before the write even when both cards exist in the same case.
- **Cascade means attachments too.** Deleting a case or card without deleting its original, display, and thumbnail Blobs leaves orphan media that no shelf count reveals.
- **Readiness needs a Topic, not any association.** A Note associated only to another Note is still loose; only an association whose other endpoint is a Topic satisfies the topic requirement.
- **Tag dedupe is case-insensitive but display-preserving.** `Biology` and `biology` are duplicates, and the first display casing survives; replacing it silently breaks search expectations.
- **Search combines differently at each level.** Query, type, and tag groups combine with AND, while selected tags combine with OR inside the tag group; treating all tags as AND produces empty results.
- **Stored dates are strings.** Persisting `Date` objects or comparing mixed types breaks shelf ordering, archive validation, and ISO round-trips.
- **Derived state must not become authoritative.** A persisted loose-thread count drifts after every connection edit and makes closure lie.
- **Multi-tab refresh must not clobber a draft.** Invalidate derived reads on a BroadcastChannel event, but never overwrite a form the student is editing.

## Validation

- [ ] Every field, ID, date, viewport, and unknown-field boundary has a failing-first test.
- [ ] A-B then B-A is rejected and the unique `pairKey` index is asserted on the real schema.
- [ ] Readiness fixtures cover orphan, developing, solved, loose note, loose topic, and ignored Source.
- [ ] A forced transaction failure leaves zero cards, zero connections, and zero orphan Blobs.
- [ ] Search and filter tests prove OR-within-tags, AND-with-type/query, and missing-OCR safety.
- [ ] `npm run typecheck` and the named domain/data suites pass with no skipped tests.

Self-check: reread the diff for any new derived column, any repository call from a component, or any network import in `src/domain` or `src/data`; remove it before handing off.
