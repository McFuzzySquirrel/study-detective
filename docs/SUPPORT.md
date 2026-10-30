# Support

Notes Detective is maintained by the agent team below. The original build
requirements and execution tooling have been retired; this document describes how
the repository is maintained now.

## Team

| Agent | Scope | Invoke when |
|---|---|---|
| support-lead | triage, release coordination, cross-module decisions | priority, ownership, release, architecture records |
| foundation-engineer | `src/app`, shell, routing, PWA boundary, toolchain | install, update, offline, route, build configuration |
| board-engineer | `src/board`, `src/features/case`, `src/features/connections`, `src/features/recall` | board rendering, gestures, strings, recall |
| capture-engineer | `src/features/capture`, `src/features/ocr`, OCR asset scripts | image import, crop, OCR |
| data-engineer | `src/domain`, `src/data`, `src/features/backup`, `src/features/demo` | schemas, graph rules, storage, archives |
| ui-engineer | `src/components`, `src/styles`, remaining feature screens | screens, forms, dialogs, tokens, keyboard paths |
| qa-engineer | `tests`, `e2e`, performance and bundle budgets | test infrastructure, verification, accessibility, budgets |
| release-engineer | `.github/workflows`, `scripts`, release documents | CI, Pages deployment, release checklist |

## Ownership

| Area | Owner | Checks |
|---|---|---|
| `src/app`, `src/main.tsx`, `src/App.tsx`, `src/pwa.ts`, `src/pwaManifest.ts` | foundation-engineer | `npm test -- tests/app tests/pwa` |
| `src/board` | board-engineer | `npm test -- tests/board` |
| `src/features/case`, `src/features/connections`, `src/features/recall` | board-engineer | `npm test -- tests/recall tests/connections` |
| `src/features/capture`, `src/features/ocr` | capture-engineer | `npm test -- tests/capture tests/ocr` |
| `src/domain`, `src/data` | data-engineer | `npm run test:coverage` |
| `src/features/backup`, `src/features/demo` | data-engineer | `npm test -- tests/backup tests/demo` |
| `src/components`, `src/styles` | ui-engineer | `npm test -- tests/components tests/styles` |
| `src/features/cards`, `closure`, `search`, `settings`, `shelf`, `welcome`, `onboarding` | ui-engineer | `npm test -- tests/shelf tests/case tests/cards` |
| `tests/setup.ts`, `tests/helpers`, `tests/stubs`, `tests/a11y` | qa-engineer | `npm run test:coverage` |
| `e2e` | qa-engineer | `npm run test:e2e` |
| `scripts/perf-budget.mjs`, `scripts/check-bundle-budget.mjs` | qa-engineer | `node scripts/perf-budget.mjs` |
| `.github/workflows`, `.github` | release-engineer | `npm run validate:workflows` |
| `scripts/validate-workflows.mjs`, `check-pages-build.mjs`, `check-release-docs.mjs`, `capture-media.mjs` | release-engineer | `node scripts/check-release-docs.mjs` |
| `scripts/copy-ocr-assets.mjs`, `scripts/check-ocr-assets.mjs` | capture-engineer | `node scripts/check-ocr-assets.mjs` |
| `README.md`, `docs/RELEASE.md`, `docs/DEPLOYMENT.md` | release-engineer | `node scripts/check-release-docs.mjs` |
| `docs/SUPPORT.md`, `.opencode/agents`, `.opencode/skills` | support-lead | review only |

Per-area tests are maintained by the owner of the area; the shared harness, fixtures,
and cross-cutting suites are maintained by qa-engineer.

## Intake

1. Capture the report with reproduction steps, expected behavior, device, browser,
   and whether the app was installed or offline.
2. Route to the owning agent from the ownership table.
3. The owner reproduces, fixes the cause, adds a regression test, and runs the owned
   checks.
4. Cross-module or product decisions go to the support lead.
5. The support lead records the release evidence.

## Release checklist

- [ ] `npm run lint`, `npm run typecheck`, and `npm run test:coverage` pass.
- [ ] `npm run build` passes, and the Pages build check passes with `VITE_BASE_PATH`.
- [ ] `npm run test:e2e` passes against the production preview.
- [ ] `node scripts/check-release-docs.mjs` passes.
- [ ] Version bumped in `package.json` when the project publishes one.
- [ ] Changelog and release notes updated in `docs/RELEASE.md`.
- [ ] No open blocker or accepted-risk item without an owner.

## Escalation

- Unclear ownership: support-lead.
- Cross-module change: support-lead coordinates the owners.
- Product or scope decision: the human maintainer.
