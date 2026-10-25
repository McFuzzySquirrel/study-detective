# Project Progress

## Current State
**Phase**: LOCAL-DATA-AND-CASE-SHELF-1
**Status**: In Progress
**Last Updated**: 2026-10-25T20:08:18.227Z
**Run ID**: d2be3a1e-ee48-4d3b-aa16-87811c2b0532
**Harness**: opencode
**Execution Mode**: auto

## Completed Tasks
- [x] Phase APP-FOUNDATION-1, Task FND-1: Scaffold the React and TypeScript PWA toolchain (@foundation-engineer)
  - Files: package.json, package-lock.json, .nvmrc, index.html, vite.config.ts, tsconfig.json, tsconfig.app.json, tsconfig.node.json, eslint.config.js, vitest.config.ts, playwright.config.ts, src/main.tsx, src/App.tsx, src/vite-env.d.ts, src/styles/base.css, tests/setup.ts, tests/app/smoke.test.tsx, .gitignore, .prettierignore, e2e/smoke.spec.ts
- [x] Phase APP-FOUNDATION-1, Task FND-2: Add installable PWA manifest, icons, and update prompt (@foundation-engineer)
  - Files: vite.config.ts, src/pwaManifest.ts, src/pwa.ts, src/main.tsx, src/App.tsx, src/app/UpdatePrompt.tsx, src/app/UpdatePrompt.css, public/icons/icon.svg, public/icons/icon-192.png, public/icons/icon-512.png, public/icons/maskable-512.png, scripts/generate-icons.mjs, tests/pwa/manifest.test.ts, tests/pwa/UpdatePrompt.test.tsx, src/vite-env.d.ts, vitest.config.ts, tests/stubs/pwa-register.ts
- [x] Phase APP-FOUNDATION-1, Task FND-3: Build the hash-routed shell with error and offline states (@foundation-engineer)
  - Files: src/App.tsx, src/app/AppShell.tsx, src/app/AppShell.css, src/app/routes.tsx, src/app/placeholders.tsx, src/app/ErrorBoundary.tsx, src/app/OfflineNotice.tsx, tests/app/routing.test.tsx, tests/app/ErrorBoundary.test.tsx, tests/app/OfflineNotice.test.tsx, tests/app/smoke.test.tsx
- [x] Phase APP-FOUNDATION-2, Task FND-4: Build the standalone visual-direction style tile (@ui-engineer)
  - Files: prototype/style-tile.html, prototype/style-tile.css, e2e/style-tile.spec.ts, tsconfig.node.json
- [x] Phase APP-FOUNDATION-2, Task FND-HR-1: Review and record the visual direction
  - Files: docs/reviews/style-direction.json
- [x] Phase APP-FOUNDATION-3, Task FND-5: Implement theme tokens and accessible shared primitives (@ui-engineer)
  - Files: src/styles/tokens.css, src/styles/base.css, src/components/Button.tsx, src/components/IconButton.tsx, src/components/Dialog.tsx, src/components/Toast.tsx, src/components/Field.tsx, src/components/EmptyState.tsx, src/components/components.css, tests/components/primitives.test.tsx, tests/styles/tokens.test.ts, package-lock.json, package.json, src/app/AppShell.css, src/app/UpdatePrompt.css, tests/helpers/css-contract.ts
- [x] Phase LOCAL-DATA-AND-CASE-SHELF-1, Task DATA-1: Define validated case domain records (@data-engineer)
  - Files: src/domain/model.ts, src/domain/validation.ts, src/domain/ids.ts, tests/domain/model.test.ts, tests/domain/validation.test.ts

## Current Task
- None currently running

## Remaining
- [ ] Phase LOCAL-DATA-AND-CASE-SHELF-1: Phase 1: Domain and persistence foundation
- [ ] Phase LOCAL-DATA-AND-CASE-SHELF-2: Phase 2: Shelf and storage safety
- [ ] Phase EVIDENCE-CAPTURE-1: Phase 1: Image pipeline
- [ ] Phase EVIDENCE-CAPTURE-2: Phase 2: Capture and card detail
- [ ] Phase CASE-BOARD-1: Phase 1: Canvas and placement
- [ ] Phase CASE-BOARD-2: Phase 2: Scale and non-spatial path
- [ ] Phase CONNECTIONS-AND-PROVENANCE-1: Phase 1: Graph rules and rendering
- [ ] Phase CONNECTIONS-AND-PROVENANCE-2: Phase 2: Drawing and editing
- [ ] Phase CONNECTIONS-AND-PROVENANCE-3: Phase 3: Keyboard path and feel review
- [ ] Phase CASE-CLOSURE-1: Phase 1: Derived rules
- [ ] Phase CASE-CLOSURE-2: Phase 2: Closure UI and lifecycle
- [ ] Phase RECALL-MODE-1: Phase 1: Non-persistent recall logic
- [ ] Phase RECALL-MODE-2: Phase 2: Recall experience
- [ ] Phase SEARCH-TAGS-AND-FILTERS-1: Phase 1: Tags
- [ ] Phase SEARCH-TAGS-AND-FILTERS-2: Phase 2: Search and filters
- [ ] Phase SEARCH-TAGS-AND-FILTERS-3: Phase 3: Browser verification
- [ ] Phase BACKUP-AND-RESTORE-1: Phase 1: Archive format and export
- [ ] Phase BACKUP-AND-RESTORE-2: Phase 2: Import and restore
- [ ] Phase BACKUP-AND-RESTORE-3: Phase 3: UI and browser journey
- [ ] Phase OPTIONAL-OCR-1: Phase 1: Engine and assets
- [ ] Phase OPTIONAL-OCR-2: Phase 2: OCR experience
- [ ] Phase OPTIONAL-OCR-3: Phase 3: Search and backup integration
- [ ] Phase FIRST-RUN-DEMO-AND-HINTS-1: Phase 1: Demo content and seeding
- [ ] Phase FIRST-RUN-DEMO-AND-HINTS-2: Phase 2: Hints
- [ ] Phase FIRST-RUN-DEMO-AND-HINTS-3: Phase 3: First-run integration
- [ ] Phase RESPONSIVE-AND-ACCESSIBILITY-HARDENING-1: Phase 1: Layout, keyboard, and motion
- [ ] Phase RESPONSIVE-AND-ACCESSIBILITY-HARDENING-2: Phase 2: Automated audits
- [ ] Phase RELEASE-AND-FIELD-REVIEW-1: Phase 1: CI and deployment
- [ ] Phase RELEASE-AND-FIELD-REVIEW-2: Phase 2: Offline release verification
- [ ] Phase RELEASE-AND-FIELD-REVIEW-3: Phase 3: Documentation and human gate

## Blockers
- None

## Validation Gaps
- None reported

## Notes
- Workflow engine run d2be3a1e-ee48-4d3b-aa16-87811c2b0532
- Harness: opencode
