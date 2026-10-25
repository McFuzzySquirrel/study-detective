# Journey matrix

Use this reference to choose the spec and the assertion for a claim.

| Claim | Spec | Required assertion |
|-------|------|--------------------|
| Image import, crop, rotate, replace | `e2e/capture.spec.ts` | Real PNG through `setInputFiles`; saved card survives reload; replace keeps card ID and exactly three attachments |
| Board pan, zoom, drag, viewport restore | `e2e/board.spec.ts`, `e2e/board-drag.spec.ts` | Scripted pan/zoom changes the rendered viewport; card position survives reload; zoom clamped 0.25-2.5 |
| Connection draw, retype, duplicate, undo | `e2e/connections.spec.ts` | Two strings persist after reload; A-B/B-A creates one row; type change updates the same row |
| Keyboard non-spatial path | `e2e/keyboard-journey.spec.ts`, `e2e/keyboard-links.spec.ts`, `e2e/keyboard-cards.spec.ts` | Card CRUD, provenance, connection CRUD, search, recall, delete/undo with no pointer events |
| Closure lifecycle | `e2e/closure.spec.ts` | Close at zero loose threads; break readiness shows `Closed · loose threads`; repair; reopen |
| Recall | `e2e/recall.spec.ts`, `e2e/recall-results.spec.ts` | Truth hidden; reversed pair remembered; missed/extra/type mismatch listed; graph unchanged and no write |
| Search and filters | `e2e/search.spec.ts` | Partial title and OCR match; type AND tag filters; clear all; selected card centered; phone sheet no overflow |
| Backup and restore | `e2e/backup.spec.ts` | Export real bytes, delete, copy restore, replace with typed confirmation, exactly one case |
| OCR | `e2e/ocr.spec.ts` | Real fixture OCR, title applied, text searchable after reload, no overwrite of edited title |
| First run and hints | `e2e/demo.spec.ts` | Fresh context seeds one demo, hint dismissal, removal, reload no reseed, replay from settings |
| Responsive matrix | `e2e/responsive.spec.ts` | 390/768/1280/1440, sheets open/close, 44px targets, no page-level horizontal scroll |
| Accessibility | `e2e/a11y.spec.ts` | Zero serious/critical across six screens plus dialogs/sheets |
| Performance | `e2e/performance.spec.ts` | 150-card seed, five-second pan, average FPS and p95 reported, CI floor enforced |
| PWA and offline | `e2e/pwa.spec.ts` | Manifest/icons, service-worker control, offline reload, OCR assets cached, update prompt |
| Cross-browser | `e2e/compat.spec.ts` | Chromium/Firefox/WebKit smoke shelf, demo, board, search, settings |
| Visual direction prototype | `e2e/style-tile.spec.ts` | Three directions, both string types, type samples, 44px control, no overflow at tablet/phone |

## Evidence rules

- A journey may combine claims only when each has its own assertion.
- A test that asserts a class name or a screenshot alone is weak evidence; assert accessible text, stored data after reload, downloaded bytes, network origin, or a measured frame distribution.
- A skipped test is a missing claim, not a pass.
- A test that passes with the behavior removed is invalid; verify the failure mode once locally.
- Keep selectors user-facing (`getByRole`, `getByLabel`, accessible names). Test IDs are acceptable for canvas wrappers or seeded fixtures when no user-facing name exists.

## Fixtures

- `e2e/fixtures/note.png`, `source.png`, `ocr-note.png`: real images, committed, small enough for CI.
- A large fixture for the 30 MB boundary is generated or stored outside the default run to keep CI fast.
- A 150-card case is inserted through `e2e/helpers/seedLargeCase.ts` using the app's schema, not by 150 UI imports.
- Archive bytes are produced by the export path; do not hand-craft a manifest for the acceptance journey.
