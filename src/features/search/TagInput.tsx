/**
 * Accessible tag editor for card forms and the card detail screen.
 *
 * Enter and comma add the current draft, Backspace removes the last tag, and
 * every remove control is a 44x44 icon button with a tag-specific name. The
 * live status region stays mounted so duplicate, overlong, and eleventh-tag
 * errors are announced instead of only changing colour.
 */

import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import Field from '../../components/Field';
import IconButton from '../../components/IconButton';
import { MAX_TAGS, addTag, removeTag } from '../../domain/tags';

import './TagInput.css';

export interface TagInputProps {
  /** Committed tags. The parent owns persistence. */
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  /** Visible field label. Defaults to "Tags". */
  readonly label?: string;
  readonly hint?: string;
  /** Stable ID prefix for the label, hints, counter, and status region. */
  readonly id?: string;
  readonly disabled?: boolean;
  /** Accessible name for the committed tag list. */
  readonly listLabel?: string;
  readonly className?: string;
}

type StatusTone = 'info' | 'error';

type Status = {
  readonly message: string;
  readonly tone: StatusTone;
};

const DEFAULT_HINT = `Up to ${MAX_TAGS} tags. Type a tag and press Enter or comma to add it. Backspace removes the last tag.`;

function joinIds(...values: Array<string | undefined>): string | undefined {
  const joined = values.filter((value): value is string => Boolean(value)).join(' ');
  return joined.length > 0 ? joined : undefined;
}

export default function TagInput({
  value,
  onChange,
  label = 'Tags',
  hint = DEFAULT_HINT,
  id,
  disabled = false,
  listLabel = 'Card tags',
  className,
}: TagInputProps) {
  const generatedId = useId();
  const baseId = id ?? `tag-input-${generatedId.replace(/:/g, '')}`;
  const counterId = `${baseId}-counter`;
  const statusId = `${baseId}-status`;

  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const announce = (message: string, tone: StatusTone = 'info'): void => {
    setStatus({ message, tone });
  };

  const commitDraft = (raw: string): void => {
    if (raw.length === 0) {
      return;
    }

    if (raw.trim().length === 0) {
      announce('Enter a tag before adding it.', 'error');
      inputRef.current?.focus();
      return;
    }

    const result = addTag(value, raw);

    if (!result.ok) {
      announce(result.message, 'error');
      inputRef.current?.focus();
      return;
    }

    onChange(result.tags);
    setDraft('');
    announce(`Added “${result.tag}”.`);
  };

  const removeAt = (index: number): void => {
    const removed = value[index];
    if (removed === undefined) {
      return;
    }

    onChange(removeTag(value, index));
    announce(`Removed “${removed}”.`);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === 'Enter' || event.key === ',') {
      // A card form's Enter must add a tag rather than submit the whole form.
      event.preventDefault();
      commitDraft(draft);
      return;
    }

    if (event.key === 'Backspace' && draft.length === 0 && value.length > 0) {
      event.preventDefault();
      const lastIndex = value.length - 1;
      const removed = value[lastIndex];
      onChange(removeTag(value, lastIndex));
      announce(removed !== undefined ? `Removed “${removed}”.` : 'Removed the last tag.');
      return;
    }
  };

  const hasError = status?.tone === 'error';
  const statusMessage = status?.message ?? '';

  return (
    <Field
      id={baseId}
      label={label}
      hint={hint}
      className={className === undefined ? 'tag-input' : `tag-input ${className}`}
    >
      {(control) => (
        <div className="tag-input__body">
          {value.length === 0 ? (
            <p className="tag-input__empty">No tags yet.</p>
          ) : (
            <ul className="tag-input__list" aria-label={listLabel}>
              {value.map((tag, index) => (
                <li className="tag-input__tag" key={tag}>
                  <span className="tag-input__tag-text">{tag}</span>
                  <IconButton
                    className="tag-input__remove"
                    label={`Remove tag ${tag}`}
                    variant="quiet"
                    disabled={disabled}
                    onClick={() => removeAt(index)}
                  >
                    ×
                  </IconButton>
                </li>
              ))}
            </ul>
          )}

          <div className="tag-input__entry">
            <input
              {...control}
              ref={inputRef}
              className={`${control.className} tag-input__field`}
              type="text"
              name="tags"
              value={draft}
              autoComplete="off"
              disabled={disabled}
              aria-invalid={hasError}
              aria-describedby={joinIds(control['aria-describedby'], counterId, statusId)}
              {...(hasError ? { 'aria-errormessage': statusId } : {})}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                if (hasError) {
                  setStatus(null);
                }
              }}
              onKeyDown={handleKeyDown}
            />
            <span className="tag-input__counter" id={counterId}>
              <span aria-hidden="true">
                {value.length}/{MAX_TAGS}
              </span>
              <span className="tag-input__visually-hidden">
                {`${value.length} of ${MAX_TAGS} tags used`}
              </span>
            </span>
          </div>

          <p
            className="tag-input__status"
            id={statusId}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-tone={status?.tone ?? 'none'}
          >
            {statusMessage}
          </p>
        </div>
      )}
    </Field>
  );
}
