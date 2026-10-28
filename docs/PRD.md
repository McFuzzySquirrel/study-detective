# PRD: Notes Detective

## 1. Overview

**Product Name:** Notes Detective
**Summary:** A solo, local-first exam-revision PWA that turns a student's photographed notes and source material into a detective evidence board. The student pins cards, draws association and provenance strings, closes a case only when its structure is complete, and rehearses the connections from memory in recall mode.
**Target Platform:** Installable Progressive Web App running in current desktop and mobile browsers; tablet landscape is the primary arranging target, phone and desktop are supported.
**Key Constraints:** No accounts, sync, telemetry, AI-generated content, PDF import, or photo annotation. All case data and images stay in IndexedDB on the device. The app must keep working offline after first load.
**Historical Sources:** [docs/IDEA.md](IDEA.md) is the preserved product idea and interview input. It is not an execution source.

---

## 2. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-10-25 | Product interview with project owner | Initial canonical PRD and 13 features |

---

## 3. Goals and Non-Goals

### 3.1 Goals

- Let one student build an exam case from photos they already took, without retyping notes.
- Make the relationships between notes, sources, and topics the primary study object.
- Make recall practice effortless to start and impossible to score or game.
- Survive real exam conditions: offline, on a tablet, across weeks, with an explicit backup path.
- Keep the detective metaphor in the interaction and the frame, never in the way of reading content.

### 3.2 Non-Goals

- Public launch, growth loops, monetization, analytics, or telemetry.
- Accounts, cloud sync, sharing, collaboration, study groups, or classroom features.
- AI-generated cases, quizzes, tags, summaries, or suggested connections.
- PDF import, photo annotation, typed note bodies, multi-image cards, card colors, or string labels.
- Cross-case card reuse, case duplication, or more than one user per install.
- Auto-deletion, archiving, or reminders after an exam date.
- Full spatial keyboard editing or screen-reader equivalence for the canvas.

---

## 4. Personas

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| Exam-focused university student | Primary. Has 1–2 weeks before one exam and a camera roll full of lecture notes. | Fast capture, a board that matches how they think, reliable local storage, a recall check that exposes gaps. |
| High-school student | Secondary. Same product and workflow; no high-school-specific features in v1. | The same case flow with less setup and a clear first-run example. |
| Returning reviser | The same user days later, often offline on a tablet. | Resume exactly where they left off, find a card by title or tag, rehearse without losing the board. |

---

## 5. Research Findings

- The product idea was sharpened through a structured interview and recorded in [docs/IDEA.md](IDEA.md). That document already resolves the main scope questions: solo use, local-first storage, photo-based notes and sources, optional topic images, undirected strings, and no scoring.
- The main unvalidated questions are sensory rather than functional: the exact aesthetic reference, the feel of pins and string sag, and whether handwriting OCR is accurate enough to be useful. The plan treats the first two as human-gated spikes and the third as an optional, user-triggered feature that never overwrites the student's text.
- Browser storage eviction is the largest product risk. The mitigation is explicit, tested backup plus persistent-storage requests, not an assumption that IndexedDB is permanent.
- All technology versions in section 6 were checked against the npm registry on 2026-10-25. TypeScript 7.0.2 is current but is not yet supported by typescript-eslint 8.72.0, so the plan pins TypeScript 6.0.3 and records the constraint.

---

## 6. Technical Architecture

### 6.1 Technology Stack

| Layer | Choice | Version | Rationale |
|-------|--------|---------|-----------|
| UI runtime | React + React DOM | 19.3.1 | Current stable; DOM chrome and forms keep text, focus, and accessibility native. |
| Language | TypeScript | 6.0.3 | Current version supported by the lint toolchain; TypeScript 7 is deferred until typescript-eslint supports it. |
| Build | Vite + `@vitejs/plugin-react` | 8.3.5 + 6.1.2 | Fast static build, lazy chunks, asset URLs for worker/wasm assets. |
| Board renderer | PixiJS | 8.22.0 | Smooth pan, zoom, culling, and 150 photo cards on a tablet; isolated to a lazy board chunk. |
| Routing | React Router (hash) | 7.18.4 | Hash routing works on GitHub Pages without server rewrites. |
| Local database | Dexie over IndexedDB | 4.4.7 | Versioned schema, transactions, compound indexes, Blob storage. |
| UI state | Zustand | 5.0.16 | Small stores for board viewport, dialogs, undo, and recall scratch state. |
| Validation | Zod | 4.6.7 | Runtime validation for persisted records, imports, and backups. |
| Crop/rotate | react-easy-crop | 6.2.4 | Touch-friendly crop and rotation editor with normalized output. |
| ZIP archive | fflate | 0.8.3 | Browser ZIP creation/parsing for case backups. |
| OCR | tesseract.js | 7.0.0 | On-device OCR in a Web Worker with bundled English assets. |
| OCR assets | tesseract.js-core + `@tesseract.js-data/eng` | 7.0.0 + 1.0.0 | Bundled wasm core and English traineddata so OCR works offline with no CDN. |
| PWA | vite-plugin-pwa + Workbox | 2.0.0 + 7.4.1 | Manifest, service worker, precache, update prompt. |
| Unit/component tests | Vitest + React Testing Library | 5.0.5 + 16.3.3 | Vite-native unit tests and accessible component queries. |
| Browser tests | Playwright + axe | 1.64.1 + 4.14.0 | Tablet/phone/desktop viewports, offline checks, accessibility scans. |
| Lint/format | ESLint + typescript-eslint + Prettier | 10.13.0 + 8.72.0 + 3.9.10 | Current lint stack; TypeScript pinned for compatibility. |
| CI/CD | GitHub Actions + GitHub Pages | — | Static HTTPS hosting and installability with no backend. |

### 6.2 Project Structure

```text
src/
  app/          App.tsx composition root, routes, shell, bootstrap, error boundary, focus helpers
  domain/       Case, Card, Connection, Tag, readiness, lifecycle, pure validation
  data/         Dexie schema, repositories, attachment storage, persistence, broadcast sync
  board/        PixiJS scene, viewport, card and string layers, culling, texture cache
  components/   Button, IconButton, Dialog, Toast, Field, EmptyState
  features/     shelf, capture, cards, case, connections, closure, recall, search,
                backup, ocr, demo, onboarding, settings
  styles/       tokens.css, base.css, responsive.css
  pwa.ts        service-worker registration and update flow
tests/          Vitest unit and component tests mirroring src
e2e/            Playwright journeys, viewport projects, accessibility and performance checks
scripts/        icon generation, OCR asset checks, Pages build checks, bundle budgets, doc checks
public/         icons and static assets
docs/           PRD, feature documents, deployment, release, reviews
```

The composition root is `src/main.tsx` → `src/App.tsx`, which mounts `AppBootstrap`, `AppShell`, and `src/app/routes.tsx`. Every feature screen is reachable through that router; the PixiJS board is a lazy route-level chunk.

### 6.3 Key APIs / Interfaces

- `CaseRepository` is the only write boundary for cases, cards, connections, and attachments. React code never opens Dexie directly.
- `AttachmentStore` reads and writes original, display, and thumbnail Blobs by attachment ID and enforces replace/delete cleanup after a successful transaction.
- `BoardScene` owns Pixi objects and reads a plain board snapshot; it never writes storage. Gesture handlers emit intents to the board store.
- `compareConnections(truth, scratch)` is a pure function used by recall results.
- `computeReadiness(cards, connections)` is a pure function used by closure and badges.
- `exportCase(caseId)` and `importCase(blob, mode)` are the backup boundary; neither touches the network.
- `useOcr` wraps a tesseract.js worker with explicit start, cancel, timeout, and cleanup.

---

## 7. Non-Functional Requirements

| ID | Area | Priority |
|----|------|----------|
| [VIS-FR-01](#VIS-FR-01) | Offline-first local-only PWA | Must |
| [VIS-FR-02](#VIS-FR-02) | Responsive tablet, phone, desktop | Must |
| [VIS-FR-03](#VIS-FR-03) | Accessibility AA floor | Must |
| [VIS-FR-04](#VIS-FR-04) | 150-card scale ceiling | Must |
| [VIS-FR-05](#VIS-FR-05) | Solo use with no telemetry | Must |
| [VIS-FR-06](#VIS-FR-06) | Durable, exportable case data | Must |
| [VIS-CON-01](#VIS-CON-01) | Local-only data and no uploads | Must |
| [VIS-CON-02](#VIS-CON-02) | No accounts, sync, telemetry, analytics | Must |
| [VIS-CON-03](#VIS-CON-03) | No generated content or suggestions | Must |
| [VIS-CON-04](#VIS-CON-04) | Explicit v1 feature exclusions | Must |
| [VIS-CON-05](#VIS-CON-05) | English-only UI | Must |
| [VIS-CON-06](#VIS-CON-06) | Browser support | Must |
| [VIS-CON-07](#VIS-CON-07) | Same-origin runtime assets only | Must |
| [VIS-CON-08](#VIS-CON-08) | Interaction and motion baseline | Must |
| [VIS-CON-09](#VIS-CON-09) | Storage eviction risk | Must |
| [VIS-CON-10](#VIS-CON-10) | No backend | Must |

```forge-requirement
{"id":"VIS-FR-01","kind":"requirement","text":"Deliver one installable, offline-first PWA whose app shell and bundled OCR assets load without a network after the first successful load."}
```

```forge-requirement
{"id":"VIS-FR-02","kind":"requirement","text":"Support a 1280x800 tablet landscape as the primary arranging viewport, a 390x844 phone with full capability, and a 1440x900 desktop without page-level horizontal scrolling."}
```

```forge-requirement
{"id":"VIS-FR-03","kind":"requirement","text":"Meet WCAG 2.2 AA for UI chrome with 44x44 CSS pixel targets, visible focus, semantic labels, and reduced-motion support."}
```

```forge-requirement
{"id":"VIS-FR-04","kind":"requirement","text":"Design and verify the board for 150 cards per case, warn softly at 120 cards and persistently at 150 or more, and never impose a hard cap below 200 cards."}
```

```forge-requirement
{"id":"VIS-FR-05","kind":"requirement","text":"Operate as a solo install with no accounts, collaboration, telemetry, analytics, or third-party runtime calls."}
```

```forge-requirement
{"id":"VIS-FR-06","kind":"requirement","text":"Persist every case, card, connection, tag, position, closure state, and image across reloads and provide explicit per-case export and restore."}
```

```forge-requirement
{"id":"VIS-CON-01","kind":"constraint","text":"All user content remains in IndexedDB on the device; images and OCR results are never uploaded or sent to a third party."}
```

```forge-requirement
{"id":"VIS-CON-02","kind":"constraint","text":"Do not add accounts, cloud sync, collaboration, telemetry, analytics, crash reporting, or advertising SDKs."}
```

```forge-requirement
{"id":"VIS-CON-03","kind":"constraint","text":"Do not generate cases, connections, tags, summaries, quizzes, or suggested links from the student's content; the student supplies all graph meaning and the only seeded content is the explicitly labeled first-run demo case."}
```

```forge-requirement
{"id":"VIS-CON-04","kind":"constraint","text":"V1 excludes PDF import, photo annotation, typed note bodies, multi-image cards, card colors, string labels, cross-case reuse, case duplication, and whole-library export."}
```

```forge-requirement
{"id":"VIS-CON-05","kind":"constraint","text":"Ship English-only UI copy in v1; do not introduce a localization framework."}
```

```forge-requirement
{"id":"VIS-CON-06","kind":"constraint","text":"Support current versions of Chrome, Edge, Firefox, and Safari on desktop, plus current iOS Safari and Android Chrome; show a non-blocking notice for unsupported browsers."}
```

```forge-requirement
{"id":"VIS-CON-07","kind":"constraint","text":"At runtime load only same-origin static assets; bundle OCR worker, wasm, and English traineddata so OCR works offline without a download."}
```

```forge-requirement
{"id":"VIS-CON-08","kind":"constraint","text":"Honor prefers-reduced-motion, keep all touch targets at least 44x44 CSS pixels, and reserve period typography for headings and case-file chrome."}
```

```forge-requirement
{"id":"VIS-CON-09","kind":"constraint","text":"Treat IndexedDB eviction as a live risk: request persistent storage, show usage, prompt for backup, and document that a browser may still evict data."}
```

```forge-requirement
{"id":"VIS-CON-10","kind":"constraint","text":"Do not introduce a backend, server database, authentication service, or cloud function; GitHub Pages serves static files only."}
```

### 7.1 Quality Gates

| Gate | Command | Pass condition |
|------|---------|----------------|
| Static | `npm run lint`, `npm run typecheck` | Zero errors |
| Unit and component | `npm test`, `npm run test:coverage` | All tests pass; domain and data line coverage at least 85% |
| Browser journeys | `npm run test:e2e` | Playwright journeys pass on the Chromium tablet, phone, and desktop projects |
| Accessibility | `npm run test:e2e -- e2e/a11y.spec.ts` | Zero serious or critical axe findings |
| Performance | `node scripts/perf-budget.mjs`, `npm run test:e2e -- e2e/performance.spec.ts` | Initial JS at or below 300 KB gzip; CI FPS floor met; tablet target verified by human review |
| Offline and install | `npm run test:e2e -- e2e/pwa.spec.ts` | Offline reload, precache, and same-origin request checks pass |
| Human acceptance | `REL-HR-1` | Full journey passes on tablet, phone, and desktop against GitHub Pages |

Tests are authored with the behavior they verify. A build or an exit-zero command alone is not evidence that a test ran; the feature tasks name the exact test files and commands.

---

## 8. Security and Privacy

| ID | Requirement | Priority |
|----|-------------|----------|
| [VIS-CON-01](#VIS-CON-01) | No uploads of notes, images, OCR text, or backups | Must |
| [VIS-CON-02](#VIS-CON-02) | No accounts or telemetry | Must |
| [VIS-CON-11](#VIS-CON-11) | Validate imports and prevent archive path traversal | Must |
| [VIS-CON-12](#VIS-CON-12) | Avoid injection from titles, tags, OCR text, and archive metadata | Must |
| [VIS-CON-13](#VIS-CON-13) | Release user content only by explicit user action | Must |

```forge-requirement
{"id":"VIS-CON-11","kind":"constraint","text":"Validate every imported archive entry, manifest field, checksum, and path before writing; reject absolute paths, traversal, duplicate entries, oversized entries, and unsupported versions."}
```

```forge-requirement
{"id":"VIS-CON-12","kind":"constraint","text":"Render all user-supplied and imported text as text, never as HTML; do not use dangerouslySetInnerHTML for titles, tags, OCR, or manifest content."}
```

```forge-requirement
{"id":"VIS-CON-13","kind":"constraint","text":"Write a backup or download a file only after an explicit user action; never auto-export or auto-share."}
```

Supporting decisions:

- No authentication is required because there is no server and no multi-user boundary. Device access is the security boundary.
- The case archive is an unencrypted ZIP. The app warns that it contains private notes and asks the student to store it somewhere they trust. Encryption is a future consideration.
- The app does not log image contents, OCR text, or titles to the console in production.
- Object URLs for images are revoked when a view unmounts or a replacement succeeds.
- GitHub Pages cannot set custom response headers, so the plan does not claim a strict CSP. It does ensure no inline event handlers, no third-party scripts, and same-origin assets only.

---

## 9. Accessibility

| ID | Area | Priority |
|----|------|----------|
| [VIS-FR-03](#VIS-FR-03) | WCAG 2.2 AA floor | Must |
| [VIS-CON-08](#VIS-CON-08) | Targets, focus, motion | Must |
| [VIS-CON-14](#VIS-CON-14) | Keyboard non-spatial parity | Must |
| [VIS-CON-15](#VIS-CON-15) | Canvas alternative | Must |

```forge-requirement
{"id":"VIS-CON-14","kind":"constraint","text":"Every capability that is not spatial arrangement must be reachable by keyboard through the case list and detail path: create, edit, delete, attach provenance, create and retype connections, search, enter recall, and check results."}
```

```forge-requirement
{"id":"VIS-CON-15","kind":"constraint","text":"Expose a canvas title, description, and keyboard-operable text alternative for board contents; do not claim full spatial screen-reader parity or keyboard placement in v1."}
```

The accessibility floor is implemented per feature and audited in the hardening feature. Automated axe checks are necessary but not sufficient; the final human review includes a keyboard and screen-reader spot check.

---

## 10. System States / Lifecycle

### 10.1 Case Lifecycle

```text
(no cases) -> demo seeded once -> open case -> [readiness: ready | loose threads]
                                      |                         |
                                      +---- close (only ready) -+
                                                                 |
                                      closed case <---- reopen ---+
                                      (still editable; readiness recomputed)
```

- A case is `open` or `closed`; `closedAt` is metadata, never a lock.
- Readiness is derived on every read: `ready` when there are zero loose threads, otherwise `loose`.
- A closed case whose edits create loose threads displays `Closed · loose threads` and offers close again after repair; it does not silently reopen.
- Manual reopen clears `closedAt` after confirmation. There is no automatic reopen or archiving.

### 10.2 Board and Recall States

```text
shelf -> board (pan/zoom/edit) -> capture -> board
board -> recall -> draw scratch -> check -> results -> exit (scratch discarded)
board -> export -> file; shelf -> import -> copy (default) | replace (explicit)
```

- Recall state is in memory only. A reload, exit, or route change discards the scratch layer.
- A case's last viewport is restored on return. Recall entry fits the case to view without mutating the stored viewport.

### 10.3 Storage States

- `persistent`: the browser granted persistent storage.
- `best-effort`: the request was denied or unsupported; the UI shows the backup reminder prominently.
- `warning`: usage exceeds 80% of the reported quota.
- `error`: IndexedDB cannot open or a read fails; the shelf shows a recoverable error with Retry and import guidance instead of a silently empty shelf.

---

## 11. Analytics / Success Metrics

The app ships no analytics. Measurement is manual and local.

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Hard gate: one real exam board survives the full cycle | Capture → pin → string → close → recall → export → import → reopen on a real exam | Human acceptance review on deployed GitHub Pages, tablet landscape plus phone and desktop |
| Would the builder choose it over re-reading notes? | Yes, recorded in the final review | Reviewer statement in `docs/reviews/final-acceptance.json` |
| Stretch: 3–5 students build a real case and would reuse it | Post-v1 interview; not a v1 gate | Structured interview notes, never telemetry |
| Board scale | 150 cards usable; soft warning at 120 | Automated 150-card fixture plus human tablet check |
| Accessibility | Zero serious/critical axe findings; keyboard journey passes | Automated axe suite and human keyboard spot check |
| Offline | App shell and OCR work after first load with the network disabled | Playwright offline test and human install check |

---

## 12. Dependencies and Risks

### 12.1 Dependencies

- GitHub repository with Pages enabled for deployment; no other hosted service.
- Node.js 24 LTS and npm in CI; local development uses a current Node runtime.
- Browser support for IndexedDB, Web Workers, WebAssembly, service workers, and `navigator.storage.persist()`; the app degrades with a notice, not a crash.
- Bundled English traineddata and tesseract.js wasm increase the precache size; the release budget accounts for it.
- Human availability for three gates: visual direction, board feel, and final acceptance.

### 12.2 Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Browser evicts IndexedDB | Loss of exam prep | Persistent-storage request, usage display, once-per-case backup prompt, tested export/import, release docs |
| Large images exhaust quota | Import failures mid-case | Default original cap at 4096px, opt-in full resolution, 2048px display and 320px thumbnails, quota warnings |
| PixiJS gesture or WebGL issues on tablets | Board feels broken | Isolated board chunk, pointer/touch tests, context-loss recovery, DOM list fallback |
| OCR is inaccurate on handwriting | Feature feels useless | Off by default, user-triggered, never overwrites edits, title prefill only, no auto-tags |
| 150 cards stutter on low-end tablets | Core interaction fails | Culling, thumbnails first, texture release, performance harness, 150-card fixture |
| GitHub Pages has no server rewrites or headers | Deep links or CSP break | Hash routing, static assets, no third-party scripts, documented hosting limits |
| Malicious or corrupt backup | Data loss or XSS | Schema and checksum validation, path-safety rules, text-only rendering, atomic import |
| Scope drifts into AI or collaboration | Product loses its point | Explicit non-goals and constraint IDs checked in review |

---

## 13. Future Considerations

- Whole-library export and import.
- Optional passphrase encryption for case archives.
- PDF import with page-to-card conversion.
- Additional OCR languages and handwriting tuning, if the optional feature proves useful.
- Case duplication and cross-case card reuse.
- A read-only shareable case file that does not require an account.
- A richer first-run prototype derived from real student boards, not scripted content.

---

## 14. Features

| # | Feature | File | Dependencies | Priority |
|---|---------|------|-------------|----------|
| 1 | App Foundation | [docs/features/app-foundation.md](features/app-foundation.md) | None | Must |
| 2 | Local Data and Case Shelf | [docs/features/local-data-and-case-shelf.md](features/local-data-and-case-shelf.md) | App Foundation | Must |
| 3 | Evidence Capture | [docs/features/evidence-capture.md](features/evidence-capture.md) | Local Data and Case Shelf | Must |
| 4 | Case Board | [docs/features/case-board.md](features/case-board.md) | Local Data and Case Shelf, Evidence Capture | Must |
| 5 | Connections and Provenance | [docs/features/connections-and-provenance.md](features/connections-and-provenance.md) | Case Board | Must |
| 6 | Case Closure | [docs/features/case-closure.md](features/case-closure.md) | Connections and Provenance | Must |
| 7 | Recall Mode | [docs/features/recall-mode.md](features/recall-mode.md) | Case Board, Connections and Provenance | Must |
| 8 | Search Tags and Filters | [docs/features/search-tags-and-filters.md](features/search-tags-and-filters.md) | Case Board, Evidence Capture | Should |
| 9 | Backup and Restore | [docs/features/backup-and-restore.md](features/backup-and-restore.md) | Local Data and Case Shelf, Evidence Capture | Must |
| 10 | Optional OCR | [docs/features/optional-ocr.md](features/optional-ocr.md) | Evidence Capture, Search Tags and Filters, Backup and Restore | Should |
| 11 | First-Run Demo and Hints | [docs/features/first-run-demo-and-hints.md](features/first-run-demo-and-hints.md) | Case Board, Connections and Provenance, Case Closure, Backup and Restore | Should |
| 12 | Responsive and Accessibility Hardening | [docs/features/responsive-and-accessibility-hardening.md](features/responsive-and-accessibility-hardening.md) | App Foundation, Local Data and Case Shelf, Evidence Capture, Case Board, Connections and Provenance, Case Closure, Recall Mode, Search Tags and Filters, Backup and Restore, Optional OCR, First-Run Demo and Hints | Must |
| 13 | Release and Field Review | [docs/features/release-and-field-review.md](features/release-and-field-review.md) | Responsive and Accessibility Hardening | Must |

### Feature Dependency Graph

```text
App Foundation
└── Local Data and Case Shelf
    └── Evidence Capture
        ├── Case Board
        │   ├── Connections and Provenance
        │   │   ├── Case Closure
        │   │   │   └── First-Run Demo and Hints
        │   │   └── Recall Mode
        │   └── Search Tags and Filters
        │       └── Optional OCR
        └── Backup and Restore
            ├── Optional OCR
            └── First-Run Demo and Hints

All user-facing features
└── Responsive and Accessibility Hardening
    └── Release and Field Review
```

---

## 15. Glossary

| Term | Definition |
|------|------------|
| Case | One exam or course board, containing cards and connections. Cards belong to exactly one case. |
| Card | A Study Note, Source, or Topic hub pinned to a case board. |
| Study Note | A photo card representing notes the student wrote, with a short title and optional additional notes. |
| Source / Evidence | A photo card representing the original material a note came from. |
| Topic hub | A card representing a theme or exam topic, with text and an optional image. |
| Association string | A red, undirected connection between two cards, usually a note and a topic. |
| Provenance string | A thin dashed amber connection between a Study Note and a Source. |
| Loose thread | A Study Note missing a provenance link or a topic association, or a Topic with no connections. |
| Ready | A case with zero loose threads; the only state in which it can be closed. |
| Closed | A case the student marked complete. It stays editable and can be reopened. |
| Recall mode | A non-persistent review mode that hides strings and checks connections the student redraws from memory. |
| Case shelf | The home screen listing all cases. |
| `.ndcase` | The single-case ZIP backup format. |
| Demo case | A locally generated, clearly labeled sample case that can be removed and is never reseeded automatically. |

---

## 16. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Which early graphical detective games are the aesthetic reference? | The visual-direction spike presents three options; the human review records the choice. The fallback is cork, sepia, oxblood, and period headings only. |
| 2 | What should pins, string sag, and lift feel like? | Brass pins, 3px red string with 12px sag, dashed amber provenance. The board-feel human review can revise it before closure work. |
| 3 | Is handwriting OCR accurate enough to be useful? | Ship it off by default, user-triggered, title prefill only, never overwrite edits, never auto-tag. Reassess after real use. |
| 4 | Should case archives be encrypted? | V1 archives are unencrypted ZIPs with a warning; encryption is future work. |
| 5 | Should whole-library export exist? | Deferred; v1 exports exactly one case at a time. |
| 6 | What happens when a closed case is edited into loose threads? | Keep `closedAt`, show `Closed · loose threads`, and require a fresh close after repair; never auto-reopen. |
| 7 | Can a removed demo case be restored? | No automatic reseed; the student can create a new case. A manual restore action can be added later. |
| 8 | Are reminders or exam-date notifications in scope? | No notifications in v1; the exam date is display and sort metadata only. |
| 9 | Are tags and OCR text included in search and backup? | Yes; OCR text is searchable and exported, while raw image pixels are never indexed. |
| 10 | Is the archive format stable across schema changes? | The manifest carries a schema version; unsupported versions are rejected with an actionable message rather than guessed at. |
