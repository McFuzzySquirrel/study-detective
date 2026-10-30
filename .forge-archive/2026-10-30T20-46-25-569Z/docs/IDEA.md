# Project Idea: Notes Detective

Turning your notes into a detective story.

## Original intent

> A student can take photos of their study notes and also photos or upload of their content applicable to those study notes. They can then pin the study notes on a detective board, add case notes which is the original content the notes were created from. They can then connect study notes with a red string that connects notes and topics together. This is to help them interact an remember their notes for upcoming exams. It should follow a theme of an early graphical detective game with the same aesthetics and should also work on tablets and mobile devices, so menus need to be minimal and touch screen friendly

## The idea, sharpened

A solo exam-revision tool disguised as a detective evidence board. The student
photographs the notes they already took in class and the source material those
notes came from, pins both to a case board, and draws red strings between related
notes and topics. Reviewing means looking at the case, then hiding the strings and
reconstructing the connections from memory.

The detective framing is the interaction metaphor and the visual language. It is
not a content generator: the app does not invent mysteries, cases, or
connections. The student supplies all the meaning, and that is the point — the
connections are the studying.

## Who it is for

- **Primary:** university/college students preparing for a specific exam, building
  one case intensively in the 1–2 weeks before it, from photos already taken in
  lectures.
- **Secondary:** high-school students doing the same thing. Supported by the same
  product; no high-school-specific features in v1.
- **Solo only.** No sharing, study groups, classroom features, or collaboration.

## Core experience

1. Create a case (name, subject, optional exam date).
2. Capture study notes and source material with the camera, photo library, or an
   image upload; rotate and crop on import.
3. Pin cards on an infinite corkboard, arranged by hand.
4. Draw strings between cards: red for idea associations, thin dashed amber for
   provenance.
5. Review in recall mode: strings hide, the student redraws what they remember,
   then checks against the truth.

## The board model

- **Self-contained case files.** One case per exam or course. Cards belong to
  exactly one case; there is no cross-case reuse in v1.
- **Three node types:**
  - **Study Note** — photo plus a short handwritten-style title.
  - **Evidence/Source** — photo plus a title; the original material a note came
    from.
  - **Topic hub** — text only, no photo.
- **Many-to-many provenance.** A note may reference one or more sources; one
  source can feed many notes. (The idea's phrasing sounds 1:1; the real world is
  not.)

## Rules that make the theme mean something

- **Strings.** One drag gesture from a card's thread anchor creates a red
  association string. Provenance is the second relationship type, set after
  drawing and rendered as a thin dashed amber thread. Strings are undirected,
  limited to one per card pair, and carry no text labels in v1.
- **Closing a case.** The user decides when a case is closed, but the app gates
  that moment structurally: no orphan study notes (each has at least one source
  link and one topic string) and no orphan topics. Orphans are surfaced as "loose
  threads." Closing is never gated by a score.
- **Topic status** is derived from structure: a topic with two or more linked
  notes is "solved." No points, levels, XP, or rankings.
- **Recall mode** hides strings only; titles stay visible so the spatial map
  still cues memory. The student redraws connections on a scratch layer, and
  "check" overlays the truth marking remembered and missed strings. No score and
  no persistence — leaving the mode resets it. Recall is a review activity, never
  a requirement to close a case.

## Capture rules

- Camera, photo library, or image-file upload (JPG/PNG/WebP).
- One image per card; multi-page material becomes multiple cards.
- Rotate and crop offered at import.
- Study notes and sources are photo-only; topics are text-only.
- **PDF import is a v1 non-goal** — the most likely post-v1 addition.

## Platform, storage, and privacy

- **Responsive installable PWA**, offline-first. Tablet landscape is the
  arranging target; phone keeps full capability but is tuned for a 10" viewport
  first. Desktop is a supported viewport, not the target.
- **Local-first.** Images and board data live in IndexedDB on the device. No
  accounts, no sync, no network dependency, no telemetry, no upload of the
  student's notes.
- **Backup is explicit.** Whole-case export to a single file and import restore,
  reachable from the case shelf, with a one-time prompt once a board is worth
  losing. Request persistent storage where supported and show storage usage.
  Browser storage eviction is a named risk, not an accepted one.
- **Optional on-device OCR**, off by default, triggered by the user per card to
  autofill a title and make that card searchable. No cloud OCR, no auto-tagging,
  no auto-drawn strings.

## Interface decisions

- Infinite pannable/zoomable canvas; long-press to lift a card, tap for card
  detail.
- Tags on any card; title+tag search and filter (no full-text beyond OCR'd
  titles).
- Single-level undo for deletes via toast, with confirmation naming how many
  strings will be removed. No undo/redo stack.
- **No photo annotation**, no card colors, no string labels in v1.
- **Scale ceiling:** ~150 cards per case. Downscale photos at import, lazy-load,
  fit-to-view plus a minimap, and a soft warning past ~120 cards. "Split the
  case" is the answer above that; 300+ cards is out of scope.
- **First run:** a seeded, clearly labeled, removable demo case plus one-time
  contextual hints for the thread anchor, long-press lift, and recall mode. No
  scripted tour.

## Accessibility floor

- WCAG AA contrast, 44px touch targets, visible focus, reduced-motion support,
  card titles doubling as image alt text.
- A keyboard-operable card list/detail path for every capability that matters —
  create a note, attach a source, link a connection by choosing a target, enter
  recall mode. Spatial arrangement stays pointer-only.
- Full spatial keyboard editing and screen-reader canvas parity are out of v1.

## Aesthetic

- **Themed surface, modern legibility.** Cork/sepia/oxblood palette, period
  typography reserved for headings and case-file chrome, effects kept in the
  frame and out of the content.
- Period type does not touch body text, menus, or controls; a 90-minute revision
  session on a bright tablet has to stay readable.
- Motion (pins, string draw) respects reduced-motion.
- The precise look is a **prototype question**, not a spec question.

## Success signals

- **Hard gate:** one real exam board survives the full cycle — capture → pin →
  string → recall → export — and the builder would choose it over re-reading
  their notes.
- **Stretch:** 3–5 students each build a case for a real upcoming exam and would
  use it again for the next one. Because the app is local-only with no telemetry,
  this is measured by interview, not dashboards.

## Non-goals for v1

- Public launch, analytics, growth loops, monetization.
- Accounts, cloud sync, collaboration, sharing, classroom features.
- AI-generated cases, quizzes, tags, or suggested connections.
- PDF import; photo annotation; typed study notes; multi-image cards.
- Cross-case card reuse; case duplication; more than one user per install.
- Auto-deletion or archiving of cases after an exam.

## Open questions

1. **Aesthetic reference games.** "Early graphical detective game" has not been
   pinned to specific titles yet. Settle with a one-screen throwaway prototype.
2. **Board, pin, and string feel.** Cork texture, pin styles, string sag — a
   see-it question. Prototype, don't discuss further.
3. **OCR usefulness.** Whether on-device OCR is accurate enough on handwriting to
   justify more than title autofill cannot be answered until it is built.

---

> Rewritten by `/forge-grill-idea` on 2026-10-25 from a grilling session with the
> project owner. Input for: `@workspace /forge-auto-build-prd Use docs/IDEA.md as
> the project idea`. No PRD, agent team, or build has been generated from it yet.
