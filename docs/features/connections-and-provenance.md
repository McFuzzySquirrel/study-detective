# Feature: Connections and Provenance

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| LINK-FR-01 | This feature | owns |
| LINK-FR-02 | This feature | owns |
| LINK-FR-03 | This feature | owns |
| LINK-FR-04 | This feature | owns |
| LINK-FR-05 | This feature | owns |
| LINK-FR-06 | This feature | owns |
| VIS-CON-03 | [Vision](../PRD.md) | participates |
| VIS-CON-14 | [Vision](../PRD.md) | participates |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Connections and Provenance
**ID Prefix:** LINK
**Summary:** Adds the two string types, thread-anchor drag creation, provenance validation, rendering, retyping, deletion with undo, and a keyboard target picker.
**Dependencies:** Case Board
**Priority:** Must

---

## 2. User Stories

| ID | Persona | Priority |
|----|---------|----------|
| LINK-US-01 | Exam-focused university student | Must |
| LINK-US-02 | High-school student | Must |
| LINK-US-03 | Keyboard-only student | Must |

```forge-requirement
{"id":"LINK-US-01","kind":"story","text":"As a student, I want to draw a red string between a note and a topic so that the connection I see is the connection I am studying."}
```

```forge-requirement
{"id":"LINK-US-02","kind":"story","text":"As a student, I want to mark which source a note came from so that I can trace an idea back to the original material."}
```

```forge-requirement
{"id":"LINK-US-03","kind":"story","text":"As a keyboard-only student, I want to choose a target from a list so that I can build the same graph without dragging."}
```

---

## 3. Functional Requirements

```forge-requirement
{"id":"LINK-FR-01","kind":"requirement","text":"Create at most one undirected connection per unordered card pair by dragging from a card's thread anchor to a target card; reject self-links and duplicates with visible feedback and select the existing duplicate instead of creating another."}
```

```forge-requirement
{"id":"LINK-FR-02","kind":"requirement","text":"Support association strings, rendered red and created by default, and provenance strings, rendered as a thin dashed amber thread and valid only between a Study Note and a Source; allow changing the type after creation."}
```

```forge-requirement
{"id":"LINK-FR-03","kind":"requirement","text":"Render strings with a visible sag and anchor at card edges, update them during drag, pan, and zoom, support at least 300 strings, and replace draw animation with a static line when reduced motion is requested."}
```

```forge-requirement
{"id":"LINK-FR-04","kind":"requirement","text":"Delete a connection only after confirmation naming the two cards and relationship type, then offer a single-level 8-second undo toast; no labels, colors, or custom string styles are allowed."}
```

```forge-requirement
{"id":"LINK-FR-05","kind":"requirement","text":"Provide a keyboard target picker that creates, retypes, and deletes connections and attaches provenance from note detail, with provenance targets filtered to Sources and association targets unfiltered."}
```

```forge-requirement
{"id":"LINK-FR-06","kind":"requirement","text":"Cascade-delete every connection when either endpoint card is deleted and reject dangling endpoints at the repository boundary."}
```

```forge-requirement
{"id":"LINK-CON-01","kind":"constraint","text":"Exactly one connection may exist per unordered card pair, regardless of type; changing type updates the existing row rather than adding another."}
```

```forge-requirement
{"id":"LINK-CON-02","kind":"constraint","text":"Provenance is legal only between one Study Note and one Source; association may connect any two distinct cards."}
```

```forge-requirement
{"id":"LINK-CON-03","kind":"constraint","text":"Strings carry no text, score, direction arrow, custom color, or user-defined label in v1."}
```

---

## 4. UI / Interaction Design

- Each card shows a small thread anchor at its right edge when selected or hovered; on touch it appears after a tap selects the card. Dragging from the anchor draws a temporary red thread that follows the pointer and highlights a valid target.
- Dropping on a valid card creates an association by default and opens a small type menu with Association and Provenance. Provenance is disabled with an explanation unless the pair is a Study Note and a Source. Dismissing the menu keeps the association.
- Dropping on the same card, empty cork, or an existing pair cancels or selects the existing string. A short toast explains a duplicate.
- Strings sag 12px at 100 percent zoom, scale with the board, and anchor at card edges. Association is 3px red; provenance is 2px dashed amber. Reduced motion removes the draw-in animation.
- Tapping a string opens a small connection detail with the two card titles, type toggle, and Delete. Delete confirmation names both cards and the type.
- The legend is a collapsible key on the board: red line = association, dashed amber = provenance. It is not a label on individual strings.
- Keyboard: from card detail or the card list, `Connect to…` opens a dialog with a searchable target list and a type radio group. Provenance filters to Sources when the current card is a Note and to Notes when it is a Source. The same dialog can change type or delete an existing connection.
- Deleting a card already cascades its strings through BOARD-5; this feature's repository guarantees no dangling rows.

---

## 5. Task Plan

| ID | Observable outcome | Owner | Key outputs | Check | Exclusions |
|----|--------------------|-------|-------------|-------|------------|
| LINK-1 | Unique pair rules, provenance rule, repository and cascade | data-engineer | Domain connection rules, repository, tests | Unit and fake-indexeddb tests | No rendering |
| LINK-2 | Sagging string geometry and Pixi layer | board-engineer | Geometry, string layer, tests | Geometry tests | No creation gesture |
| LINK-3 | Thread-anchor creation, duplicate handling, type menu | board-engineer | Anchor, create hook, menu, browser journey | Component and Playwright tests | No detail panel |
| LINK-4 | Connection detail, retype, delete, undo, legend | ui-engineer | Detail, legend, undo hook, tests | Component tests | No keyboard picker |
| LINK-5 | Keyboard target picker and provenance attach | ui-engineer | Picker, card detail/list wiring, browser journey | Component and Playwright tests | No canvas placement |
| LINK-HR-1 | Human review of board and string feel | human reviewer | Review JSON | Interactive tablet/desktop checklist | Cannot approve release |

---

## 6. Implementation Tasks

### Phase 1: Graph rules and rendering

```forge-task
{
  "id": "LINK-1",
  "title": "Implement connection rules, repository, and cascade delete",
  "description": "Create connection domain helpers for unordered pair keys, self-link rejection, duplicate rejection, provenance eligibility (note to source only), association eligibility (any two distinct cards), and cascade plans. Create ConnectionRepository with create, retype, delete, list-by-case, and delete-by-card operations. Enforce the unique pairKey index, validate endpoints exist in the same case, use one transaction per mutation, and expose a test-only in-memory path. Add tests for A-B and B-A duplicates, self-links, provenance misuse, retype, cascade, and dangling endpoint rejection. Do not add Pixi or UI code.",
  "ownerAgent": "data-engineer",
  "dependencies": [
    "BOARD-2",
    "CAP-4"
  ],
  "expectedOutputs": [
    "src/domain/connections.ts",
    "src/data/connectionRepository.ts",
    "tests/domain/connections.test.ts",
    "tests/data/connectionRepository.test.ts"
  ],
  "validationCommands": [
    "npm test -- tests/domain/connections.test.ts tests/data/connectionRepository.test.ts",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/connections-and-provenance.md#LINK-FR-01",
      "docs/features/connections-and-provenance.md#LINK-FR-06"
    ],
    "acceptanceCriteria": [
      "Creating A-B then B-A is rejected as a duplicate and no second row exists",
      "Self-links are rejected before a write",
      "Provenance between a note and a source succeeds; provenance between any other pair fails",
      "Retyping updates the existing row and preserves its ID",
      "Deleting a card removes all its connections in the same transaction and leaves no dangling endpoint",
      "Repository reads validate and reject malformed or cross-case endpoints"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/connections-and-provenance.md#LINK-CON-01",
      "docs/features/connections-and-provenance.md#LINK-CON-02"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

```forge-task
{
  "id": "LINK-2",
  "title": "Render sagging association and provenance strings",
  "description": "Implement stringGeometry.ts to compute edge anchor points, control points, 12px sag scaled by zoom, dashed patterns, and hit-test bands for two card rectangles. Implement StringLayer.ts as a Pixi layer that draws association strings in 3px red and provenance in 2px dashed amber, updates during card drag and viewport changes, and renders statically under reduced motion. Mount StringLayer in BoardScene and update it when cards move. Add geometry tests for all relative positions, zero distance, zoom levels, and 300-string batches. Do not add creation gestures or labels.",
  "ownerAgent": "board-engineer",
  "dependencies": [
    "LINK-1"
  ],
  "expectedOutputs": [
    "src/board/stringGeometry.ts",
    "src/board/StringLayer.ts",
    "src/board/BoardScene.ts",
    "tests/board/stringGeometry.test.ts",
    "tests/board/stringGeometry.performance.test.ts"
  ],
  "validationCommands": [
    "npm test -- tests/board/stringGeometry.test.ts tests/board/stringGeometry.performance.test.ts",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/connections-and-provenance.md#LINK-FR-03"
    ],
    "acceptanceCriteria": [
      "Anchors land on the nearest card edges for cards above, below, left, and right",
      "BoardScene mounts StringLayer and redraws it when a card moves or the viewport changes",
      "Sag scales with zoom and stays within the card gap",
      "Association and provenance use the required color and dash pattern with no labels",
      "A 300-string batch computes in under 16ms on the test fixture",
      "Reduced motion draws the final string immediately with no animation state"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/connections-and-provenance.md#LINK-CON-03",
      "docs/PRD.md#VIS-CON-08"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

### Phase 2: Drawing and editing

```forge-task
{
  "id": "LINK-3",
  "title": "Add thread-anchor creation, duplicate feedback, and type menu",
  "description": "Implement ThreadAnchor as a Pixi interaction target at the selected card edge, mount it through CardSprite, add a temporary drag thread, target highlighting, drop handling, and a ConnectionTypeMenu with Association and Provenance. Default to association on drop. Disable provenance with an explanation unless the pair is note to source. Reject self-links and duplicates, selecting the existing connection and showing a toast. Wire creation through ConnectionRepository and the board store. Add component tests for the hook and menu, plus a Playwright journey that draws two strings, retypes one to provenance, and verifies persistence after reload.",
  "ownerAgent": "board-engineer",
  "dependencies": [
    "LINK-2"
  ],
  "expectedOutputs": [
    "src/board/ThreadAnchor.ts",
    "src/board/CardSprite.ts",
    "src/features/connections/ConnectionTypeMenu.tsx",
    "src/features/connections/useCreateConnection.ts",
    "tests/connections/useCreateConnection.test.tsx",
    "e2e/connections.spec.ts"
  ],
  "validationCommands": [
    "npm test -- tests/connections/useCreateConnection.test.tsx",
    "npm run test:e2e -- e2e/connections.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/connections-and-provenance.md#LINK-FR-01",
      "docs/features/connections-and-provenance.md#LINK-FR-02"
    ],
    "acceptanceCriteria": [
      "Dragging from the anchor to a valid card creates exactly one association and opens the type menu",
      "The selected card exposes a thread anchor in CardSprite and the anchor is reachable by pointer and touch",
      "Dropping on the same card or empty cork creates nothing and gives feedback",
      "Dropping on an existing pair selects that connection and does not create a duplicate",
      "Provenance is disabled for ineligible pairs with an announced reason",
      "The Playwright journey draws, retypes, reloads, and verifies both string types with no duplicate rows"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/connections-and-provenance.md#LINK-CON-01",
      "docs/features/connections-and-provenance.md#LINK-CON-02",
      "docs/features/connections-and-provenance.md#LINK-CON-03"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

```forge-task
{
  "id": "LINK-4",
  "title": "Build connection detail, retype, delete, undo, and legend",
  "description": "Create ConnectionDetail with the two card titles, current type, retype control, and Delete. Mount ConnectionDetail and ConnectionLegend on CaseBoardPage. Retype validates provenance eligibility and updates the existing row. Delete asks for confirmation naming both cards and the type, then removes the connection and shows an 8-second undo toast that restores the same ID. The legend uses red association and dashed amber provenance keys, collapsible on the board. Add component tests for retype, invalid retype, delete confirmation, undo restoration, timeout, and legend accessibility. Do not add the keyboard target picker.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "LINK-3"
  ],
  "expectedOutputs": [
    "src/features/connections/ConnectionDetail.tsx",
    "src/features/connections/ConnectionLegend.tsx",
    "src/features/connections/useUndoDeleteConnection.ts",
    "src/features/case/CaseBoardPage.tsx",
    "tests/connections/ConnectionDetail.test.tsx",
    "tests/connections/ConnectionLegend.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/connections/ConnectionDetail.test.tsx tests/connections/ConnectionLegend.test.tsx",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/connections-and-provenance.md#LINK-FR-02",
      "docs/features/connections-and-provenance.md#LINK-FR-04"
    ],
    "acceptanceCriteria": [
      "Retyping a valid pair updates the rendered string without changing the connection ID",
      "CaseBoardPage mounts ConnectionDetail on selection and ConnectionLegend in the board controls",
      "An invalid provenance retype is disabled and explains why",
      "Delete confirmation names both cards and the type; cancelling leaves the connection intact",
      "Undo restores the connection within 8 seconds; timeout and a second delete clear the undo slot",
      "The legend communicates both types without color alone and is keyboard operable"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/connections-and-provenance.md#LINK-CON-02",
      "docs/features/connections-and-provenance.md#LINK-CON-03"
    ],
    "references": [
      "docs/PRD.md#9. Accessibility"
    ]
  }
}
```

### Phase 3: Keyboard path and feel review

```forge-task
{
  "id": "LINK-5",
  "title": "Build the keyboard connection target picker",
  "description": "Create ConnectionPicker as a dialog with a searchable target list, type radio group, Save, and Cancel. From card detail and the card list, Connect to… opens it; from a note, a separate Attach source action opens it filtered to Sources. From a source, provenance targets are filtered to Notes. The picker can also retype or delete an existing connection. Announce target count and validation, restore focus to the trigger, and expose no canvas dependency. Add a Playwright keyboard journey that creates an association and a provenance link, retypes one, deletes one, and verifies persistence.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "LINK-4"
  ],
  "expectedOutputs": [
    "src/features/connections/ConnectionPicker.tsx",
    "src/features/cards/CardDetailPage.tsx",
    "src/features/case/CardListPanel.tsx",
    "tests/connections/ConnectionPicker.test.tsx",
    "e2e/keyboard-links.spec.ts"
  ],
  "validationCommands": [
    "npm test -- tests/connections/ConnectionPicker.test.tsx",
    "npm run test:e2e -- e2e/keyboard-links.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/connections-and-provenance.md#LINK-FR-05"
    ],
    "acceptanceCriteria": [
      "Connect to… is reachable from card detail and the card list with a visible focus path",
      "Provenance filters to Sources for a note and Notes for a source; association is unfiltered",
      "Create, retype, and delete all work without a pointer and persist after reload",
      "Validation errors and target counts are announced; focus returns to the trigger on close",
      "The Playwright keyboard journey completes the full link workflow with no canvas interaction"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/connections-and-provenance.md#LINK-CON-01",
      "docs/features/connections-and-provenance.md#LINK-CON-02",
      "docs/PRD.md#VIS-CON-15",
      "docs/PRD.md#VIS-CON-14"
    ],
    "references": [
      "docs/PRD.md#9. Accessibility"
    ]
  }
}
```

```forge-task
{
  "id": "LINK-HR-1",
  "title": "Review board, pin, and string feel on tablet and desktop",
  "description": "Using the running app, create a case, import at least six real photos, pin them, draw at least five associations and two provenance strings, trigger a duplicate, retype a string, delete and undo one, and move cards with a touch long press. Complete the same core journey on desktop with a mouse. Check reduced motion, 44px targets, visible focus, legend readability, and whether the board feels like the intended detective surface. Record the device, viewport, what was exercised, pass/fail per criterion, and concrete changes. This gate blocks closure and recall work only if the core board/string journey is unusable; it does not approve release.",
  "dependencies": [
    "LINK-1",
    "LINK-2",
    "LINK-3",
    "LINK-4",
    "LINK-5"
  ],
  "expectedOutputs": [],
  "validationCommands": [],
  "contract": {
    "version": 2,
    "kind": "human-review",
    "requirements": [],
    "requirementRefs": [
      "docs/features/connections-and-provenance.md#LINK-FR-01",
      "docs/features/connections-and-provenance.md#LINK-FR-02",
      "docs/features/connections-and-provenance.md#LINK-FR-03",
      "docs/features/connections-and-provenance.md#LINK-FR-04",
      "docs/features/connections-and-provenance.md#LINK-FR-05"
    ],
    "acceptanceCriteria": [
      "The reviewer completed the stated capture, pin, string, duplicate, retype, delete/undo, and drag journey on a tablet",
      "The reviewer completed the core journey with mouse and keyboard on desktop",
      "Reduced motion, 44px targets, focus visibility, and legend readability were checked",
      "The notes record device, viewport, what was exercised, and specific requested changes",
      "The result states whether closure and recall work may proceed"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/connections-and-provenance.md#LINK-CON-01",
      "docs/features/connections-and-provenance.md#LINK-CON-03",
      "docs/PRD.md#VIS-CON-08"
    ],
    "references": [
      "docs/features/connections-and-provenance.md#LINK-FR-03",
      "docs/PRD.md#9. Accessibility"
    ],
    "reviewFile": "docs/reviews/board-feel.json"
  }
}
```

---

## 7. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | Pair keys, provenance rules, cascade, geometry, 300-string batch | Vitest with deterministic fixtures |
| Data | Connection repository uniqueness, retype, cascade | fake-indexeddb with duplicate and dangling-endpoint tests |
| Component | Type menu, detail, legend, picker, undo | React Testing Library with keyboard flows |
| Browser | Drag creation, retype, delete/undo, keyboard link journey | Playwright at tablet and desktop |
| Human | Pin/string feel and tablet usability | LINK-HR-1 |

Key scenarios:

1. A-B then B-A never creates two rows.
2. Provenance rejects a note-to-topic pair.
3. A duplicate drop selects the existing string.
4. Undo restores the exact connection after deletion.
5. The keyboard picker creates both types and filters provenance targets.

---

## 8. Acceptance Criteria

1. Dragging from a thread anchor creates one undirected string, defaulting to association.
2. Provenance is valid only between a note and a source and renders dashed amber.
3. Strings sag, anchor at card edges, update during drag, and handle 300 connections.
4. Delete requires confirmation and offers an 8-second undo.
5. The keyboard picker creates, retypes, and deletes both types without the canvas.
6. Deleting a card never leaves a dangling connection.

---

## 9. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should the type menu appear after every drag? | Yes, but it auto-dismisses to association if untouched. |
| 2 | Should provenance be the default for note-to-source drags? | No; association remains the default and the student retypes. |
| 3 | Should strings be selectable on touch without opening card detail? | Yes; tapping a string opens connection detail. |
