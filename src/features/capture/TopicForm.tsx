/**
 * Topic creation with an optional image.
 */

import { useRef, useState } from 'react';
import type { FormEvent } from 'react';

import Button from '../../components/Button';
import Field from '../../components/Field';
import { TITLE_MAX_LENGTH } from '../../domain/model';
import TagInput from '../search/TagInput';
import { PHOTO_ACCEPT } from './CaptureSourcePicker';

import './capture.css';

export type TopicFormValues = {
  readonly title: string;
  readonly image?: File;
  /** Omitted when the topic has no tags. */
  readonly tags?: readonly string[];
};

export interface TopicFormProps {
  /** Returns to the source picker without creating a topic. */
  readonly onBack: () => void;
  readonly onSubmit: (values: TopicFormValues) => void;
}

export default function TopicForm({ onBack, onSubmit }: TopicFormProps) {
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<readonly string[]>([]);
  const [image, setImage] = useState<File | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const trimmed = title.trim();

    if (trimmed.length === 0) {
      setTitleError('Enter a title for this topic.');
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
      title: trimmed,
      ...(tags.length > 0 ? { tags } : {}),
      ...(image !== null ? { image } : {}),
    });
  }

  return (
    <section className="capture-form" aria-labelledby="capture-topic-form-title">
      <div className="capture-form__heading">
        <h3 id="capture-topic-form-title">Add a topic</h3>
        <p>
          A topic names a theme, question, or heading. Add an image if it helps explain the topic;
          this is optional.
        </p>
      </div>

      <form className="capture-form__form" onSubmit={handleSubmit} noValidate>
        <Field
          label="Topic title"
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
          label="Topic tags"
          hint="Optional. Type a tag and press Enter or comma to add it. Backspace removes the last tag."
        />

        <Field
          label="Topic image"
          hint="Optional. Choose a JPEG, PNG, or WebP image from this device."
        >
          {(control) => (
            <input
              {...control}
              type="file"
              name="image"
              accept={PHOTO_ACCEPT}
              data-testid="topic-image-input"
              onChange={(event) => setImage(event.currentTarget.files?.[0] ?? null)}
            />
          )}
        </Field>
        {image !== null ? (
          <p className="capture-form__file-name" role="status">
            Image selected: {image.name}
          </p>
        ) : null}

        <div className="capture-form__actions">
          <Button variant="quiet" onClick={onBack}>
            Back
          </Button>
          <Button className="capture-form__submit" variant="primary" type="submit">
            Add topic
          </Button>
        </div>
      </form>
    </section>
  );
}
