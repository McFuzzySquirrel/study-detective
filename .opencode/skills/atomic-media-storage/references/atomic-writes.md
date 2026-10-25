# Atomic writes and cleanup

Use this reference when implementing `createCardWithAttachments`, replacement, deletion, or failure injection.

## Create

One read-write transaction writes:

1. `cards` row with the validated card fields and position.
2. `attachments` row `kind: original` with Blob and metadata.
3. `attachments` row `kind: display`.
4. `attachments` row `kind: thumbnail`.

The transaction succeeds only when all four exist. A thrown error rolls back all four. Prefer a single repository method over four awaited calls; four calls are four transactions and four partial states.

## Replace

1. Decode, validate, and build the new Blobs outside the transaction.
2. In one transaction, update the card (`updatedAt`, crop, rotation, full-resolution flag) and write the new original, display, and thumbnail rows.
3. After commit, collect the old attachment IDs and delete their rows and Blobs.
4. Revoke the old object URL after the new image is displayed.
5. Keep the card ID and every connection row untouched.

If the new write fails, the old attachments remain. If the old deletion fails after commit, the card is usable but has extra attachments; a cleanup pass may remove unreferenced rows, but never delete a row referenced by the current card before the new one is durable.

## Re-crop

Re-crop is a replacement with the same source: regenerate the three derivatives from the retained original and commit them as a new attachment set. Do not mutate the original Blob in place; a later reset should be able to return to the uncropped image.

## Delete card and attachments

Deleting a card removes the card, every attachment row and Blob for that card, and every connection whose endpoint is that card in one transaction. Board undo restores the data from the in-memory snapshot within 8 seconds; after the undo window the deletion is final. An undo snapshot includes attachments and connections, not only the card row.

## Abort and error cleanup

- Revoke every object URL on unmount, cancel, decode failure, encode failure, transaction failure, replacement success, and delete.
- Close every `ImageBitmap` in a `finally` block.
- Null out canvas references; do not retain a 30 MB source after the transaction.
- Do not log image bytes, titles, or OCR text.
- A cancelled import returns to the case with no card and no toast that implies success.

## Failure injection tests

Use `fake-indexeddb` and a repository spy that throws inside the transaction. Assert:

- card count unchanged;
- attachment count unchanged;
- connection count unchanged;
- no Blob row exists for the attempted ID;
- a retry can succeed afterward.

Run the same assertions for create and replace. A test that only checks the thrown error does not prove atomicity.
