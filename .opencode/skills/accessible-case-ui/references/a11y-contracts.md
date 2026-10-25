# Accessibility contracts

Use this reference for every Notes Detective DOM surface.

## Targets and contrast

| Element | Minimum | Notes |
|---------|---------|-------|
| Buttons, links, icon buttons | 44x44 CSS px | Expanded hit area counts; visual size may be smaller |
| Tag remove, crop nudge, sheet handle | 44x44 | Do not shrink on phone |
| Body and control text | 4.5:1 | Includes placeholder and helper text that carries meaning |
| Large headings | 3:1 | 24px regular or 18.66px bold and above |
| Focus indicator | Visible | At least a 2px ring or equivalent contrast against both surfaces |

Use semantic CSS custom properties for color, spacing, type, radius, and motion. A raw hex value in a component is a token-contract violation.

## Dialog contract

- Rendered in a portal at the app root, with `role="dialog"` and `aria-modal="true"` (or native `<dialog>`).
- `aria-labelledby` points at the title; `aria-describedby` points at the consequence or instruction when needed.
- Initial focus goes to the first input or the primary action, not the close button.
- Tab and Shift+Tab cycle inside; Escape cancels; a backdrop click may cancel only for non-destructive dialogs.
- On close, restore focus to the trigger. If the trigger no longer exists, focus the heading or the nearest logical action.
- A destructive confirmation names the object and the exact consequence (cards, strings, images); no undo is claimed when none exists.
- Prevent background scroll and inert the rest of the app while open; remove both on unmount.

## Sheet contract

A phone sheet uses the same semantics and focus behavior as a dialog. It appears below 600px for side panels, search, and secondary actions. It has a visible title, a close action, safe-area bottom padding, and a maximum height that scrolls its content rather than the page.

## Toast and live regions

Keep one polite live region and, for errors, one assertive region mounted at the app root. Update text content; do not remount the region with the message. Announce:

- save success and failure,
- validation errors with the field name,
- delete confirmation results and undo availability,
- result counts and no-result explanations,
- OCR status changes and suggested-title application,
- recall check summary counts.

Undo must be reachable by keyboard within its 8-second window; a toast that disappears before focus reaches it is not an undo path.

## Fields

Every input has a visible label. Helper text and errors use `aria-describedby`; invalid fields use `aria-invalid`. Group radio and checkbox sets in `fieldset`/`legend`. Validate inline on blur or submit, not on every keystroke in a way that interrupts typing. Errors are announced and focus moves to the first invalid field on submit.

## Motion

Default to the system `prefers-reduced-motion` value and allow an explicit install-level override that persists. When reduced motion is active, remove:

- pin drop and card lift scaling,
- string draw animation,
- auto-pan and fit animation,
- page and sheet transitions,
- pulsing or shimmer indicators,
- hover transforms that move layout.

Keep the final state, the gesture, and focus changes. The override applies immediately without reload.

## Plain text

Titles, subjects, tags, OCR text, archive manifest fields, filenames, and error messages derived from them are untrusted text. Render through React text nodes. No `dangerouslySetInnerHTML`, no HTML string concatenation, no `innerHTML` for imported content. If a rich formatting need appears, render structured React nodes from validated fields.

## Responsive matrix

| Viewport | Layout |
|----------|--------|
| 390x844 phone | One column; side panels become bottom sheets; board toolbar collapses to one trigger; safe-area insets |
| 768x1024 tablet portrait | Two-region layout where useful; sheets still available |
| 1280x800 tablet landscape | Primary arranging target; closure panel and board controls visible |
| 1440x900 desktop | Same capability, wider gutters; no fixed widths that force overflow |

No screen except the board's own pan surface may cause page-level horizontal scrolling. Long tags, titles, and OCR snippets wrap or truncate with an accessible full value.
