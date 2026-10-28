/**
 * The card form shown after the crop step.
 *
 * The card type is chosen here once; later screens may edit the title but never
 * convert a Source into a Study Note. The full-resolution opt-in is off by
 * default and always explains the storage cost before it is enabled.
 */

import { useRef, useState } from 'react';
import type { FormEvent } from 'react';

import Button from '../../components/Button';
import Field from '../../components/Field';
import { CARD_DETAILS_MAX_LENGTH, TITLE_MAX_LENGTH } from '../../domain/model';
import type { OcrImage, OcrResult } from '../ocr/ocrWorker';
import OcrPanel from '../ocr/OcrPanel';
import TagInput from '../search/TagInput';

import type { ImageCardType } from './cardImport';

import './capture.css';

export type NoteSourceValues = {
  readonly type: Extract<ImageCardType, 'note' | 'source'>;
  readonly title: string;
  readonly details?: string;
  readonly retainFullResolution: boolean;
  /** Omitted when the card has no tags, so existing callers stay unchanged. */
  readonly tags?: readonly string[];
  /** Optional OCR run against the pending photo; saved with the new card. */
  readonly ocr?: OcrResult;
};

export interface NoteSourceFormProps {
  readonly initialType?: Extract<ImageCardType, 'note' | 'source'>;
  readonly initialTitle?: string;
  readonly initialDetails?: string;
  /** Tags restored when the student steps back to this form after a failure. */
  readonly initialTags?: readonly string[];
  /** The cropped/pending photo; OCR is offered but never started automatically. */
  readonly image?: OcrImage | null;
  /** Returns to the crop step without creating a card. */
  readonly onBack: () => void;
  readonly onSubmit: (values: NoteSourceValues) => void;
}

function trimTitle(title: string): string {
  return title.trim();
}

export default function NoteSourceForm({
  initialType = 'note',
  initialTitle = '',
  initialDetails = '',
  initialTags = [],
  image = null,
  onBack,
  onSubmit,
}: NoteSourceFormProps) {
  const [type, setType] = useState<Extract<ImageCardType, 'note' | 'source'>>(initialType);
  const [title, setTitle] = useState(initialTitle);
  const [details, setDetails] = useState(initialDetails);
  const [tags, setTags] = useState<readonly string[]>(initialTags);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [retainFullResolution, setRetainFullResolution] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const resolutionHintId = 'capture-full-resolution-hint';
  const resolutionLabelId = 'capture-full-resolution-label';

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const trimmed = trimTitle(title);

    if (trimmed.length === 0) {
      setTitleError('Enter a title for this card.');
      titleRef.current?.focus();
      return;
    }

    if (trimmed.length > TITLE_MAX_LENGTH) {
      setTitleError(`Titles can be at most ${TITLE_MAX_LENGTH} characters.`);
      titleRef.current?.focus();
      return;
    }

    setTitleError(null);
    onSubmit({
      type,
      title: trimmed,
      ...(type === 'note' && details.trim().length > 0 ? { details: details.trim() } : {}),
      retainFullResolution,
      ...(tags.length > 0 ? { tags } : {}),
      ...(ocrResult !== null ? { ocr: ocrResult } : {}),
    });
  }

  return (
    <section className="capture-form" aria-labelledby="capture-note-form-title">
      <div className="capture-form__heading">
        <h3 id="capture-note-form-title">Name the card</h3>
        <p>
          The cropped photo is attached when you save. The card type is fixed at creation so later
          connections keep the same evidence.
        </p>
      </div>

      <form className="capture-form__form" onSubmit={handleSubmit} noValidate>
        <Field
          label="Card type"
          hint="Study Note and Source both use this one photo. The type cannot change after saving."
          required
        >
          {(control) => (
            <select
              {...control}
              name="type"
              value={type}
              onChange={(event) => {
                setType(event.currentTarget.value === 'source' ? 'source' : 'note');
              }}
            >
              <option value="note">Study Note</option>
              <option value="source">Source</option>
            </select>
          )}
        </Field>

        <Field
          label="Title"
          hint={`1 to ${TITLE_MAX_LENGTH} characters. You can edit the title later.`}
          error={titleError}
          required
        >
          {(control) => (
            <input
              {...control}
              ref={titleRef}
              type="text"
              name="title"
              value={title}
              autoComplete="off"
              maxLength={TITLE_MAX_LENGTH}
              onChange={(event) => {
                setTitle(event.currentTarget.value);
                setTitleError(null);
              }}
            />
          )}
        </Field>

        <TagInput
          value={tags}
          onChange={setTags}
          label="Tags"
          hint="Optional. Type a tag and press Enter or comma to add it. Backspace removes the last tag."
        />

        {type === 'note' ? (
          <Field
            label="Additional notes"
            hint={`Optional. Add context or extra information, up to ${CARD_DETAILS_MAX_LENGTH} characters.`}
          >
            {(control) => (
              <textarea
                {...control}
                name="details"
                value={details}
                maxLength={CARD_DETAILS_MAX_LENGTH}
                rows={4}
                onChange={(event) => setDetails(event.currentTarget.value)}
              />
            )}
          </Field>
        ) : null}

        <OcrPanel
          image={image}
          title={title}
          headingLevel={4}
          onTitleChange={(nextTitle) => {
            setTitle(nextTitle);
            setTitleError(null);
          }}
          onResultChange={setOcrResult}
        />

        <label className="capture-toggle" htmlFor="capture-keep-full-resolution">
          <input
            id="capture-keep-full-resolution"
            className="capture-toggle__input"
            type="checkbox"
            name="retainFullResolution"
            checked={retainFullResolution}
            aria-labelledby={resolutionLabelId}
            aria-describedby={resolutionHintId}
            onChange={(event) => setRetainFullResolution(event.currentTarget.checked)}
          />
          <span className="capture-toggle__body">
            <span className="capture-toggle__label" id={resolutionLabelId}>
              Keep full resolution
            </span>
            <span className="capture-toggle__hint" id={resolutionHintId}>
              Off by default. Keeping the full imported resolution stores a larger original image
              and uses more of this device&apos;s storage.
            </span>
          </span>
        </label>

        <div className="capture-form__actions">
          <Button variant="quiet" onClick={onBack}>
            Back to crop
          </Button>
          <Button className="capture-form__submit" variant="primary" type="submit">
            Save card
          </Button>
        </div>
      </form>
    </section>
  );
}
