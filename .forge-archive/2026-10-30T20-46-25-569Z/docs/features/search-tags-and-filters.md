# Feature: Search Tags and Filters

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| SEARCH-FR-01 | This feature | owns |
| SEARCH-FR-02 | This feature | owns |
| SEARCH-FR-03 | This feature | owns |
| SEARCH-FR-04 | This feature | owns |
| SEARCH-FR-05 | This feature | owns |
| VIS-CON-03 | [Vision](../PRD.md) | participates |
| VIS-CON-14 | [Vision](../PRD.md) | participates |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Search Tags and Filters
**ID Prefix:** SEARCH
**Summary:** Adds normalized tags to every card, client-side title/tag/OCR search, type and tag filters, and a keyboard-navigable results panel that works on tablet and phone.
**Dependencies:** Case Board, Evidence Capture
**Priority:** Should

---

## 2. User Stories

| ID | Persona | Priority |
|----|---------|----------|
| SEARCH-US-01 | Exam-focused university student | Should |
| SEARCH-US-02 | Returning reviser | Should |

```forge-requirement
{"id":"SEARCH-US-01","kind":"story","text":"As a student, I want to tag a note with a topic name so that I can find related evidence without moving it."}
```

```forge-requirement
{"id":"SEARCH-US-02","kind":"story","text":"As a reviser, I want to find a card by part of its title or OCR text so that I do not have to hunt across the board."}
```

---

## 3. Functional Requirements

```forge-requirement
{"id":"SEARCH-FR-01","kind":"requirement","text":"Add and remove up to 10 tags on any card, normalize surrounding whitespace, enforce a 24-character maximum, deduplicate case-insensitively while preserving display casing, and persist tags with the card."}
```

```forge-requirement
{"id":"SEARCH-FR-02","kind":"requirement","text":"Search case-insensitively across card titles, tags, and stored OCR text with a 150ms debounce; do not search raw image pixels and do not call a server."}
```

```forge-requirement
{"id":"SEARCH-FR-03","kind":"requirement","text":"Filter by card type and tag, combine filters with AND, show active filters, and clear all filters and the query in one action."}
```

```forge-requirement
{"id":"SEARCH-FR-04","kind":"requirement","text":"Open Search from the board rail or phone bar as a non-modal popover on wide and a modal sheet on phone. Filters live inside the surface. Present results in a keyboard-navigable list; the committed query, type, and tags survive closing and reopening the surface for the open case; selecting a result closes the surface, centers and selects the card, and moves focus to the board heading."}
```

```forge-requirement
{"id":"SEARCH-FR-05","kind":"requirement","text":"Keep search and filtering client-side and read-only, and treat missing OCR text as no match rather than an error."}
```

```forge-requirement
{"id":"SEARCH-CON-01","kind":"constraint","text":"Search runs entirely in memory over the open case; no search index service, worker, or network call is introduced."}
```

```forge-requirement
{"id":"SEARCH-CON-02","kind":"constraint","text":"Search and filter interactions never mutate cards, connections, positions, or case metadata."}
```

```forge-requirement
{"id":"SEARCH-CON-03","kind":"constraint","text":"Only title, tags, and OCR text are searchable; image content and provenance labels are not."}
```

---

## 4. UI / Interaction Design

- Search is a rail/bar icon (`Search`, or `Search, filters active`) that opens a non-modal popover on wide and a modal bottom sheet on phone. Filters live inside that surface; there is no permanent toolbar.
- Typing filters live after 150ms. The panel shows result count, active filter chips, and a Clear all action.
- Filters are card type (All, Notes, Sources, Topics) and one or more tags. Tags are OR within the tag filter and AND with type and query.
- Results show type icon, title, matched tag or OCR snippet, and topic status for topics. The list is a single tab stop with arrow-key movement or a standard list of buttons; either way it is fully operable by keyboard.
- Selecting a result closes the surface, centers the card on the board, selects it, and moves focus to the board heading; a secondary Open detail action navigates to the card detail. Committed criteria survive close and reopen for the open case.
- Tag input in card forms: type a tag and press Enter or comma to add; Backspace removes the last; a counter shows `n/10`. Invalid or duplicate tags are announced and not added.
- No result state explains that only titles, tags, and OCR text are searched, not the handwritten image itself.

---

## 5. Task Plan

| ID | Observable outcome | Owner | Key outputs | Check | Exclusions |
|----|--------------------|-------|-------------|-------|------------|
| SEARCH-1 | Normalized tags on every card form and detail | ui-engineer | Tag domain, TagInput, form/detail wiring, tests | Domain and component tests | No search |
| SEARCH-2 | Live search, filters, results panel, board selection | ui-engineer | Search selectors, panel, board/list wiring, tests | Unit and component tests | No browser viewport journey |
| SEARCH-3 | Keyboard and phone search journey | qa-engineer | Playwright search spec | Playwright | No new product code |

---

## 6. Implementation Tasks

### Phase 1: Tags

```forge-task
{
  "id": "SEARCH-1",
  "title": "Add normalized tags to cards and card forms",
  "description": "Create tags.ts with normalizeTag, addTag, removeTag, and validateTagSet. Enforce trim, 24 characters, 10 tags per card, case-insensitive duplicate rejection, and preservation of the first display casing. Build TagInput with Enter/comma add, Backspace remove, a counter, announced errors, and 44px remove buttons. Wire TagInput into NoteSourceForm, TopicForm, and CardDetailPage so tags persist with the card and survive reload. Do not add search or filters.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "CAP-4"
  ],
  "expectedOutputs": [
    "src/domain/tags.ts",
    "src/features/search/TagInput.tsx",
    "src/features/search/TagInput.css",
    "src/features/capture/NoteSourceForm.tsx",
    "src/features/capture/TopicForm.tsx",
    "src/features/cards/CardDetailPage.tsx",
    "tests/domain/tags.test.ts",
    "tests/search/TagInput.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/domain/tags.test.ts tests/search/TagInput.test.tsx",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/search-tags-and-filters.md#SEARCH-FR-01"
    ],
    "acceptanceCriteria": [
      "Tags trim whitespace, reject over 24 characters, reject the eleventh tag, and deduplicate case-insensitively",
      "The first display casing is preserved and later duplicates do not replace it",
      "Enter and comma add a tag; Backspace removes the last; errors are announced",
      "Tags persist on notes, sources, and topics and survive reload",
      "Remove controls meet the 44px target and have accessible names"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/search-tags-and-filters.md#SEARCH-CON-02",
      "docs/PRD.md#VIS-CON-14"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

### Phase 2: Search and filters

```forge-task
{
  "id": "SEARCH-2",
  "title": "Implement live search, filters, and the results panel",
  "description": "Create searchCards.ts as a pure selector over cards, query, type filter, and tag filters. Match title, tags, and OCR text case-insensitively, use OR within selected tags and AND with type and query, and return stable results with matched context. Build SearchPanel with a 150ms debounced query, type and tag chips, result count, Clear all, a keyboard-navigable list, and an Open detail action. Wire it into CaseBoardPage and CardListPanel; selecting a result centers the card through the viewport store and selects it. On phone it becomes a sheet. Add unit and component tests. Do not add browser viewport coverage.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "SEARCH-1"
  ],
  "expectedOutputs": [
    "src/features/search/searchCards.ts",
    "src/features/search/SearchPanel.tsx",
    "src/features/search/SearchPanel.css",
    "src/features/case/CaseBoardPage.tsx",
    "src/features/case/CardListPanel.tsx",
    "tests/search/searchCards.test.ts",
    "tests/search/SearchPanel.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/search/searchCards.test.ts tests/search/SearchPanel.test.tsx",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/search-tags-and-filters.md#SEARCH-FR-02",
      "docs/features/search-tags-and-filters.md#SEARCH-FR-03",
      "docs/features/search-tags-and-filters.md#SEARCH-FR-04",
      "docs/features/search-tags-and-filters.md#SEARCH-FR-05"
    ],
    "acceptanceCriteria": [
      "Title, tag, and OCR text matches are found; a missing OCR field does not throw",
      "The query debounces at 150ms and filter changes apply immediately",
      "Type AND tag filters combine correctly and Clear all resets query, type, and tags",
      "Result count and no-result explanation are announced",
      "Selecting a result centers and selects the card; Open detail navigates without changing data",
      "Search and filter calls perform no writes"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/search-tags-and-filters.md#SEARCH-CON-01",
      "docs/features/search-tags-and-filters.md#SEARCH-CON-02",
      "docs/features/search-tags-and-filters.md#SEARCH-CON-03"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

### Phase 3: Browser verification

```forge-task
{
  "id": "SEARCH-3",
  "title": "Verify keyboard and phone search journeys",
  "description": "Add a Playwright spec that creates cards with tags and OCR text, opens search by keyboard, types a partial title, filters by type and tag, clears all, navigates results with the keyboard, and verifies the selected card is centered. Run the same flow in the phone project and assert the sheet is usable with no horizontal page overflow. Do not add new product code beyond test helpers.",
  "ownerAgent": "qa-engineer",
  "dependencies": [
    "SEARCH-2"
  ],
  "expectedOutputs": [
    "e2e/search.spec.ts"
  ],
  "validationCommands": [
    "npm run test:e2e -- e2e/search.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/search-tags-and-filters.md#SEARCH-FR-04",
      "docs/features/search-tags-and-filters.md#SEARCH-FR-05",
      "docs/PRD.md#VIS-FR-02"
    ],
    "acceptanceCriteria": [
      "Search opens, queries, filters, clears, and selects a result using only the keyboard",
      "The selected card is centered and selected on the board",
      "The phone sheet has no horizontal page overflow and all controls are reachable",
      "The test fails if the result list is empty or the selected card is not centered"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/PRD.md#VIS-CON-14"
    ],
    "references": [
      "docs/PRD.md#9. Accessibility"
    ]
  }
}
```

---

## 7. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | Tag normalization, search matching, filter combinations | Vitest with card fixtures |
| Component | TagInput, SearchPanel, result selection, no-result state | React Testing Library with user-event |
| Browser | Keyboard and phone search journey | Playwright desktop and phone projects |
| Manual | Whether search finds the right card quickly | Final acceptance review |

Key scenarios:

1. Case-insensitive tag dedupe preserves the first casing.
2. Search finds a partial title and an OCR phrase.
3. Type and tag filters combine with AND.
4. Clear all resets everything.
5. Keyboard selection centers the card; phone sheet does not overflow.

---

## 8. Acceptance Criteria

1. Any card can carry up to 10 normalized tags.
2. Search covers title, tags, and OCR text only and debounces at 150ms.
3. Type and tag filters combine with AND and clear in one action.
4. Results are keyboard navigable and select a card on the board.
5. Search is read-only and works without OCR text.

---

## 9. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should tags be global across cases? | No; tags live on cards within one case. |
| 2 | Should tag filters be AND instead of OR? | OR within tags, AND with type and query. |
| 3 | Should search include connection types? | No; cards only. |
