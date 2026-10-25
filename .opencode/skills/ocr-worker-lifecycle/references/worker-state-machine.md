# Worker state machine

Use this reference for the OCR hook, timeout, cancellation, storage, and title suggestion.

## States

| State | Enter when | UI |
|-------|------------|----|
| `idle` | Panel opens, no job | Read text action, off-by-default explanation |
| `loading-engine` | Job starts, assets load | Indeterminate progress, Cancel |
| `reading` | Worker ready and recognizing | Indeterminate progress, Cancel |
| `done` | Result received and persisted | Text, confidence, engine version, Run again, Clear OCR |
| `failed` | Decode/asset/worker error | Retry, Cancel/Close, card unchanged |
| `timed-out` | 60 seconds elapsed | Retry, card unchanged |
| `cancelled` | Student cancelled or left | Panel closed or idle; card unchanged |

Only one job may exist. A request while not `idle`/`done`/`failed`/`timed-out` is rejected with a visible busy message and no new worker.

## Lifecycle

```ts
const generation = ++jobGeneration;
setStatus("loading-engine");
const worker = await createWorker("eng", 1, { workerPath, corePath, langPath });
if (generation !== jobGeneration) { await worker.terminate(); return; }
setStatus("reading");
const result = await worker.recognize(image);
if (generation !== jobGeneration) { await worker.terminate(); return; }
// persist only after the generation check
```

- Start a 60-second timer when the job starts; clear it in `finally`.
- On timeout: mark `timed-out`, increment the generation, terminate the worker.
- On cancel/unmount/route change: mark `cancelled`, increment the generation, terminate.
- A late worker event with a stale generation is dropped, never written.
- Close the input bitmap and revoke any object URL in `finally`.
- Never keep a module-level worker across route changes unless it is explicitly idle and terminated on unmount.

## Storage fields

Persist with the card only on success:

```ts
{
  text: string,
  confidence: number,      // 0-100 as reported
  engineVersion: string,   // e.g. "tesseract.js 7.0.0"
  updatedAt: string        // ISO 8601
}
```

`text` is searchable and exported. It is never rendered as HTML. A card without OCR has no `ocr` object, and search treats it as no match.

Run again replaces the stored result after success. Clear OCR requires confirmation and removes the object; it does not touch the title.

## Title suggestion

- If the title is empty: take the first meaningful non-empty OCR line (trim, collapse whitespace, cap at 80 characters), set the title, and announce `Title filled from OCR`.
- If the title is non-empty: show `Suggested title: ...` with `Apply` and `Dismiss`. Apply sets the title to the suggestion and announces it. Dismiss leaves both title and stored OCR text.
- Never auto-apply to a non-empty title, never overwrite an edit made after OCR, and never generate tags, connections, or card types.

## Panel contract

The panel explains that OCR runs on the device and may take several seconds. It shows the current state, confidence, engine version, a selectable text area, `Run again`, and `Clear OCR` (confirmed). Cancel is always available while running. Failure and timeout show Retry and leave the card unchanged.

## Tests

- One-job guard: start, then request again; second rejected, one worker.
- Timeout: fake clock advances 60s; worker terminated; card unchanged.
- Cancel: terminate called; no write.
- Unmount: terminate called; no late write.
- Empty title: filled and announced.
- Non-empty title: unchanged until Apply.
- Clear: removes OCR after confirmation.
- Search: OCR text matches, missing OCR does not throw.
- Backup: OCR metadata round-trips in copy and replace.
