# Notes Detective v1 Release

This document records the v1 release contract and the evidence that must exist before the release
is accepted. It separates automated gates from the human acceptance gate on purpose: a green CI run
or a successful Pages deployment never substitutes for a real student journey.

## Version and date

| Field | Value |
| --- | --- |
| Release | v1.0 release candidate |
| Application package version | `0.1.0` (`package.json`) |
| Documentation date | 2026-10-26 |
| Local database schema | 1 |
| Case archive format | 1 |
| Deployment target | GitHub Pages project site, static files only |
| Release status | Release candidate; full E2E and human acceptance are not green yet |

The package version is the version shipped in the app and written into each `.ndcase` manifest.
The release name is `v1.0`; the package remains `0.1.0` until the human gate is recorded and the
owner chooses to bump it.

## Release checklist

The checklist is deliberately split. Automated items can be re-run by any maintainer. Human items
can only be completed by the reviewer on real devices.

### Automated checks

- [x] `node scripts/validate-workflows.mjs` validates the CI workflow contract.
- [x] `npm run lint` and `npm run typecheck` pass.
- [x] `npm run test:coverage` passes, including the 85 percent line floor for `src/domain/**` and
      `src/data/**`.
- [x] `npm run build` emits a production artifact.
- [x] `VITE_BASE_PATH=/notes-detective/ npm run build` followed by
      `node scripts/check-pages-build.mjs --base /notes-detective/` passes for the Pages base path.
- [x] `node scripts/perf-budget.mjs` keeps initial JavaScript at or below 300 KiB gzip.
- [x] `node scripts/check-bundle-budget.mjs` keeps the service-worker precache at or below 25 MiB.
- [x] `npm run test:e2e -- e2e/pwa.spec.ts` passes the PWA install, offline, and update journeys at
      all three Chromium viewports.
- [ ] The complete `npm run test:e2e` suite is green on the release commit.
- [x] `node scripts/check-release-docs.mjs` and its Vitest test pass.

### Release and deployment checks

- [ ] The latest CI run for the release commit is green on `main`; read the run, do not infer it.
- [ ] The `deploy-pages` workflow completed for the release commit, and the `github-pages`
      environment shows the deployed URL.
- [ ] The deployed build is the commit under review (build identity and workflow run recorded).
- [ ] The deployed URL and repository base path match; a direct hash route loads without a server
      rewrite.
- [ ] The deployed manifest, icons, and service worker load from the deployed origin, and the
      browser's network panel shows no third-party request.

### Human acceptance

- [ ] REL-HR-1 was completed on a 10-inch tablet in landscape, a phone, and desktop against the
      deployed build.
- [ ] The full capture, pin, string, close, recall, OCR, export, import, reopen, offline reload,
      and install journey passed on each device.
- [ ] The desktop keyboard path for non-spatial tasks passed.
- [ ] Every step has a recorded pass/fail, and every defect has reproduction notes.
- [ ] The reviewer answered the hard success signal honestly.
- [ ] `docs/reviews/final-acceptance.json` exists and records the reviewer, devices, browser
      versions, URL, step results, and the answer.

The release is **not accepted** while any human item is unchecked. Automated evidence cannot check
those boxes.

Source documents for this release: [PRD](PRD.md),
[Release and Field Review](features/release-and-field-review.md), and
[Deployment](DEPLOYMENT.md).

## CI gates

`.github/workflows/ci.yml` runs on every push and pull request. It uses Node 24 and has no
`continue-on-error`, conditional skip, or shell fallback on a required step.

| Gate | Command | Pass condition |
| --- | --- | --- |
| Install | `npm ci` | Lockfile install succeeds, including the OCR asset copy. |
| Workflow contract | `npm run validate:workflows` | Node 24, required steps present, no bypass. |
| Lint | `npm run lint` | Zero ESLint errors. |
| Typecheck | `npm run typecheck` | Zero TypeScript errors. |
| Coverage | `npm run test:coverage` | All tests pass; domain and data line coverage at least 85 percent with every matched file covered. |
| Build | `npm run build` | The production artifact is emitted. |
| Browser install | `npx playwright install --with-deps chromium firefox webkit` | Chromium, Firefox, and WebKit are available. |
| End-to-end | `npm run test:e2e` | The Playwright journeys pass against the production preview. |

The release documentation is enforced in CI through `tests/release/releaseDocs.test.ts`, which runs
the docs checker as part of `npm run test:coverage`. The deploy workflow separately runs the Pages
build check before uploading the artifact.

CI evidence is not product evidence. It can prove that a command exited zero, that a browser test
observed a flow, or that a budget held. It cannot prove that the board is clear, that OCR is useful
on a student's handwriting, or that the reviewer would choose the board over re-reading notes.

## Human gates

The human gate is REL-HR-1. It runs against the deployed GitHub Pages build, not the dev server and
not a local preview. The reviewer records the result in `docs/reviews/final-acceptance.json`.
Automation, including this document, must not create or approve that file.

| Device | Required checks |
| --- | --- |
| 10-inch tablet, landscape | Install, open the demo, create a case, import real photos, crop/rotate, pin, draw association and provenance strings, close, recall and check, OCR one card, export, delete, import as a copy, reopen, go offline and reload. Check that text and targets are readable with touch. |
| Phone | The same journey at 390x844, including sheets, install or Add to Home Screen, offline reload, and export/import. |
| Desktop | The same journey at 1440x900, plus the keyboard path for card CRUD, connection CRUD, source attach, search, recall entry/check/reset/exit, and Settings. The board remains pointer-only for spatial work. |

The reviewer must also:

- Open the browser network panel and confirm that only same-origin static requests appear. No
  analytics, telemetry, crash reporting, font CDN, or external OCR endpoint may appear.
- Record device, browser and version, deployed URL, commit or build identity, and each step's
  pass/fail.
- Record any defect with reproduction notes instead of a screenshot alone.
- Answer the hard success signal in their own words, including a "no" if that is the honest answer.
- Complete the review once per device or explicitly record which device was not exercised.

If the board fails on the reviewer's real material, record the failure and the specific reason. Do
not treat the release as accepted because CI is green or because the demo worked.

## Hard success signal

> The reviewer would choose this board over re-reading their notes for a real exam.

This is the v1 hard gate, not a usage target, session-length target, or build-success target. The
answer is recorded in `docs/reviews/final-acceptance.json` after the deployed journey. A "yes" must
be specific about what the board made easier; a "no" is a valid release outcome and must identify
what failed. Automated checks, including every test in this repository, cannot answer it.

The 3–5 student reuse interviews are a post-v1 stretch and never block v1. They are not a substitute
for the reviewer's answer, and they are not collected through telemetry.

## Post-v1 pilot

The pilot is planned after v1 ships. It is deliberately small and qualitative.

1. Recruit three to five students who have an exam within the next few weeks and already photograph
   their notes.
2. Ask each student to build one real case from their own material during a moderated session, then
   close, recall, export, and reopen it.
3. Observe where capture, pinning, string drawing, closure, and recall break down; do not prompt
   unless the student is blocked.
4. Exit with a short structured interview: whether they would reuse the board, what they trust, what
   they would not put on it, and what made them return to their notes.
5. Record notes locally. Do not add analytics or a survey SDK to the app.

The pilot is a post-v1 learning activity, not a shipping gate. A pilot that shows the board is not
reused should shape the next version; it does not retroactively invalidate a completed human gate,
and a completed pilot does not replace the human gate.

## Changelog

### v1.0 — 2026-10-26

First release candidate.

- Added the React 19 and TypeScript PWA foundation with hash routing, installability, a waiting
  update prompt, and recoverable error and offline states.
- Added the versioned IndexedDB case store, case shelf, persistence request, quota display, and
  multi-tab refresh.
- Added photo capture with crop, rotate, original/display/thumbnail derivatives, and atomic card
  imports.
- Added the PixiJS case board with pan, zoom, pinning, strings, gesture handling, culling, texture
  release, and a DOM card-list alternative.
- Added association and provenance connections, closure readiness, closed-with-loose-threads state,
  and manual reopen.
- Added recall mode with a scratch layer, remembered/missed/extra/type-mismatched results, and no
  score.
- Added tag and text search, including stored OCR text.
- Added the versioned `.ndcase` single-case archive with checksum and path validation, copy and
  replace restore, and a one-time backup reminder.
- Added optional, user-triggered, on-device English OCR with bundled worker, wasm, and traineddata.
- Added the first-run demo case and replayable hints.
- Added responsive layouts, WCAG 2.2 AA checks, keyboard paths, reduced motion, and 44x44 targets.
- Added the Node 24 CI quality gate, GitHub Pages deployment, Pages build check, performance and
  precache budgets, PWA offline journeys, release documentation, and the human acceptance gate.

There is no analytics, telemetry, crash reporting, account system, sync service, or third-party
runtime request in this release.

## Release risks

- **The full Playwright suite is not green.** A local `npm run test:e2e` run on 2026-10-26 produced
  69 passed, 19 failed, and 13 skipped. The failures clustered in board drag and pan, capture,
  connection drawing, a few phone layouts, and one search keyboard path; the PWA install, offline,
  and update journeys passed at all three Chromium viewports. The release is blocked until the
  failures are fixed or proven environmental, and until CI reports the same result.
- **The human gate is still open.** No amount of CI or deployment evidence answers whether the
  board helps a real student.
- **The deployed identity must be verified, not assumed.** Read the URL from the `github-pages`
  environment and compare it with the commit and base path under review. A workflow that runs is
  not by itself proof that the intended artifact is live.
- **First load still needs the network.** Offline behavior starts after the app shell and OCR assets
  are precached.
- **The browser can evict storage.** Persistent storage is best-effort. A student who does not back
  up can lose a case.
- **OCR quality is uncertain on handwriting.** It is optional and never overwrites a title, but a
  poor result can make the feature feel useless.
- **Backups are plain ZIP files.** Anyone with the file can read the notes. The release docs must
  not imply otherwise.
- **GitHub Pages cannot set custom response headers.** The project relies on same-origin static
  assets and no third-party scripts instead of a custom header policy.
- **Firefox and WebKit automation is a smoke path.** The full journey is Chromium plus the human
  devices. A green Firefox or WebKit smoke does not prove feature parity.
- **The board performance ceiling is device-dependent.** The 150-card target is verified by
  automated fixtures and a human tablet check; low-end tablets may still drop frames.
