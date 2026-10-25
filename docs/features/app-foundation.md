# Feature: App Foundation

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| FND-FR-01 | This feature | owns |
| FND-FR-02 | This feature | owns |
| FND-FR-03 | This feature | owns |
| FND-FR-04 | This feature | owns |
| FND-FR-05 | This feature | owns |
| VIS-FR-01 | [Vision](../PRD.md) | participates |
| VIS-FR-03 | [Vision](../PRD.md) | participates |
| VIS-CON-05 | [Vision](../PRD.md) | participates |
| VIS-CON-07 | [Vision](../PRD.md) | participates |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** App Foundation
**ID Prefix:** FND
**Summary:** Creates the runnable React/TypeScript PWA, the installable shell, the visual-direction prototype and review gate, and the shared theme and accessible primitives every later feature uses.
**Dependencies:** None
**Priority:** Must

---

## 2. User Stories

| ID | Persona | Priority |
|----|---------|----------|
| FND-US-01 | Exam-focused university student | Must |
| FND-US-02 | Returning reviser | Must |

```forge-requirement
{"id":"FND-US-01","kind":"story","text":"As a student, I want the app to open quickly and install on my tablet so that revision starts without a browser detour."}
```

```forge-requirement
{"id":"FND-US-02","kind":"story","text":"As a returning reviser, I want the same readable frame and controls every session so that the interface disappears behind the notes."}
```

---

## 3. Functional Requirements

```forge-requirement
{"id":"FND-FR-01","kind":"requirement","text":"Boot a React 19 and TypeScript single-page app with hash routes for the shelf, case board, capture, recall, settings, and a not-found screen; lazy-load every feature screen behind the composition root."}
```

```forge-requirement
{"id":"FND-FR-02","kind":"requirement","text":"Provide an installable PWA manifest with 192px, 512px, and maskable icons, an app-shell service worker, and an explicit update prompt that never activates a new version during an unsaved edit."}
```

```forge-requirement
{"id":"FND-FR-03","kind":"requirement","text":"Implement semantic design tokens for the cork, sepia, and oxblood theme with period typography limited to headings and case-file chrome, AA contrast for body and controls, and reduced-motion alternatives."}
```

```forge-requirement
{"id":"FND-FR-04","kind":"requirement","text":"Ship shared accessible primitives for Button, IconButton, Dialog, Toast, Field, and EmptyState with 44x44 CSS pixel targets, visible focus rings, focus restoration, and live-region announcements."}
```

```forge-requirement
{"id":"FND-FR-05","kind":"requirement","text":"Provide a top-level error boundary, an offline notice, and a recovery action that keeps the app usable when a route, storage read, or service worker update fails."}
```

```forge-requirement
{"id":"FND-CON-01","kind":"constraint","text":"Only the lazy board chunk may import pixi.js; the app shell must not include PixiJS in its initial JavaScript payload."}
```

```forge-requirement
{"id":"FND-CON-02","kind":"constraint","text":"Components use semantic CSS custom properties for color, spacing, type, radius, and motion; no hard-coded palette values in component files."}
```

```forge-requirement
{"id":"FND-CON-03","kind":"constraint","text":"Every feature route is lazy-loaded and wrapped by a route-level error boundary; an unknown route renders a recoverable not-found screen."}
```

---

## 4. UI / Interaction Design

- `src/main.tsx` mounts `src/App.tsx` in React strict mode. `App.tsx` owns `HashRouter`, the error boundary, `AppBootstrap`, and the route table.
- The shell is a thin case-file frame: a compact top bar with the product mark and a contextual back action, a content region, and a status strip for storage and offline state. On phone widths the top bar collapses into one row and secondary actions move into a sheet.
- The visual-direction prototype is a standalone HTML page with three clearly labeled direction tiles. Each tile shows a cork surface, three pin styles, a red association string, a dashed amber provenance string, heading/body type pairings, and one 44px control. No external fonts or images are allowed; the page must work from `file://`.
- The prototype is a decision aid, not the app. The human review records the chosen direction, reference games, and any pin/string adjustments in `docs/reviews/style-direction.json`; only then are tokens locked.
- Theme rules: period faces are limited to headings and case-file chrome; body text, menus, inputs, and toasts use a highly legible system UI stack. Motion is short and optional; reduced motion removes pin drops, string draw animation, and auto-pan.
- The update prompt is a non-blocking toast with `Refresh` and `Later` actions. It must not activate while a form has unsaved changes; `Refresh` reloads only after the user confirms.

---

## 5. Task Plan

| ID | Observable outcome | Owner | Key outputs | Check | Exclusions |
|----|--------------------|-------|-------------|-------|------------|
| FND-1 | A clean Vite/React/TS project installs, tests, lints, and builds | foundation-engineer | Toolchain configs, smoke test | Smoke test, typecheck, lint, build | No feature screens, no CI workflow |
| FND-2 | Installable manifest, icons, service worker, update prompt | foundation-engineer | PWA config, icons, update prompt, tests | Manifest test, build | No offline E2E yet |
| FND-3 | Hash-routed shell with placeholders, error boundary, offline notice | foundation-engineer | App, routes, shell, error boundary, tests | Routing and error tests | No real feature screens |
| FND-4 | Three-direction static style tile at tablet and phone sizes | ui-engineer | Prototype HTML/CSS, browser test | Playwright file-URL test | Not the production theme |
| FND-HR-1 | Human-selected visual direction recorded | human reviewer | Review JSON | Design review checklist | Cannot approve later gates |
| FND-5 | Locked tokens and accessible primitives used by the shell | ui-engineer | Tokens, base styles, six primitives, tests | Primitive and contrast tests | No feature-specific components |

---

## 6. Implementation Tasks

### Phase 1: Runnable PWA shell

```forge-task
{
  "id": "FND-1",
  "title": "Scaffold the React and TypeScript PWA toolchain",
  "description": "Create the Vite 8, React 19, and TypeScript 6 project with the dependency versions in PRD section 6.1. Configure hash-routable index.html, strict TypeScript project references, ESLint 10 with typescript-eslint 8, Prettier, Vitest 5 with jsdom, and Playwright 1.64 with desktop, tablet-landscape, and phone projects. Add scripts dev, build, preview, lint, typecheck, test, test:coverage, and test:e2e, where test:e2e builds before running Playwright. Render a minimal strict-mode App with a smoke test. Do not add feature screens, the board, PWA registration, or CI workflows.",
  "ownerAgent": "foundation-engineer",
  "dependencies": [],
  "expectedOutputs": [
    "package.json",
    "package-lock.json",
    ".nvmrc",
    "index.html",
    "vite.config.ts",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "eslint.config.js",
    "vitest.config.ts",
    "playwright.config.ts",
    "src/main.tsx",
    "src/App.tsx",
    "src/vite-env.d.ts",
    "src/styles/base.css",
    "tests/setup.ts",
    "tests/app/smoke.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/app/smoke.test.tsx",
    "npm run typecheck",
    "npm run lint",
    "npm run build"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/app-foundation.md#FND-FR-01"
    ],
    "acceptanceCriteria": [
      "The smoke test renders the app with accessible text and no console error",
      "npm run build emits a static dist without TypeScript errors",
      "Vitest runs only tests under tests/ and fails when the named file is missing",
      "Playwright config defines desktop 1440x900, tablet-landscape 1280x800, and phone 390x844 projects"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/app-foundation.md#FND-CON-01"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

```forge-task
{
  "id": "FND-2",
  "title": "Add installable PWA manifest, icons, and update prompt",
  "description": "Configure vite-plugin-pwa in prompt mode with a same-origin manifest, relative start_url and scope, standalone display, any orientation, and 192px, 512px, and maskable 512px PNG icons generated from public/icons/icon.svg by scripts/generate-icons.mjs using sharp. Register the service worker from src/pwa.ts, import it from src/main.tsx, and mount the UpdatePrompt toast from src/App.tsx with Refresh and Later actions. The prompt must call updateServiceWorker(true) only after explicit confirmation. Precache the app shell and allow future wasm and traineddata assets. Do not enable skipWaiting or claim offline verification yet.",
  "ownerAgent": "foundation-engineer",
  "dependencies": [
    "FND-1"
  ],
  "expectedOutputs": [
    "vite.config.ts",
    "src/pwaManifest.ts",
    "src/pwa.ts",
    "src/main.tsx",
    "src/App.tsx",
    "src/app/UpdatePrompt.tsx",
    "src/app/UpdatePrompt.css",
    "public/icons/icon.svg",
    "public/icons/icon-192.png",
    "public/icons/icon-512.png",
    "public/icons/maskable-512.png",
    "scripts/generate-icons.mjs",
    "tests/pwa/manifest.test.ts",
    "tests/pwa/UpdatePrompt.test.tsx"
  ],
  "validationCommands": [
    "node scripts/generate-icons.mjs",
    "npm test -- tests/pwa/manifest.test.ts tests/pwa/UpdatePrompt.test.tsx",
    "npm run build"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/app-foundation.md#FND-FR-02",
      "docs/PRD.md#VIS-FR-01"
    ],
    "acceptanceCriteria": [
      "Manifest tests assert name, short_name, relative start_url and scope, standalone display, theme colors, and 192/512/maskable icons that exist on disk",
      "The service worker is registered with registerType prompt and the update prompt requires a user action",
      "src/main.tsx imports the PWA registration and src/App.tsx mounts UpdatePrompt so the prompt is reachable",
      "The generate-icons script produces three non-empty PNG files from the SVG source",
      "No runtime asset in the manifest points to a third-party origin"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/PRD.md#VIS-CON-07"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

```forge-task
{
  "id": "FND-3",
  "title": "Build the hash-routed shell with error and offline states",
  "description": "Replace the placeholder App with HashRouter and a lazy route table for /, /case/:caseId, /case/:caseId/capture, /case/:caseId/recall, /settings, and *. Export AppRoutes so tests can use MemoryRouter. Add AppShell with a compact top bar, content region, storage/offline status slot, an ErrorBoundary that logs no user content and offers Reload and Back to shelf, an OfflineNotice bound to online/offline events, and a recoverable not-found screen. Until later features land, the four screens render clearly labeled placeholders from src/app/placeholders.tsx. Do not implement data loading or feature UI.",
  "ownerAgent": "foundation-engineer",
  "dependencies": [
    "FND-1"
  ],
  "expectedOutputs": [
    "src/App.tsx",
    "src/app/AppShell.tsx",
    "src/app/AppShell.css",
    "src/app/routes.tsx",
    "src/app/placeholders.tsx",
    "src/app/ErrorBoundary.tsx",
    "src/app/OfflineNotice.tsx",
    "tests/app/routing.test.tsx",
    "tests/app/ErrorBoundary.test.tsx",
    "tests/app/OfflineNotice.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/app/routing.test.tsx tests/app/ErrorBoundary.test.tsx tests/app/OfflineNotice.test.tsx",
    "npm run typecheck",
    "npm run build"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/app-foundation.md#FND-FR-01",
      "docs/features/app-foundation.md#FND-FR-05"
    ],
    "acceptanceCriteria": [
      "Each named hash route renders its lazy placeholder and an unknown route renders a not-found action back to the shelf",
      "A thrown route error is caught by the boundary and offers Reload and Back to shelf without exposing a stack trace",
      "The offline notice appears on an offline event and clears on online",
      "The shell has one main landmark, a skip link, and visible focus on the first control"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/app-foundation.md#FND-CON-03",
      "docs/PRD.md#VIS-CON-15"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture",
      "docs/PRD.md#9. Accessibility"
    ]
  }
}
```

### Phase 2: Visual direction

```forge-task
{
  "id": "FND-4",
  "title": "Build the standalone visual-direction style tile",
  "description": "Create prototype/style-tile.html and prototype/style-tile.css as a dependency-free, file-URL-openable page with three labeled directions. Each direction shows a cork surface, three pin styles, a red association string, a dashed amber provenance string, a period heading over system body text, and one 44px control. Include a short legend explaining what the reviewer should judge. Use only local CSS, inline SVG, and system or bundled font stacks; no network requests, external images, or external fonts. Add a Playwright test that opens the file URL and asserts the three directions, both string types, the type samples, and no horizontal overflow at 1280x800 and 390x844.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "FND-1"
  ],
  "expectedOutputs": [
    "prototype/style-tile.html",
    "prototype/style-tile.css",
    "e2e/style-tile.spec.ts"
  ],
  "validationCommands": [
    "npm run test:e2e -- e2e/style-tile.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/app-foundation.md#FND-FR-03"
    ],
    "acceptanceCriteria": [
      "Three visually distinct directions are labeled and each contains all required elements",
      "The page loads from file:// with zero network requests",
      "The layout has no horizontal page overflow at 1280x800 or 390x844",
      "The test fails if a direction, pin, string type, type sample, or 44px control is missing"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/PRD.md#VIS-CON-08"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture",
      "docs/PRD.md#9. Accessibility"
    ]
  }
}
```

```forge-task
{
  "id": "FND-HR-1",
  "title": "Review and record the visual direction",
  "description": "Open prototype/style-tile.html at 1280x800 and 390x844. Compare all three directions against the product intent, check body and control contrast with a contrast checker, verify the 44px control, and choose one direction. Record the chosen direction, named reference games, pin style, string weight and sag, heading/body type choices, rejected alternatives, device used, and any required changes. This is a design decision gate only; it does not approve any implementation task or later release.",
  "dependencies": [
    "FND-4"
  ],
  "expectedOutputs": [],
  "validationCommands": [],
  "contract": {
    "version": 2,
    "kind": "human-review",
    "requirements": [],
    "requirementRefs": [
      "docs/features/app-foundation.md#FND-FR-03"
    ],
    "acceptanceCriteria": [
      "All three directions were viewed at both required viewports",
      "Contrast and 44px target checks were performed and recorded",
      "One direction and named reference games are recorded with concrete pin, string, and type decisions",
      "The notes state what was exercised and any rejected alternative"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/app-foundation.md#FND-CON-02",
      "docs/PRD.md#VIS-CON-08"
    ],
    "references": [
      "docs/features/app-foundation.md#FND-FR-03",
      "docs/PRD.md#9. Accessibility"
    ],
    "reviewFile": "docs/reviews/style-direction.json"
  }
}
```

### Phase 3: Design system

```forge-task
{
  "id": "FND-5",
  "title": "Implement theme tokens and accessible shared primitives",
  "description": "Apply the chosen visual direction as semantic CSS custom properties in src/styles/tokens.css and update base.css. Add Button, IconButton, Dialog, Toast, Field, and EmptyState with variants needed by later features. Enforce 44x44 targets, visible focus rings, dialog focus trapping and restoration, toast aria-live, label and error associations in Field, and reduced-motion fallbacks. Add a token contract test that rejects low-contrast body/control pairs and a component test suite for keyboard and focus behavior. Do not add feature-specific components or Pixi styles.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "FND-3",
    "FND-HR-1"
  ],
  "expectedOutputs": [
    "src/styles/tokens.css",
    "src/styles/base.css",
    "src/components/Button.tsx",
    "src/components/IconButton.tsx",
    "src/components/Dialog.tsx",
    "src/components/Toast.tsx",
    "src/components/Field.tsx",
    "src/components/EmptyState.tsx",
    "src/components/components.css",
    "tests/components/primitives.test.tsx",
    "tests/styles/tokens.test.ts"
  ],
  "validationCommands": [
    "npm test -- tests/components/primitives.test.tsx tests/styles/tokens.test.ts",
    "npm run typecheck",
    "npm run lint"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/app-foundation.md#FND-FR-03",
      "docs/features/app-foundation.md#FND-FR-04",
      "docs/PRD.md#VIS-FR-03"
    ],
    "acceptanceCriteria": [
      "Every primitive has at least one keyboard or focus assertion and a 44x44 target assertion",
      "Dialog traps focus, closes on Escape, and restores focus to the trigger",
      "Toast uses aria-live=polite and exposes an optional action button",
      "Token tests compute body and control contrast at or above 4.5:1 and large-heading contrast at or above 3:1",
      "Reduced-motion media query removes transitions and transforms declared by the primitives",
      "No component file contains a raw hex, rgb, or hsl palette value"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/app-foundation.md#FND-CON-02",
      "docs/PRD.md#VIS-CON-08"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture",
      "docs/PRD.md#9. Accessibility"
    ]
  }
}
```

---

## 7. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | Token contrast, route helpers, icon generation contract | Vitest with parsed CSS tokens and filesystem assertions |
| Component | Shell, error boundary, offline notice, update prompt, primitives | React Testing Library with keyboard and focus assertions |
| Browser | Style tile rendering at two viewports | Playwright file-URL test |
| Human | Visual direction choice | FND-HR-1 checklist with contrast and target checks |

Key scenarios:

1. A fresh install renders the shell, reaches every route, and recovers from an unknown route.
2. A thrown route error shows a recovery action and no stack trace.
3. The update prompt appears only when a new service worker is waiting and acts only on confirmation.
4. Dialog focus is trapped and restored; toast announcements are live.
5. The style tile renders three directions with both string types at tablet and phone sizes.

---

## 8. Acceptance Criteria

1. `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` succeed from a clean checkout.
2. The app installs as a PWA with valid 192/512/maskable icons and a prompt-based update path.
3. Every named route is reachable and lazy-loaded; an unknown route and a thrown error both offer recovery.
4. The chosen visual direction is recorded in `docs/reviews/style-direction.json` before tokens are locked.
5. Shared primitives meet the 44px, focus, announcement, and contrast rules; no component hard-codes palette values.

---

## 9. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Which direction wins? | FND-HR-1 records it; fallback is cork, sepia, oxblood, and period headings only. |
| 2 | Do we need a font file? | Start with a system serif/sans stack; add a bundled display face only if the chosen direction requires it and licensing is clear. |
| 3 | Should the update prompt auto-reload on idle? | No; it always requires a user action. |
