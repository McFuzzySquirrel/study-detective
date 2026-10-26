/**
 * Text-only topic creation.
 *
 * A topic never renders a file control and never calls the image pipeline. It
 * exists so a student can name a theme before or after attaching evidence, and
 * it shares the same 1–80 character title contract as every other card.
 */

import { useRef, useState } from 'react';
import type { FormEvent } from 'react';

import Button from '../../components/Button';
import Field from '../../components/Field';
import { TITLE_MAX_LENGTH } from '../../domain/model';
import TagInput from '../search/TagInput';

import './capture.css';

export type TopicFormValues = {
  readonly title: string;
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
    onSubmit({ title: trimmed, ...(tags.length > 0 ? { tags } : {}) });
  }

  return (
    <section className="capture-form" aria-labelledby="capture-topic-form-title">
      <div className="capture-form__heading">
        <h3 id="capture-topic-form-title">Add a topic</h3>
        <p>
          A topic is a text-only card for a theme, question, or heading. It has no photo and never
          asks for one.
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
