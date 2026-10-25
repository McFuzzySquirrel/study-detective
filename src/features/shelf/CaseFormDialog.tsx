import { useRef, useState } from 'react';
import type { FormEvent } from 'react';

import Button from '../../components/Button';
import Dialog from '../../components/Dialog';
import Field from '../../components/Field';
import type { CaseSummary } from '../../domain/model';
import { SUBJECT_MAX_LENGTH, TITLE_MAX_LENGTH } from '../../domain/model';
import { isIsoDate } from '../../domain/validation';

import './shelf.css';

export type CaseFormMode = 'create' | 'edit';

/**
 * Normalized values the shelf writes through the repository. `null` means the
 * optional field should be cleared; an omitted field keeps its current value.
 */
export type CaseFormValues = {
  readonly title: string;
  readonly subject: string | null;
  readonly examDate: string | null;
};

export interface CaseFormDialogProps {
  readonly mode: CaseFormMode;
  readonly initialCase?: CaseSummary | undefined;
  readonly onClose: () => void;
  /** Persists the normalized values. A rejection is shown inside the dialog. */
  readonly onSubmit: (values: CaseFormValues) => Promise<void>;
}

type FieldErrors = {
  title?: string;
  subject?: string;
  examDate?: string;
};

function withoutError(errors: FieldErrors, key: keyof FieldErrors): FieldErrors {
  if (errors[key] === undefined) {
    return errors;
  }

  const next: FieldErrors = { ...errors };
  delete next[key];
  return next;
}

/**
 * Validate every field before any write. The title is required and trimmed; the
 * subject and exam date are optional, and emptying either clears it.
 */
function validate(title: string, subject: string, examDate: string): FieldErrors {
  const errors: FieldErrors = {};
  const trimmedTitle = title.trim();
  const trimmedSubject = subject.trim();
  const trimmedDate = examDate.trim();

  if (trimmedTitle.length === 0) {
    errors.title = 'Enter a case title.';
  } else if (trimmedTitle.length > TITLE_MAX_LENGTH) {
    errors.title = `Case titles can be at most ${TITLE_MAX_LENGTH} characters.`;
  }

  if (trimmedSubject.length > SUBJECT_MAX_LENGTH) {
    errors.subject = `Subjects can be at most ${SUBJECT_MAX_LENGTH} characters.`;
  }

  if (trimmedDate.length > 0 && !isIsoDate(trimmedDate)) {
    errors.examDate = 'Enter a valid exam date.';
  }

  return errors;
}

/**
 * Create or edit a case. The dialog owns inline validation and the write error;
 * the shelf owns persistence and the resulting announcement. It is rendered
 * only while open so every open starts from the current values and focus always
 * returns to the trigger that opened it.
 */
export default function CaseFormDialog({
  mode,
  initialCase,
  onClose,
  onSubmit,
}: CaseFormDialogProps) {
  const [title, setTitle] = useState(initialCase?.title ?? '');
  const [subject, setSubject] = useState(initialCase?.subject ?? '');
  const [examDate, setExamDate] = useState(initialCase?.examDate ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const examDateRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (saving) {
      return;
    }

    const nextErrors = validate(title, subject, examDate);
    setErrors(nextErrors);
    setFormError(null);

    if (nextErrors.title !== undefined) {
      titleRef.current?.focus();
      return;
    }
    if (nextErrors.subject !== undefined) {
      subjectRef.current?.focus();
      return;
    }
    if (nextErrors.examDate !== undefined) {
      examDateRef.current?.focus();
      return;
    }

    setSaving(true);

    try {
      await onSubmit({
        title: title.trim(),
        subject: subject.trim().length > 0 ? subject.trim() : null,
        examDate: examDate.trim().length > 0 ? examDate.trim() : null,
      });
      onClose();
    } catch {
      // Keep the typed values so the student can retry without re-entering them.
      setFormError(
        mode === 'create'
          ? 'The case could not be created. Your work is still here; try again.'
          : 'The case could not be saved. Your changes are still here; try again.',
      );
      setSaving(false);
    }
  };

  const dialogTitle = mode === 'create' ? 'Create a case' : 'Edit case';

  return (
    <Dialog
      open
      onClose={onClose}
      title={dialogTitle}
      description={
        mode === 'create'
          ? 'A case holds the notes for one exam. Only the title is required.'
          : 'Changes apply to this case only.'
      }
      dismissible={!saving}
      closeOnBackdrop={!saving}
    >
      <form className="case-form" onSubmit={handleSubmit} noValidate>
        <Field
          label="Case title"
          hint={`1 to ${TITLE_MAX_LENGTH} characters. This is the only required field.`}
          error={errors.title}
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
              onChange={(event) => {
                setTitle(event.target.value);
                setErrors((current) => withoutError(current, 'title'));
                setFormError(null);
              }}
            />
          )}
        </Field>

        <Field
          label="Subject"
          hint={`Optional. Up to ${SUBJECT_MAX_LENGTH} characters, such as the course name.`}
          error={errors.subject}
        >
          {(control) => (
            <input
              {...control}
              ref={subjectRef}
              type="text"
              name="subject"
              value={subject}
              autoComplete="off"
              onChange={(event) => {
                setSubject(event.target.value);
                setErrors((current) => withoutError(current, 'subject'));
                setFormError(null);
              }}
            />
          )}
        </Field>

        <Field
          label="Exam date"
          hint="Optional. The shelf sorts dated cases by the nearest exam first."
          error={errors.examDate}
        >
          {(control) => (
            <input
              {...control}
              ref={examDateRef}
              type="date"
              name="examDate"
              value={examDate}
              onChange={(event) => {
                setExamDate(event.target.value);
                setErrors((current) => withoutError(current, 'examDate'));
                setFormError(null);
              }}
            />
          )}
        </Field>

        {formError !== null ? (
          <p className="case-form__error" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="nd-dialog__actions case-form__actions">
          <Button variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : mode === 'create' ? 'Create case' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
