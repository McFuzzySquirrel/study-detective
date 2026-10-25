# Feature: First-Run Demo and Hints

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| DEMO-FR-01 | This feature | owns |
| DEMO-FR-02 | This feature | owns |
| DEMO-FR-03 | This feature | owns |
| DEMO-FR-04 | This feature | owns |
| DEMO-FR-05 | This feature | owns |
| VIS-CON-03 | [Vision](../PRD.md) | participates |
| VIS-CON-08 | [Vision](../PRD.md) | participates |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** First-Run Demo and Hints
**ID Prefix:** DEMO
**Summary:** Seeds one locally generated, clearly labeled demo case on first run, removes it without reseeding, and teaches the thread anchor, long-press lift, and recall mode through one-time contextual hints that can be replayed.
**Dependencies:** Case Board, Connections and Provenance, Case Closure, Backup and Restore
**Priority:** Should

---

## 2. User Stories

| ID | Persona | Priority |
|----|---------|----------|
| DEMO-US-01 | High-school student | Should |
| DEMO-US-02 | Exam-focused university student | Should |

```forge-requirement
{"id":"DEMO-US-01","kind":"story","text":"As a first-time student, I want to see a small finished board so that I understand what a case is before I build my own."}
```

```forge-requirement
{"id":"DEMO-US-02","kind":"story","text":"As a student, I want short hints at the moment I need them so that a tour does not interrupt my first real case."}
```

---

## 3. Functional Requirements

```forge-requirement
{"id":"DEMO-FR-01","kind":"requirement","text":"Seed exactly one clearly labeled demo case only when the install has no cases and the demo has never been seeded; removing it is one confirmed action and never triggers an automatic reseed."}
```

```forge-requirement
{"id":"DEMO-FR-02","kind":"requirement","text":"Generate demo images locally with no third-party content, and include two Study Notes, two Sources, two Topics, and five connections that satisfy the close gate and include one solved and one developing topic."}
```

```forge-requirement
{"id":"DEMO-FR-03","kind":"requirement","text":"Show one-time contextual hints for the thread anchor, touch long-press lift, and recall mode at the moment each control is first relevant; do not include a scripted tour or modal carousel."}
```

```forge-requirement
{"id":"DEMO-FR-04","kind":"requirement","text":"Allow hints to be replayed from Settings, persist seen state locally, respect reduced motion, and move focus to the hint without trapping it."}
```

```forge-requirement
{"id":"DEMO-FR-05","kind":"requirement","text":"Keep demo removal isolated from user cases and preserve the demo marker through export and import so a restored demo remains labeled."}
```

```forge-requirement
{"id":"DEMO-CON-01","kind":"constraint","text":"All demo images are generated from local canvas or SVG drawing; no external image, font, or licensed artwork is used."}
```

```forge-requirement
{"id":"DEMO-CON-02","kind":"constraint","text":"Do not auto-create cases, cards, connections, tags, or hints for a student who already has a case; demo content exists only from the explicit first-run seed."}
```

---

## 4. UI / Interaction Design

- On first run with zero cases, the shelf shows the demo case at the top with a `Demo` ribbon and the copy `Demo case — remove it whenever you like.` It opens like any other case.
- The demo is a finished, closeable board titled `Demo Case: The Missing Lecture`. It contains six cards on a cork board with a readable layout, five strings, and a `Closed` or `Ready to close` state, so the student can immediately try recall and closure.
- Demo images look like photographed notebook pages: warm paper, ruled lines, a heading, and a few legible bullet lines. They are generated at runtime and stored as normal attachments. No real person's notes are used.
- Hints are small anchored popovers with one sentence, a `Got it` action, and an optional `Show me` that focuses the relevant control. They do not block the board and can be dismissed with Escape.
- Hint triggers: thread anchor when a case has at least two cards and the hint has not been seen; long-press when the app detects a coarse pointer and a card is selected; recall after the first connection exists. Each appears once per install.
- Settings has a `Replay hints` section with one button per hint and a `Reset all hints` action. Focus moves to the replayed hint and returns on dismiss.
- Removing the demo uses the normal destructive case confirmation but names it `demo case`; the shelf then shows the normal empty state. Reload does not recreate it.

---

## 5. Task Plan

| ID | Observable outcome | Owner | Key outputs | Check | Exclusions |
|----|--------------------|-------|-------------|-------|------------|
| DEMO-1 | Generated demo fixture, close-ready graph, seed/remove service | data-engineer | Demo case/images/seed, model marker, tests | Unit and round-trip tests | No UI |
| DEMO-2 | Persistent hint state, popover, replay settings | ui-engineer | Hints hook, popover, settings page, tests | Component tests | No first-run wiring |
| DEMO-3 | First-run seed, removal, contextual triggers, browser journey | ui-engineer | Bootstrap, shelf/hint wiring, route, browser test | Playwright first-run journey | No new demo content |

---

## 6. Implementation Tasks

### Phase 1: Demo content and seeding

```forge-task
{
  "id": "DEMO-1",
  "title": "Generate the demo case and implement one-time seeding",
  "description": "Create demoImages.ts to draw two note pages and two source pages locally on canvas at 1200x800, producing original, display, and thumbnail Blobs with no external assets. Create demoCase.ts with two notes, two sources, two topics, and five connections: note 1 to source 1 and note 2 to source 2 as provenance; note 1 to topic 1, note 2 to topic 1, and note 1 to topic 2 as associations. This must be close-ready with topic 1 solved and topic 2 developing. Create seedDemoCase.ts to write the case and attachments atomically only when no cases exist and the install-level demo flag is unset; set the flag even if seeding is skipped. Use the existing isDemo field on the case model. Add tests for the graph shape, readiness, image generation, one-time behavior, removal without reseed, and isDemo surviving an export/import round-trip. Do not add UI.",
  "ownerAgent": "data-engineer",
  "dependencies": [
    "BACKUP-2",
    "LINK-1",
    "CLOSE-1"
  ],
  "expectedOutputs": [
    "src/features/demo/demoImages.ts",
    "src/features/demo/demoCase.ts",
    "src/features/demo/seedDemoCase.ts",
    "tests/demo/seedDemoCase.test.ts",
    "tests/demo/demoCase.test.ts",
    "tests/demo/demoBackup.test.ts"
  ],
  "validationCommands": [
    "npm test -- tests/demo/seedDemoCase.test.ts tests/demo/demoCase.test.ts tests/demo/demoBackup.test.ts",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/first-run-demo-and-hints.md#DEMO-FR-01",
      "docs/features/first-run-demo-and-hints.md#DEMO-FR-02",
      "docs/features/first-run-demo-and-hints.md#DEMO-FR-05"
    ],
    "acceptanceCriteria": [
      "The demo graph has two notes, two sources, two topics, and five legal connections and is close-ready",
      "Topic 1 is solved with two notes and topic 2 is developing with one",
      "All demo images are generated locally and stored as normal original, display, and thumbnail attachments",
      "Seeding occurs only with zero cases and an unset flag; removing the demo never reseeds",
      "isDemo is true on the seeded case and survives export and import"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/first-run-demo-and-hints.md#DEMO-CON-01",
      "docs/features/first-run-demo-and-hints.md#DEMO-CON-02"
    ],
    "references": [
      "docs/PRD.md#10. System States / Lifecycle"
    ]
  }
}
```

### Phase 2: Hints

```forge-task
{
  "id": "DEMO-2",
  "title": "Implement persistent hints, the hint popover, and replay settings",
  "description": "Create hints.ts with ids thread-anchor, long-press, and recall, localStorage-backed seen state, isSeen, markSeen, resetHint, and resetAll. Create HintPopover with title, one sentence, Got it, optional Show me, Escape dismissal, focus move, and reduced-motion behavior. Replace the settings placeholder with SettingsPage containing a Replay hints section with one button per hint and Reset all hints. Do not wire contextual triggers or first-run seeding.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "DEMO-1",
    "FND-5"
  ],
  "expectedOutputs": [
    "src/features/onboarding/hints.ts",
    "src/features/onboarding/HintPopover.tsx",
    "src/features/onboarding/hints.css",
    "src/features/settings/SettingsPage.tsx",
    "src/app/routes.tsx",
    "tests/onboarding/hints.test.ts",
    "tests/onboarding/HintPopover.test.tsx",
    "tests/settings/SettingsPage.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/onboarding/hints.test.ts tests/onboarding/HintPopover.test.tsx tests/settings/SettingsPage.test.tsx",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/first-run-demo-and-hints.md#DEMO-FR-03",
      "docs/features/first-run-demo-and-hints.md#DEMO-FR-04"
    ],
    "acceptanceCriteria": [
      "Each hint is seen once per install and persists across reload",
      "Dismissing or pressing Escape marks the hint seen and returns focus to the trigger",
      "Settings can replay each hint and reset all seen state",
      "Reduced motion removes popover animation",
      "No scripted tour, modal carousel, or auto-advancing step is present"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/PRD.md#VIS-CON-08"
    ],
    "references": [
      "docs/PRD.md#9. Accessibility"
    ]
  }
}
```

### Phase 3: First-run integration

```forge-task
{
  "id": "DEMO-3",
  "title": "Wire first-run seeding, demo removal, and contextual hint triggers",
  "description": "Create AppBootstrap and mount it in src/App.tsx before routes render. On boot, check case count and the demo flag, seed once, and never block the shelf. Add a Demo ribbon and Remove demo wording to CaseShelf/CaseCard. Trigger thread-anchor hints when a case has at least two cards, long-press hints on coarse pointers when a card is selected, and recall hints after the first connection exists; mark each seen when dismissed. Add a Playwright first-run journey in a fresh context: demo appears, opens, shows its graph and readiness, a hint appears and is dismissed, the demo is removed, reload shows the empty shelf, and Settings replays a hint. Do not add new demo content or hint copy.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "DEMO-2",
    "BOARD-5",
    "LINK-HR-1"
  ],
  "expectedOutputs": [
    "src/app/AppBootstrap.tsx",
    "src/App.tsx",
    "src/features/shelf/CaseShelf.tsx",
    "src/features/shelf/CaseCard.tsx",
    "src/features/case/CaseBoardPage.tsx",
    "src/features/recall/RecallPage.tsx",
    "tests/demo/firstRun.test.tsx",
    "e2e/demo.spec.ts"
  ],
  "validationCommands": [
    "npm test -- tests/demo/firstRun.test.tsx",
    "npm run test:e2e -- e2e/demo.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/first-run-demo-and-hints.md#DEMO-FR-01",
      "docs/features/first-run-demo-and-hints.md#DEMO-FR-03",
      "docs/features/first-run-demo-and-hints.md#DEMO-FR-05"
    ],
    "acceptanceCriteria": [
      "A fresh install with zero cases seeds exactly one labeled demo case before the shelf renders",
      "An install with any existing case seeds nothing and sets the demo flag",
      "Removing the demo is confirmed, leaves user cases untouched, and does not reseed on reload",
      "Each hint triggers at most once at its specified moment and can be replayed from Settings",
      "The Playwright first-run journey covers seed, open, hint dismissal, removal, reload, and replay"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/first-run-demo-and-hints.md#DEMO-CON-02"
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
| Unit | Demo graph shape, readiness, generated images, one-time flags, backup marker | Vitest with canvas mocks and fake-indexeddb |
| Component | Hint popover, settings replay, demo ribbon, first-run bootstrap | React Testing Library |
| Browser | Fresh-context seed, open, hint, remove, reload, replay | Playwright with isolated storage state |
| Manual | Whether the demo teaches without feeling like a tutorial | Final acceptance review |

Key scenarios:

1. A fresh install shows exactly one demo case.
2. The demo satisfies the close gate and shows solved and developing topics.
3. Removing the demo and reloading does not recreate it.
4. A hint appears once and can be replayed.
5. isDemo survives export/import.

---

## 8. Acceptance Criteria

1. First run with no cases seeds one clearly labeled demo case.
2. The demo is locally generated, close-ready, and removable in one confirmed action.
3. Removal never reseeds and never touches user cases.
4. Three contextual hints appear once and can be replayed from Settings.
5. The demo marker survives backup restore.

---

## 9. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Should the demo be restorable later? | Not in v1; no automatic reseed. |
| 2 | Should hints use a spotlight overlay? | No; small anchored popovers. |
| 3 | Should the demo start open or closed? | Ready to close, not closed, so the student can try closing it. |
