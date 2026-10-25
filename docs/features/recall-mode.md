# Feature: Recall Mode

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| RECALL-FR-01 | This feature | owns |
| RECALL-FR-02 | This feature | owns |
| RECALL-FR-03 | This feature | owns |
| RECALL-FR-04 | This feature | owns |
| RECALL-FR-05 | This feature | owns |
| RECALL-FR-06 | This feature | owns |
| VIS-CON-03 | [Vision](../PRD.md) | participates |
| VIS-CON-14 | [Vision](../PRD.md) | participates |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Recall Mode
**ID Prefix:** RECALL
**Summary:** A non-persistent review mode that hides strings, lets the student redraw connections on a scratch layer, and checks remembered, missed, extra, and type-mismatched pairs without a score.
**Dependencies:** Case Board, Connections and Provenance
**Priority:** Must

---

## 2. User Stories

| ID | Persona | Priority |
|----|---------|----------|
| RECALL-US-01 | Exam-focused university student | Must |
| RECALL-US-02 | Returning reviser | Must |

```forge-requirement
{"id":"RECALL-US-01","kind":"story","text":"As a student, I want to hide the strings and rebuild them from memory so that I can find out which connections I actually know."}
```

```forge-requirement
{"id":"RECALL-US-02","kind":"story","text":"As a student, I want to see what I missed without a grade so that I can go back to the notes instead of chasing a score."}
```

---

## 3. Functional Requirements

```forge-requirement
{"id":"RECALL-FR-01","kind":"requirement","text":"Enter recall for a case with every association and provenance string hidden while card images, titles, and positions remain visible, fitting the case to view in memory."}
```

```forge-requirement
{"id":"RECALL-FR-02","kind":"requirement","text":"Let the student draw undirected scratch connections between cards on a non-persistent layer, and discard all scratch state on exit, reload, or route change without a confirmation that blocks leaving."}
```

```forge-requirement
{"id":"RECALL-FR-03","kind":"requirement","text":"On check, mark a truth pair remembered when a scratch connection matches it in either direction, list missed truth pairs and extra scratch pairs, and flag a relationship-type mismatch separately from a missed pair."}
```

```forge-requirement
{"id":"RECALL-FR-04","kind":"requirement","text":"Present results as an accessible summary of remembered, missed, extra, and type-mismatched pairs with card titles and counts, never a score, percentage, grade, or ranking."}
```

```forge-requirement
{"id":"RECALL-FR-05","kind":"requirement","text":"Support keyboard entry, exit, and check, and make the results summary fully readable without drawing; scratch drawing remains pointer-only."}
```

```forge-requirement
{"id":"RECALL-FR-06","kind":"requirement","text":"Never write recall scratch state, results, or history to IndexedDB, localStorage, or backups, and respect reduced motion for scratch string animation."}
```

```forge-requirement
{"id":"RECALL-CON-01","kind":"constraint","text":"Recall performs no repository mutation; a test spy must prove no IndexedDB write occurs during enter, draw, check, or exit."}
```

```forge-requirement
{"id":"RECALL-CON-02","kind":"constraint","text":"Results are counts and pair lists only; no score, percentage, grade, streak, or comparative ranking."}
```

```forge-requirement
{"id":"RECALL-CON-03","kind":"constraint","text":"Titles and images stay visible; only strings and the truth graph are hidden until check."}
```

---

## 4. UI / Interaction Design

- Recall opens from a case with a `Recall` action. The board reappears without strings; titles and images stay. A slim toolbar shows `Scratch 0 connections`, `Check`, `Reset scratch`, and `Exit recall`.
- The student draws scratch connections with the same thread-anchor gesture. Scratch strings are neutral gray, not red or amber, and can be deleted individually.
- `Check` overlays the truth: remembered pairs get a check marker, missed truth pairs a dashed outline, extra scratch pairs a muted cross, and type mismatches an `Association drawn / Provenance actual` label. The board remains pannable and zoomable.
- A result panel lists grouped pairs by card title with counts. It is a normal keyboard-readable list, not a canvas-only overlay. No score or percentage appears.
- `Reset scratch` clears drawings and results but keeps the mode. `Exit recall` returns to the case and discards everything; if scratch is non-empty, an in-app confirmation appears. Browser back or reload discards silently.
- Entry, check, reset, and exit are keyboard reachable. The results list can be read without interacting with the canvas.
- Reduced motion: scratch lines appear immediately, and the check overlay does not animate.

---

## 5. Task Plan

| ID | Observable outcome | Owner | Key outputs | Check | Exclusions |
|----|--------------------|-------|-------------|-------|------------|
| RECALL-1 | Scratch store and pairwise comparison logic | board-engineer | Scratch store, compare function, tests | Unit tests and write spy | No UI |
| RECALL-2 | Recall route, hidden strings, scratch drawing, exit/reset | board-engineer | Recall page/toolbar/hook, board mode, route, browser journey | Component and Playwright tests | No results panel |
| RECALL-3 | Check overlay and accessible results summary | ui-engineer | Results/summary components, tests | Component tests | No persistence |

---

## 6. Implementation Tasks

### Phase 1: Non-persistent recall logic

```forge-task
{
  "id": "RECALL-1",
  "title": "Implement scratch connections and recall comparison",
  "description": "Create recallStore.ts with scratch pairs, add, remove, clear, and reset-on-exit actions that exist only in memory. Create compareConnections.ts to canonicalize pairs, compare truth and scratch in either direction, and return remembered, missed, extra, and typeMismatch arrays with stable ordering and no score. Add unit tests for empty, exact, reversed, duplicate, extra, missed, and type-mismatch cases. Add a write-spy test proving no repository or IndexedDB method is called by the store or comparison.",
  "ownerAgent": "board-engineer",
  "dependencies": [
    "LINK-1"
  ],
  "expectedOutputs": [
    "src/features/recall/recallStore.ts",
    "src/features/recall/compareConnections.ts",
    "tests/recall/compareConnections.test.ts",
    "tests/recall/recallStore.test.ts"
  ],
  "validationCommands": [
    "npm test -- tests/recall/compareConnections.test.ts tests/recall/recallStore.test.ts",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/recall-mode.md#RECALL-FR-02",
      "docs/features/recall-mode.md#RECALL-FR-03",
      "docs/features/recall-mode.md#RECALL-FR-06"
    ],
    "acceptanceCriteria": [
      "A reversed scratch pair counts as remembered",
      "Missed truth, extra scratch, and type mismatch are distinct outputs with no duplicates",
      "Clear and reset return the store to an empty scratch state",
      "No comparison result contains a score, percentage, or rank",
      "The write-spy test fails if any storage write occurs"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/recall-mode.md#RECALL-CON-01",
      "docs/features/recall-mode.md#RECALL-CON-02"
    ],
    "references": [
      "docs/PRD.md#10. System States / Lifecycle"
    ]
  }
}
```

### Phase 2: Recall experience

```forge-task
{
  "id": "RECALL-2",
  "title": "Build the recall route, hidden strings, and scratch drawing",
  "description": "Create RecallPage, RecallToolbar, and useScratchConnections. Extend BoardCanvas with a recall mode that hides truth strings, keeps titles and images, fits the case to view in memory, and renders neutral scratch strings. Reuse the thread-anchor gesture to add scratch pairs without calling ConnectionRepository; support removing an individual scratch string. Add Reset scratch and Exit recall with an in-app confirmation when scratch is non-empty. Route /case/:caseId/recall and wire entry from the case. Add component tests and a Playwright journey that enters recall, draws reversed pairs, checks, resets, and exits. Do not add the results panel.",
  "ownerAgent": "board-engineer",
  "dependencies": [
    "RECALL-1",
    "LINK-4"
  ],
  "expectedOutputs": [
    "src/features/recall/RecallPage.tsx",
    "src/features/recall/RecallToolbar.tsx",
    "src/features/recall/useScratchConnections.ts",
    "src/features/recall/recall.css",
    "src/board/BoardCanvas.tsx",
    "src/app/routes.tsx",
    "tests/recall/RecallPage.test.tsx",
    "e2e/recall.spec.ts"
  ],
  "validationCommands": [
    "npm test -- tests/recall/RecallPage.test.tsx",
    "npm run test:e2e -- e2e/recall.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/recall-mode.md#RECALL-FR-01",
      "docs/features/recall-mode.md#RECALL-FR-02",
      "docs/features/recall-mode.md#RECALL-FR-05",
      "docs/features/recall-mode.md#RECALL-FR-06"
    ],
    "acceptanceCriteria": [
      "Entering recall hides every truth string while titles, images, and positions remain visible",
      "Scratch strings render in a neutral style and add or remove without any repository call",
      "Exit and route change discard scratch; the in-app exit asks before discarding non-empty scratch",
      "Entry, reset, and exit are keyboard reachable; drawing itself remains pointer-only",
      "The Playwright journey enters, draws, resets, exits, and verifies the case graph is unchanged"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/recall-mode.md#RECALL-CON-01",
      "docs/features/recall-mode.md#RECALL-CON-03"
    ],
    "references": [
      "docs/PRD.md#10. System States / Lifecycle"
    ]
  }
}
```

```forge-task
{
  "id": "RECALL-3",
  "title": "Add the check overlay and accessible results summary",
  "description": "Create RecallResults and RecallSummary. On Check, compute comparison results and overlay markers on the board: remembered check, missed dashed outline, extra muted cross, and a type-mismatch label. Render a grouped summary list of remembered, missed, extra, and type-mismatched pairs with card titles and counts inside RecallPage. Announce the summary with aria-live and keep it fully keyboard readable. Respect reduced motion and ensure no score wording. Add component tests for all groups, type mismatch, empty scratch, and keyboard reading; extend the Playwright recall journey to assert visible results and no persistence.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "RECALL-2"
  ],
  "expectedOutputs": [
    "src/features/recall/RecallResults.tsx",
    "src/features/recall/RecallSummary.tsx",
    "src/features/recall/RecallToolbar.tsx",
    "src/features/recall/RecallPage.tsx",
    "tests/recall/RecallResults.test.tsx",
    "tests/recall/compareConnections.type.test.ts",
    "e2e/recall-results.spec.ts"
  ],
  "validationCommands": [
    "npm test -- tests/recall/RecallResults.test.tsx tests/recall/compareConnections.type.test.ts",
    "npm run test:e2e -- e2e/recall-results.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/recall-mode.md#RECALL-FR-03",
      "docs/features/recall-mode.md#RECALL-FR-04",
      "docs/features/recall-mode.md#RECALL-FR-05"
    ],
    "acceptanceCriteria": [
      "A reversed scratch pair is marked remembered and a missing truth pair is marked missed",
      "A pair with the right endpoints but wrong type appears in both remembered and type-mismatch groups with an explanatory label",
      "The summary lists pairs by card title and counts, with no score or percentage",
      "RecallPage renders RecallResults after Check and keeps the toolbar controls available",
      "The summary is announced and readable by keyboard without canvas interaction",
      "Reduced motion removes overlay animation",
      "No recall result is written to storage"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/recall-mode.md#RECALL-CON-01",
      "docs/features/recall-mode.md#RECALL-CON-02",
      "docs/PRD.md#VIS-CON-08"
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
| Unit | Pair comparison, reverse matching, type mismatch, scratch reset, write spy | Vitest with truth/scratch fixtures |
| Component | Recall page, toolbar, results, summary, keyboard reading | React Testing Library |
| Browser | Enter, draw, check, reset, exit, graph unchanged | Playwright at tablet and desktop |
| Human | Whether recall exposes real gaps without feeling punitive | Final acceptance review |

Key scenarios:

1. Reversed pairs count as remembered.
2. A wrong-type pair is remembered and flagged separately.
3. Extra and missed pairs are listed with titles.
4. Exit discards scratch and leaves the case graph unchanged.
5. No storage write occurs during recall.

---

## 8. Acceptance Criteria

1. Recall hides all strings but keeps titles and images.
2. Scratch connections are non-persistent and discarded on exit, reload, or route change.
3. Check reports remembered, missed, extra, and type-mismatched pairs with no score.
4. The results summary is accessible and keyboard readable.
5. Recall performs no storage mutation and respects reduced motion.

---

## 9. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should provenance strings be hidden in recall? | Yes; all truth strings hide and the type is checked. |
| 2 | Should the student be able to retry immediately? | Yes; Reset scratch clears and stays in recall. |
| 3 | Should recall persist a history? | No; never in v1. |
