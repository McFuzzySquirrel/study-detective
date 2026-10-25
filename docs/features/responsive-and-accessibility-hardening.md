# Feature: Responsive and Accessibility Hardening

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| A11Y-FR-01 | This feature | owns |
| A11Y-FR-02 | This feature | owns |
| A11Y-FR-03 | This feature | owns |
| A11Y-FR-04 | This feature | owns |
| A11Y-FR-05 | This feature | owns |
| A11Y-FR-06 | This feature | owns |
| A11Y-FR-07 | This feature | owns |
| A11Y-FR-08 | This feature | owns |
| VIS-FR-02 | [Vision](../PRD.md) | participates |
| VIS-FR-03 | [Vision](../PRD.md) | participates |
| VIS-CON-06 | [Vision](../PRD.md) | participates |
| VIS-CON-08 | [Vision](../PRD.md) | participates |
| VIS-CON-14 | [Vision](../PRD.md) | participates |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Responsive and Accessibility Hardening
**ID Prefix:** A11Y
**Summary:** Audits and completes responsive layouts, keyboard parity, contrast, targets, reduced motion, automated accessibility scans, performance budgets, and browser compatibility across the finished app.
**Dependencies:** App Foundation, Local Data and Case Shelf, Evidence Capture, Case Board, Connections and Provenance, Case Closure, Recall Mode, Search Tags and Filters, Backup and Restore, Optional OCR, First-Run Demo and Hints
**Priority:** Must

---

## 2. User Stories

| ID | Persona | Priority |
|----|---------|----------|
| A11Y-US-01 | Keyboard-only student | Must |
| A11Y-US-02 | Student on a phone | Must |
| A11Y-US-03 | Student sensitive to motion | Must |

```forge-requirement
{"id":"A11Y-US-01","kind":"story","text":"As a keyboard-only student, I want to finish every non-spatial task without touching the canvas so that I can use the app on a laptop or with assistive tech."}
```

```forge-requirement
{"id":"A11Y-US-02","kind":"story","text":"As a student on a phone, I want to capture, search, and review without pinch-zooming the page so that the app is usable between lectures."}
```

```forge-requirement
{"id":"A11Y-US-03","kind":"story","text":"As a student sensitive to motion, I want pins and strings to stay still so that the board does not make me dizzy."}
```

---

## 3. Functional Requirements

```forge-requirement
{"id":"A11Y-FR-01","kind":"requirement","text":"Meet WCAG 2.2 AA on all primary screens: 4.5:1 body and control contrast, 3:1 large headings, 44x44 CSS pixel targets, visible focus, semantic landmarks, announced errors, and no keyboard traps."}
```

```forge-requirement
{"id":"A11Y-FR-02","kind":"requirement","text":"Complete the keyboard list and detail path for card CRUD, connection CRUD, source attach, search and filters, recall entry, check, reset, and exit, with shortcuts documented in Settings."}
```

```forge-requirement
{"id":"A11Y-FR-03","kind":"requirement","text":"Provide responsive layouts for 1280x800 tablet landscape, 390x844 phone, and 1440x900 desktop, with safe-area insets, phone sheets, no page-level horizontal scrolling, and full capability preserved."}
```

```forge-requirement
{"id":"A11Y-FR-04","kind":"requirement","text":"Honor prefers-reduced-motion and an in-app motion toggle that disables pin drops, string draw animation, auto-pan, and non-essential transitions; persist the choice."}
```

```forge-requirement
{"id":"A11Y-FR-05","kind":"requirement","text":"Pass automated axe scans with zero serious or critical violations on shelf, board, card detail, recall, search, and settings, and document any deliberate exclusions."}
```

```forge-requirement
{"id":"A11Y-FR-06","kind":"requirement","text":"Give the canvas an accessible title, description, and keyboard-operable text alternative for its contents, without claiming full spatial screen-reader parity."}
```

```forge-requirement
{"id":"A11Y-FR-07","kind":"requirement","text":"Meet performance budgets: board pan and zoom at 45 frames per second or better at 150 cards on the target tablet, initial app JavaScript at or below 300 KB gzip excluding lazy board and OCR chunks, and cold load at or below 3 seconds on a 20 Mbps tablet profile."}
```

```forge-requirement
{"id":"A11Y-FR-08","kind":"requirement","text":"Show a non-blocking notice when required browser APIs are missing, and smoke-test the primary routes in current Chromium, Firefox, and WebKit without a crash."}
```

```forge-requirement
{"id":"A11Y-CON-01","kind":"constraint","text":"Spatial placement, canvas panning, and scratch drawing remain pointer-only; do not claim or attempt full keyboard placement in v1."}
```

```forge-requirement
{"id":"A11Y-CON-02","kind":"constraint","text":"When reduced motion is active, no pin drop, string draw, auto-pan, page transition, or pulsing indicator animates."}
```

```forge-requirement
{"id":"A11Y-CON-03","kind":"constraint","text":"Focus is never removed without being restored to a logical trigger; dialogs, sheets, and popovers trap focus only while open."}
```

---

## 4. UI / Interaction Design

- Breakpoints: phone below 600px, tablet 600–1199px, desktop 1200px and up. The primary design target is 1280x800 landscape. Phone keeps every capability but turns side panels into bottom sheets and collapses the board toolbar to one trigger.
- Safe-area insets are applied to the top bar, bottom toolbar, and sheets so notched phones do not hide controls. No screen uses a fixed width that causes page-level horizontal scrolling; the board itself pans inside its own viewport.
- The keyboard path is a first-class route set, not a hidden accessibility mode: Case list, Card detail, Connection picker, Search, Recall. Shortcuts include `?` for help, `/` for search, `[`/`]` for previous/next card, `c` to connect, and `Escape` to close.
- A `Keyboard shortcuts` panel in Settings lists every shortcut and a short description. A `Skip to case content` link is present on every case screen.
- The canvas has `role="img"` or an equivalent labeled region with a description such as `Case board with 24 cards arranged spatially. Use the card list for a keyboard-operable view.` A visible `Open card list` action sits next to the board controls.
- The motion toggle is in Settings under Appearance. It defaults to the system preference and persists an explicit override. Changing it applies immediately without reload.
- Browser notice: if IndexedDB, Web Workers, WebAssembly, or service workers are missing, a non-blocking top banner explains which feature is reduced and links to the support matrix. The app still renders the shelf and any available data.
- Performance: the board culls, uses thumbnails first, caps resident textures, and reports a development-only frame summary. The automated harness seeds 150 cards, pans for five seconds, and records p95 frame time and average FPS.

---

## 5. Task Plan

| ID | Observable outcome | Owner | Key outputs | Check | Exclusions |
|----|--------------------|-------|-------------|-------|------------|
| A11Y-1 | Tablet, phone, and desktop layouts with no page overflow | ui-engineer | Responsive CSS and screen adjustments, tests | Component and Playwright viewport tests | No keyboard path |
| A11Y-2 | Complete keyboard non-spatial journey and canvas alternative | ui-engineer | Shortcuts, focus helpers, screen wiring, tests | Component and Playwright keyboard journey | No spatial editing |
| A11Y-3 | Contrast, target, and motion compliance | ui-engineer | Token/base fixes, motion setting, tests | Contrast, target, motion tests | No axe suite |
| A11Y-4 | Zero serious/critical axe findings | qa-engineer | Axe config, six-screen scan | Playwright axe | No manual audit |
| A11Y-5 | Performance budgets measured and enforced | qa-engineer | Perf harness, 150-card seed, budget script, doc | Playwright performance and budget check | No bundle precache budget |
| A11Y-6 | Browser notice and cross-browser smoke | qa-engineer | Notice, projects, smoke spec, tests | Playwright cross-browser | No new features |

---

## 6. Implementation Tasks

### Phase 1: Layout, keyboard, and motion

```forge-task
{
  "id": "A11Y-1",
  "title": "Harden tablet, phone, and desktop layouts",
  "description": "Add responsive.css and adjust AppShell, CaseShelf, CaseBoardPage, CardDetailPage, RecallPage, SearchPanel, and SettingsPage for phone below 600px, tablet 600–1199px, and desktop 1200px and up. Use bottom sheets on phone, safe-area insets, a compact board toolbar, and layouts that never cause page-level horizontal scrolling. Preserve every capability at 390x844. Add component and Playwright viewport tests for 390x844, 768x1024, 1280x800, and 1440x900, including sheet open/close and 44px controls. Do not add keyboard shortcuts or axe scans.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "DEMO-3",
    "OCR-3",
    "BACKUP-4"
  ],
  "expectedOutputs": [
    "src/styles/responsive.css",
    "src/app/AppShell.tsx",
    "src/app/AppShell.css",
    "src/features/shelf/CaseShelf.tsx",
    "src/features/case/CaseBoardPage.tsx",
    "src/features/cards/CardDetailPage.tsx",
    "src/features/recall/RecallPage.tsx",
    "src/features/search/SearchPanel.tsx",
    "src/features/settings/SettingsPage.tsx",
    "tests/a11y/responsive.test.tsx",
    "e2e/responsive.spec.ts"
  ],
  "validationCommands": [
    "npm test -- tests/a11y/responsive.test.tsx",
    "npm run test:e2e -- e2e/responsive.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/responsive-and-accessibility-hardening.md#A11Y-FR-03",
      "docs/PRD.md#VIS-FR-02"
    ],
    "acceptanceCriteria": [
      "All primary screens render at 390x844, 768x1024, 1280x800, and 1440x900 with no page-level horizontal scroll",
      "Phone side panels become accessible sheets and every capability remains reachable",
      "Safe-area padding is present on top and bottom fixed elements",
      "Board controls and sheet actions meet the 44px target",
      "The Playwright test fails on horizontal overflow or an unreachable primary action"
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

```forge-task
{
  "id": "A11Y-2",
  "title": "Complete the keyboard path and canvas text alternative",
  "description": "Create KeyboardShortcuts and focus helpers. Mount KeyboardShortcuts in AppShell. Wire keyboard operation through CardListPanel, ConnectionPicker, RecallToolbar, SearchPanel, and SettingsPage so card CRUD, provenance attach, connection CRUD, search, and recall entry/check/reset/exit work without the canvas. Add shortcuts ? for help, / for search, [ and ] for previous/next card, c to connect, and Escape to close. Give the canvas an accessible name and description plus a visible Open card list action. Add component tests and a Playwright keyboard-only journey across the non-spatial tasks. Do not add spatial keyboard placement.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "A11Y-1"
  ],
  "expectedOutputs": [
    "src/app/KeyboardShortcuts.tsx",
    "src/app/focus.ts",
    "src/app/AppShell.tsx",
    "src/features/case/CardListPanel.tsx",
    "src/features/connections/ConnectionPicker.tsx",
    "src/features/recall/RecallToolbar.tsx",
    "src/features/search/SearchPanel.tsx",
    "src/features/settings/SettingsPage.tsx",
    "tests/a11y/keyboard.test.tsx",
    "e2e/keyboard-journey.spec.ts"
  ],
  "validationCommands": [
    "npm test -- tests/a11y/keyboard.test.tsx",
    "npm run test:e2e -- e2e/keyboard-journey.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/responsive-and-accessibility-hardening.md#A11Y-FR-02",
      "docs/features/responsive-and-accessibility-hardening.md#A11Y-FR-06"
    ],
    "acceptanceCriteria": [
      "The keyboard journey creates a card, edits it, attaches provenance, creates and retypes an association, searches, enters recall, checks, resets, and exits",
      "AppShell mounts KeyboardShortcuts so the shortcut listener is active on every route",
      "Every shortcut is listed in Settings and does not fire while typing in an input",
      "Focus is visible, logical, and restored after dialogs and sheets close",
      "The canvas exposes a name, description, and visible Open card list action",
      "No keyboard trap exists on any primary screen"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/responsive-and-accessibility-hardening.md#A11Y-CON-01",
      "docs/features/responsive-and-accessibility-hardening.md#A11Y-CON-03",
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
  "id": "A11Y-3",
  "title": "Enforce contrast, target sizes, and reduced-motion behavior",
  "description": "Audit and update tokens.css, base.css, and SettingsPage. Add an Appearance motion toggle that defaults to prefers-reduced-motion, persists an explicit override, and applies immediately. Remove pin drop, string draw, auto-pan, page transition, and pulsing animations when reduced motion is active. Add tests that compute contrast for all semantic text/background pairs, audit interactive target sizes in component fixtures, and assert the motion setting disables animation classes and auto-pan. Do not add axe scans or performance tests.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "A11Y-2"
  ],
  "expectedOutputs": [
    "src/styles/tokens.css",
    "src/styles/base.css",
    "src/features/settings/SettingsPage.tsx",
    "tests/a11y/contrast.test.ts",
    "tests/a11y/targets.test.ts",
    "tests/a11y/reducedMotion.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/a11y/contrast.test.ts tests/a11y/targets.test.ts tests/a11y/reducedMotion.test.tsx",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/responsive-and-accessibility-hardening.md#A11Y-FR-01",
      "docs/features/responsive-and-accessibility-hardening.md#A11Y-FR-04",
      "docs/PRD.md#VIS-FR-03"
    ],
    "acceptanceCriteria": [
      "Every semantic body/control text pair is at least 4.5:1 and large headings at least 3:1",
      "Every interactive fixture is at least 44x44 CSS pixels or has an equivalent expanded hit area",
      "The motion toggle persists, follows the system default until overridden, and applies without reload",
      "Reduced motion removes all required animation classes and disables auto-pan",
      "Focus rings remain visible in both themes and on all surfaces"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/responsive-and-accessibility-hardening.md#A11Y-CON-02",
      "docs/PRD.md#VIS-CON-08"
    ],
    "references": [
      "docs/PRD.md#9. Accessibility"
    ]
  }
}
```

### Phase 2: Automated audits

```forge-task
{
  "id": "A11Y-4",
  "title": "Add axe scans for every primary screen",
  "description": "Create a shared axe configuration and a Playwright spec that seeds a demo case and scans the shelf, board, card detail, recall, search, and settings screens at desktop and tablet viewports. Fail on any serious or critical violation. Document deliberate exclusions such as canvas pixel content, not surrounding controls. The scan must include open dialogs and sheets, not only the base page. Do not add performance checks.",
  "ownerAgent": "qa-engineer",
  "dependencies": [
    "A11Y-3"
  ],
  "expectedOutputs": [
    "tests/a11y/axeConfig.ts",
    "e2e/a11y.spec.ts"
  ],
  "validationCommands": [
    "npm run test:e2e -- e2e/a11y.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/responsive-and-accessibility-hardening.md#A11Y-FR-05"
    ],
    "acceptanceCriteria": [
      "Axe runs on shelf, board, card detail, recall, search, and settings at desktop and tablet",
      "Open dialogs and sheets are scanned, not only the base page",
      "Zero serious or critical violations are allowed",
      "Any exclusion is documented with a reason and does not cover interactive controls",
      "The spec fails if a named screen is not reached"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/PRD.md#VIS-CON-15"
    ],
    "references": [
      "docs/PRD.md#9. Accessibility"
    ]
  }
}
```

```forge-task
{
  "id": "A11Y-5",
  "title": "Measure board performance and enforce the initial JavaScript budget",
  "description": "Add e2e/helpers/seedLargeCase.ts to insert a 150-card synthetic case through the app's IndexedDB schema, e2e/performance.spec.ts to pan and zoom for five seconds and record average FPS and p95 frame time, scripts/perf-budget.mjs to read the Vite manifest and fail when initial entry plus shared chunks exceed 300 KB gzip excluding board and OCR chunks, and docs/quality/performance-budget.md to state the budgets and measurement method. The CI floor is 30 FPS for headless software rendering; the 45 FPS target is verified on the target tablet in the final human review. Fail the performance spec if the board does not become interactive or the 30 FPS floor is missed. Do not add bundle precache checks.",
  "ownerAgent": "qa-engineer",
  "dependencies": [
    "A11Y-4"
  ],
  "expectedOutputs": [
    "e2e/helpers/seedLargeCase.ts",
    "e2e/performance.spec.ts",
    "scripts/perf-budget.mjs",
    "tests/a11y/perfBudget.test.ts",
    "docs/quality/performance-budget.md",
    "vite.config.ts"
  ],
  "validationCommands": [
    "npm test -- tests/a11y/perfBudget.test.ts",
    "npm run build && node scripts/perf-budget.mjs",
    "npm run test:e2e -- e2e/performance.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/responsive-and-accessibility-hardening.md#A11Y-FR-07",
      "docs/PRD.md#VIS-FR-04"
    ],
    "acceptanceCriteria": [
      "The 150-card fixture opens the board and completes a five-second scripted pan",
      "The performance spec records average FPS and p95 frame time and fails below the documented CI floor or above the p95 ceiling",
      "The bundle script fails when initial JavaScript exceeds 300 KB gzip excluding lazy board and OCR chunks",
      "docs/quality/performance-budget.md states the 45 FPS tablet target, 30 FPS CI floor, 300 KB budget, and 3-second cold-load profile",
      "The 45 FPS target is explicitly deferred to the final human tablet review"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/PRD.md#VIS-CON-08"
    ],
    "references": [
      "docs/PRD.md#7. Non-Functional Requirements"
    ]
  }
}
```

```forge-task
{
  "id": "A11Y-6",
  "title": "Add browser capability notice and cross-browser smoke paths",
  "description": "Create BrowserNotice and a supportsCoreApis helper for IndexedDB, Web Workers, WebAssembly, and service workers. Mount it in App.tsx as a non-blocking banner that names the reduced capability and links to the support matrix in README. Add firefox and webkit projects to playwright.config.ts alongside the existing Chromium projects. Add e2e/compat.spec.ts to smoke the shelf, demo case, board, search, and settings in Chromium, Firefox, and WebKit without a crash. Add component tests for each missing API and the no-warning path. Do not add new product features.",
  "ownerAgent": "qa-engineer",
  "dependencies": [
    "A11Y-5"
  ],
  "expectedOutputs": [
    "src/app/BrowserNotice.tsx",
    "src/app/App.tsx",
    "playwright.config.ts",
    "e2e/compat.spec.ts",
    "tests/app/BrowserNotice.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/app/BrowserNotice.test.tsx",
    "npx playwright install firefox webkit",
    "npm run test:e2e -- e2e/compat.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/responsive-and-accessibility-hardening.md#A11Y-FR-08"
    ],
    "acceptanceCriteria": [
      "Each missing API produces a specific non-blocking notice and the shelf still renders",
      "A supported browser shows no notice",
      "Chromium, Firefox, and WebKit smoke the shelf, demo case, board, search, and settings without an unhandled error",
      "The notice links to a support matrix and is dismissible for the session"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/PRD.md#VIS-CON-06"
    ],
    "references": [
      "docs/PRD.md#7. Non-Functional Requirements"
    ]
  }
}
```

---

## 7. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | Contrast calculations, target sizes, motion state, bundle budget parser | Vitest with token fixtures and synthetic manifests |
| Component | Responsive sheets, keyboard flow, browser notice, motion toggle | React Testing Library with viewport mocks |
| Browser | Viewport matrix, keyboard journey, axe, performance, Chromium/Firefox/WebKit smoke | Playwright projects |
| Human | Tablet readability, 45 FPS, screen-reader spot check | Final acceptance review |

Key scenarios:

1. No primary screen horizontally scrolls at 390, 768, 1280, or 1440.
2. The keyboard journey completes every non-spatial task.
3. Axe finds zero serious/critical issues across six screens.
4. The 150-card board meets the CI floor and the initial JS budget.
5. A missing API shows a notice instead of a blank screen.

---

## 8. Acceptance Criteria

1. WCAG 2.2 AA checks pass for contrast, targets, focus, labels, and keyboard operation.
2. The keyboard path covers all non-spatial work and is documented in Settings.
3. Tablet, phone, and desktop layouts preserve capability with no page overflow.
4. Reduced motion is honored by default and by an explicit toggle.
5. Axe, performance, bundle, and cross-browser checks pass with documented limits.

---

## 9. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Is 30 FPS an acceptable CI floor? | Yes for headless software rendering; the real 45 FPS gate is the tablet human review. |
| 2 | Should Firefox and WebKit be required for every CI run? | Smoke only, not the full journey matrix, to keep CI time bounded. |
| 3 | Should the motion toggle be per case? | No; one install-level setting. |
