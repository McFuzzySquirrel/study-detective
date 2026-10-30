# Feature: Case Closure

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| CLOSE-FR-01 | This feature | owns |
| CLOSE-FR-02 | This feature | owns |
| CLOSE-FR-03 | This feature | owns |
| CLOSE-FR-04 | This feature | owns |
| CLOSE-FR-05 | This feature | owns |
| VIS-FR-04 | [Vision](../PRD.md) | participates |
| VIS-CON-03 | [Vision](../PRD.md) | participates |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Case Closure
**ID Prefix:** CLOSE
**Summary:** Derives loose threads and topic status from the graph, gates the close action on a structurally complete case, keeps closed cases editable, and supports manual reopen.
**Dependencies:** Connections and Provenance
**Priority:** Must

---

## 2. User Stories

| ID | Persona | Priority |
|----|---------|----------|
| CLOSE-US-01 | Exam-focused university student | Must |
| CLOSE-US-02 | Returning reviser | Must |

```forge-requirement
{"id":"CLOSE-US-01","kind":"story","text":"As a student, I want the app to tell me which notes or topics are still floating so that I can finish the case without guessing."}
```

```forge-requirement
{"id":"CLOSE-US-02","kind":"story","text":"As a student, I want closing a case to mean something without locking me out so that I can keep fixing a real exam board."}
```

---

## 3. Functional Requirements

```forge-requirement
{"id":"CLOSE-FR-01","kind":"requirement","text":"Derive loose threads as Study Notes with no provenance link to a Source or no association to a Topic, plus Topics with no connections; list each offender with a link to its card and never flag Sources."}
```

```forge-requirement
{"id":"CLOSE-FR-02","kind":"requirement","text":"Enable Close only when the loose-thread count is zero; closing records closedAt and shows a closed badge on the case and shelf."}
```

```forge-requirement
{"id":"CLOSE-FR-03","kind":"requirement","text":"Keep closed cases fully editable, recompute readiness after every edit, and show Closed with loose threads when an edit breaks the gate without silently clearing closedAt or reopening."}
```

```forge-requirement
{"id":"CLOSE-FR-04","kind":"requirement","text":"Offer a manual Reopen action that clears closedAt after confirmation; never auto-reopen, archive, or delete a case because of its exam date."}
```

```forge-requirement
{"id":"CLOSE-FR-05","kind":"requirement","text":"Derive Topic status as orphan with zero linked notes, developing with one, and solved with two or more, and display it on topic detail and in the card list without points, levels, XP, or ranking."}
```

```forge-requirement
{"id":"CLOSE-CON-01","kind":"constraint","text":"Closure is metadata, never a lock; all editing, recall, and export remain available on a closed case."}
```

```forge-requirement
{"id":"CLOSE-CON-02","kind":"constraint","text":"Readiness and topic status are pure derived values; do not store a loose-thread count or solved flag as authoritative state."}
```

```forge-requirement
{"id":"CLOSE-CON-03","kind":"constraint","text":"No score, points, XP, streak, grade, or ranking appears in the closure panel, badges, or case record."}
```

---

## 4. UI / Interaction Design

- The closure surface is opened by the band readiness chip on wide and by the Case closure icon on phone. Wide is a non-modal persistent trailing panel; phone is a modal sheet. It shows `Ready to close` or `N loose threads`, a list of offending cards, and the Close action. There is no permanent right column.
- Each loose thread row names the card and the missing requirement: `No source link`, `No topic connection`, or `No connections`. Selecting a row centers the card and opens detail; keyboard activation does the same.
- Close is disabled with an explanation until the list is empty. Closing is a quiet confirmation, not a celebration: a stamped `Closed` badge and the date. No score or confetti.
- A closed case shows `Closed` plus `Reopen`. If edits create loose threads, the badge reads `Closed · loose threads` and the panel lists them; after repair, Close appears again to re-affirm closure without changing the original story.
- Topic status appears on topic detail and in the card list as text plus a small icon: Orphan, Developing, Solved. Color is never the only signal. Sources and notes do not get status badges.
- The shelf shows the same closed badge and a loose-thread indicator when applicable.

---

## 5. Task Plan

| ID | Observable outcome | Owner | Key outputs | Check | Exclusions |
|----|--------------------|-------|-------------|-------|------------|
| CLOSE-1 | Pure readiness, loose-thread, and topic-status derivation | data-engineer | Readiness selectors, tests | Unit tests | No UI or storage |
| CLOSE-2 | Close, closed-with-threads, reopen, and panel | ui-engineer | Panel, lifecycle hook, repository extension, browser journey | Component and Playwright tests | No topic badge |
| CLOSE-3 | Topic status badges in detail and list | ui-engineer | Badge, card list wiring, tests | Component tests | No board sprite badge |

---

## 6. Implementation Tasks

### Phase 1: Derived rules

```forge-task
{
  "id": "CLOSE-1",
  "title": "Implement readiness, loose-thread, and topic-status selectors",
  "description": "Create readiness.ts with pure functions over cards and connections. A Study Note is ready when it has at least one provenance connection to a Source and at least one association connection to a Topic. A Topic is ready when it has at least one connection. Sources are ignored. Return loose notes and topics with a reason code, a total count, and a per-topic status of orphan, developing, or solved based on distinct linked notes. Reject duplicate counts and never infer status from stored flags. Add tests for empty graphs, partial graphs, wrong connection types, multiple links, and stable ordering.",
  "ownerAgent": "data-engineer",
  "dependencies": [
    "LINK-1"
  ],
  "expectedOutputs": [
    "src/domain/readiness.ts",
    "tests/domain/readiness.test.ts"
  ],
  "validationCommands": [
    "npm test -- tests/domain/readiness.test.ts",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/case-closure.md#CLOSE-FR-01",
      "docs/features/case-closure.md#CLOSE-FR-05"
    ],
    "acceptanceCriteria": [
      "A note with only an association or only provenance is loose with the correct reason",
      "A note associated to another note but not a topic is still loose",
      "A topic with zero connections is loose; one connection clears it even if no note is linked",
      "Topic status is orphan at 0 linked notes, developing at 1, and solved at 2 or more distinct notes",
      "Sources never appear as loose threads",
      "No scoring or stored readiness field is used"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/case-closure.md#CLOSE-CON-02",
      "docs/features/case-closure.md#CLOSE-CON-03"
    ],
    "references": [
      "docs/PRD.md#10. System States / Lifecycle"
    ]
  }
}
```

### Phase 2: Closure UI and lifecycle

```forge-task
{
  "id": "CLOSE-2",
  "title": "Build the closure panel, close, closed-with-threads, and reopen",
  "description": "Create ClosurePanel and useCaseLifecycle. Mount the panel on CaseBoardPage. Show readiness, loose-thread rows with links, and a Close action disabled until the count is zero. Closing writes closedAt through CaseRepository after confirmation. Render Closed and Reopen for a closed case; if edits break readiness, render Closed · loose threads without clearing closedAt. Reopen asks for confirmation and clears closedAt. Extend case summaries with loose-thread count and readiness for the shelf badge. Add component tests for every state and a Playwright journey that closes a complete case, adds a loose note, sees the warning, repairs it, and reopens. Do not add topic badges.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "CLOSE-1",
    "LINK-HR-1"
  ],
  "expectedOutputs": [
    "src/features/closure/ClosurePanel.tsx",
    "src/features/closure/useCaseLifecycle.ts",
    "src/domain/caseLifecycle.ts",
    "src/data/caseRepository.ts",
    "src/features/case/CaseBoardPage.tsx",
    "src/features/shelf/CaseCard.tsx",
    "tests/features/closure/ClosurePanel.test.tsx",
    "tests/domain/caseLifecycle.test.ts",
    "e2e/closure.spec.ts"
  ],
  "validationCommands": [
    "npm test -- tests/features/closure/ClosurePanel.test.tsx tests/domain/caseLifecycle.test.ts",
    "npm run test:e2e -- e2e/closure.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/case-closure.md#CLOSE-FR-02",
      "docs/features/case-closure.md#CLOSE-FR-03",
      "docs/features/case-closure.md#CLOSE-FR-04"
    ],
    "acceptanceCriteria": [
      "Close is disabled while any loose thread exists and explains the count",
      "Closing a ready case records closedAt and shows Closed on the case screen and shelf",
      "A closed case remains editable; adding a loose card shows Closed · loose threads and does not clear closedAt",
      "Repairing the graph re-enables Close without requiring reopen",
      "Reopen requires confirmation, clears closedAt, and never happens automatically",
      "Case summaries expose loose-thread count and readiness for the shelf badge",
      "The Playwright closure journey covers close, break, repair, and reopen"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/case-closure.md#CLOSE-CON-01",
      "docs/features/case-closure.md#CLOSE-CON-02"
    ],
    "references": [
      "docs/PRD.md#10. System States / Lifecycle"
    ]
  }
}
```

```forge-task
{
  "id": "CLOSE-3",
  "title": "Show topic status in card detail and the card list",
  "description": "Create TopicStatusBadge with text, icon, and tone for Orphan, Developing, and Solved. Add it to topic detail and the card list, and show the linked-note count. Keep the badge out of notes and sources. Ensure the status is computed from readiness selectors at read time and updates after connection changes. Add component tests for all three states, zero/one/two notes, keyboard label text, and no score wording. Do not modify the Pixi card sprite.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "CLOSE-2"
  ],
  "expectedOutputs": [
    "src/features/case/TopicStatusBadge.tsx",
    "src/features/case/CardListPanel.tsx",
    "src/features/cards/CardDetailPage.tsx",
    "tests/case/TopicStatusBadge.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/case/TopicStatusBadge.test.tsx",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/case-closure.md#CLOSE-FR-05",
      "docs/features/case-closure.md#CLOSE-FR-01"
    ],
    "acceptanceCriteria": [
      "Orphan, Developing, and Solved render with text and icon at 0, 1, and 2+ linked notes",
      "The badge updates after a connection is added or removed without a reload",
      "Notes and sources never render a topic badge",
      "The accessible name includes the status and linked-note count",
      "No points, XP, score, or ranking copy appears"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/case-closure.md#CLOSE-CON-03"
    ],
    "references": [
      "docs/PRD.md#10. System States / Lifecycle"
    ]
  }
}
```

---

## 7. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | Readiness reasons, topic status, lifecycle transitions | Vitest with graph fixtures |
| Component | Closure panel, badges, confirmation, closed-with-threads | React Testing Library |
| Browser | Close, break readiness, repair, reopen | Playwright on a complete case |
| Human | Whether closing feels meaningful | Final acceptance review |

Key scenarios:

1. A note with no source is loose even if it has topic links.
2. A topic with one connection is not loose but is still developing.
3. Close is disabled until zero loose threads.
4. A closed case edited into a loose state keeps `closedAt` and shows the warning.
5. Reopen requires confirmation and clears the badge.

---

## 8. Acceptance Criteria

1. Loose threads match the graph rules exactly and link to the offending cards.
2. Close is possible only at zero loose threads and records `closedAt`.
3. Closed cases stay editable and can show `Closed · loose threads`.
4. Reopen is manual and confirmed; nothing auto-reopens or archives.
5. Topic status is derived and displayed without points or score.

---

## 9. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Does an association to a Source satisfy a note's topic requirement? | No; the note needs an association to a Topic specifically. |
| 2 | Is a topic with one connection but no note "developing" or "orphan"? | Not loose; status is based on linked notes, so zero linked notes is Orphan but the topic is not a loose thread. |
| 3 | Should closing stamp a visible date? | Yes, the date is shown next to the Closed badge. |
