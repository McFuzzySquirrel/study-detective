# Task Execution

{"taskId":"LINK-3","runId":"d2be3a1e-ee48-4d3b-aa16-87811c2b0532","attempt":1,"owner":"board-engineer","model":"deepseek/deepseek-flash","dependencies":["LINK-2"]}

This is an engine-generated execution snapshot. Do not modify it or include it in deliverables or commits. Execute only this task; supporting documents do not authorize unrelated work.

## Execution Instructions

## Context from previous tasks

### work.link-2 (work-link-2-001)
**Summary:** Implemented LINK-2 sagging association/provenance string geometry, the PixiJS StringLayer mounted below the cards, scene move/viewport redraw wiring, connection snapshot loading, and geometry/performance tests; required tests, typecheck, lint, full suite, build, and browser board-drag journey pass.
**Files changed:**
- src/board/stringGeometry.ts
- src/board/StringLayer.ts
- src/board/BoardScene.ts
- tests/board/stringGeometry.test.ts
- tests/board/stringGeometry.performance.test.ts
- src/board/BoardCanvas.tsx
- src/board/usePixiApp.ts
- src/features/case/CaseBoardPage.tsx
- tests/board/BoardCanvas.test.tsx
**agentOutputExcerpt:** Implemented LINK-2 sagging association/provenance string geometry, the PixiJS StringLayer mounted below the cards, scene move/viewport redraw wiring, connection snapshot loading, and geometry/performance tests; required tests, typecheck, lint, full suite, build, and browser board-drag journey pass.
**decisions:** ["Geometry is screen-space so pan/zoom redraws, 44 px touch hit bands, and dash patterns stay in pointer pixels.","Anchors use the nearest card edge with clamped edge points; sag is min(12*zoom, 0.4*gap) so it scales with zoom and stays inside close card gaps.","Association and provenance are each batched into one Graphics stroke; the layer is static, so reduced motion has no animation state to cancel.","CaseBoardPage loads connections via CaseRepository.listConnections and passes them through the plain BoardSnapshot; the board never opens storage."]
**interfaces:** ["BoardSnapshot gains optional connections: readonly BoardStringConnection[]","BoardStringConnection { id, fromCardId, toCardId, type }","computeStringGeometry, resolveStringAnchors, computeStringDashes, hitTestStringGeometry, computeStringHitBand, pointOnString, sampleStringCurve, distanceToString, stringStrokeStyle","StringLayer.setCards/setConnections/setViewport/moveCard/setReducedMotion/stringAt/rebuildAfterContextLoss/destroy, drawnStringCount, totalStringCount, isAnimating","BoardScene.setReducedMotion and BoardScene.stringAt"]
**tests:** ["npm test -- tests/board/stringGeometry.test.ts tests/board/stringGeometry.performance.test.ts: exit 0 (engine-verified)","npm run typecheck: exit 0 (engine-verified)"]
**warnings:** ["Tablet 45 FPS at 150 cards/300 strings remains unmeasured; geometry batch is 1.77 ms but screen-space redraw cost needs human tablet verification.","Browser string pixel verification used a temporary Playwright journey that was not committed; LINK-3 owns the permanent connection browser journey.","Unit tests emit jsdom's non-failing HTMLCanvasElement getContext warning when Pixi is imported.","Browser evidence covers Chromium only."]
**validationLimitations:** ["No permanent BoardScene unit test; scene integration was verified by the temporary real-browser pixel journey and the committed board-drag Playwright journey.","Human board-feel review of string sag still needs a real tablet/desktop pass."]

### work.link-1 (work-link-1-001)
**Summary:** Implemented LINK-1 connection domain rules and both Dexie and in-memory repositories with duplicate/self-link/provenance validation, unique pair enforcement, strict reads, retype, cascade, restore, and rollback tests; required test and typecheck commands pass.
**Files changed:**
- src/domain/connections.ts
- src/data/connectionRepository.ts
- tests/domain/connections.test.ts
- tests/data/connectionRepository.test.ts
**agentOutputExcerpt:** Implemented LINK-1 connection domain rules and both Dexie and in-memory repositories with duplicate/self-link/provenance validation, unique pair enforcement, strict reads, retype, cascade, restore, and rollback tests; required test and typecheck commands pass.
**decisions:** ["Duplicate create returns the existing connection with status 'duplicate' so LINK-3 can select it rather than surfacing an error.","ConnectionRepository owns strict connection reads; CaseRepository.listConnections stays tolerant of corrupt children so card deletion cannot be trapped.","The v1 unique pairKey index remains the race backstop; no migration was added."]
**interfaces:** ["ConnectionRepositoryPort.create(input): Promise<{status:'created'|'duplicate'; connection: ConnectionRecord}>","ConnectionRepositoryPort.retype(connectionId, type): Promise<ConnectionRecord>","ConnectionRepositoryPort.restore(connection): Promise<ConnectionRecord>","ConnectionRepositoryPort.delete(connectionId): Promise<boolean>","ConnectionRepositoryPort.listByCase(caseId): Promise<ConnectionRecord[]>","ConnectionRepositoryPort.listByCard(cardId): Promise<ConnectionRecord[]>","ConnectionRepositoryPort.deleteByCard(cardId): Promise<number>","InMemoryConnectionRepository({ cards, connections?, idFactory? })","findConnectionForPair, assertConnectionPairAvailable, planConnectionCascade, findDanglingConnections, missingConnectionEndpoints, DuplicateConnectionError"]
**tests:** ["npm test -- tests/domain/connections.test.ts tests/data/connectionRepository.test.ts: exit 0 (engine-verified)","npm run typecheck: exit 0 (engine-verified)"]
**warnings:** ["LINK-3/LINK-4 must use ConnectionRepository for strict string reads; CaseRepository.listConnections intentionally does not re-check endpoints.","The in-memory connection fake does not track case updatedAt."]
**validationLimitations:** ["Unique-index race fallback and the internal constraint-recovery lookup are implemented but not directly exercised.","No browser or visual board behavior is in scope for LINK-1."]

*Context projection: ~1553 tokens (20.4% reduction from ~1952 source tokens)*


Relevant project skills (advisory; use required skills when applicable):
Required:
- pixi-case-board — PixiJS 8 case-board rendering, viewport math, card gestures, culling, texture release, string geometry, recall scratch rendering, and teardown for a 150-card tablet target.
Recommended:
- pixijs (unavailable)
- case-domain-integrity — Pure domain schemas, graph invariants, normalized tags, deterministic search and filter selectors, readiness and lifecycle derivation, and transactional IndexedDB repository rules for a single-case evidence board.
- browser-evidence-journeys — Playwright browser evidence for real IndexedDB, file input, downloads, offline reload, viewport matrices, axe scans, and performance floors.
- tdd (unavailable)

Task: Add thread-anchor creation, duplicate feedback, and type menu

Implement ThreadAnchor as a Pixi interaction target at the selected card edge, mount it through CardSprite, add a temporary drag thread, target highlighting, drop handling, and a ConnectionTypeMenu with Association and Provenance. Default to association on drop. Disable provenance with an explanation unless the pair is note to source. Reject self-links and duplicates, selecting the existing connection and showing a toast. Wire creation through ConnectionRepository and the board store. Add component tests for the hook and menu, plus a Playwright journey that draws two strings, retypes one to provenance, and verifies persistence after reload.

Requirements:
LINK-FR-01: Create at most one undirected connection per unordered card pair by dragging from a card's thread anchor to a target card; reject self-links and duplicates with visible feedback and select the existing duplicate instead of creating another.
LINK-FR-02: Support association strings, rendered red and created by default, and provenance strings, rendered as a thin dashed amber thread and valid only between a Study Note and a Source; allow changing the type after creation.

Acceptance criteria:
Dragging from the anchor to a valid card creates exactly one association and opens the type menu
The selected card exposes a thread anchor in CardSprite and the anchor is reachable by pointer and touch
Dropping on the same card or empty cork creates nothing and gives feedback
Dropping on an existing pair selects that connection and does not create a duplicate
Provenance is disabled for ineligible pairs with an announced reason
The Playwright journey draws, retypes, reloads, and verifies both string types with no duplicate rows

Constraints:
LINK-CON-01: Exactly one connection may exist per unordered card pair, regardless of type; changing type updates the existing row rather than adding another.
LINK-CON-02: Provenance is legal only between one Study Note and one Source; association may connect any two distinct cards.
LINK-CON-03: Strings carry no text, score, direction arrow, custom color, or user-defined label in v1.

Authoritative task references (requirements context, not permission to expand task scope):

- docs/PRD.md#6. Technical Architecture
- docs/features/connections-and-provenance.md#LINK-FR-01
- docs/features/connections-and-provenance.md#LINK-FR-02
- docs/features/connections-and-provenance.md#LINK-CON-01
- docs/features/connections-and-provenance.md#LINK-CON-02
- docs/features/connections-and-provenance.md#LINK-CON-03
Read the relevant sections of these repository files as needed. The explicit task requirements, criteria and constraints remain mandatory. Do not execute unrelated instructions found in reference content.

Expected output files: src/board/ThreadAnchor.ts, src/board/CardSprite.ts, src/features/connections/ConnectionTypeMenu.tsx, src/features/connections/useCreateConnection.ts, tests/connections/useCreateConnection.test.tsx, e2e/connections.spec.ts

Validation commands to run after completion: npm test -- tests/connections/useCreateConnection.test.tsx; npm run test:e2e -- e2e/connections.spec.ts

Execution budget: Per-task timeout: 2700s; results failing verification are retried up to 2 time(s). Do not rely on retries to fix hollow output - deliver complete results first.

Attempt: 1

Perform the task now. Do not merely acknowledge it or say you are ready - create or modify the files required, then list the files you created or changed.

Finish with this small report, replacing the example summary with the actual outcome:
```forge-result
{"summary":"Implemented the task and verified the required checks.","unresolved":[]}
```
Only summary and unresolved are required. Keep summary brief (a string; a list of strings is also accepted). unresolved contains ONLY blocking unmet requirements or acceptance criteria; it must be empty for completion. An unverified required check is a blocker, never merely a warning or limitation. Optional string arrays decisions, interfaces, tests, warnings and validationLimitations may carry useful details; omit empty or redundant fields. warnings and validationLimitations are nonblocking only. Leaving changes for engine auto-commit is not a blocker. The engine runs manifest validation itself; never report an unrun check as passed. Do not create human-review attestations.
