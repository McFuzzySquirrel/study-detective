/**
 * The capture entry point: two native photo controls that share one file path,
 * plus a text-only topic action.
 *
 * The visible buttons are the accessible controls. The file inputs stay hidden
 * from the accessibility tree and keyboard order because the native picker is
 * opened by the button, and both photo buttons deliberately route through the
 * same `onFileSelected` callback so validation and crop cannot diverge.
 */

import { useRef } from 'react';
import type { ChangeEvent } from 'react';

import Button from '../../components/Button';

import './capture.css';

export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

export interface CaptureSourcePickerProps {
  readonly disabled?: boolean;
  /** One selection path for both camera and library photos. */
  readonly onFileSelected: (file: File) => void;
  readonly onAddTopic: () => void;
}

export default function CaptureSourcePicker({
  disabled = false,
  onFileSelected,
  onAddTopic,
}: CaptureSourcePickerProps) {
  const takePhotoRef = useRef<HTMLInputElement>(null);
  const choosePhotoRef = useRef<HTMLInputElement>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const input = event.currentTarget;
    const file = input.files?.[0];

    // Reset immediately so choosing the same photo twice still fires a change.
    input.value = '';

    if (file !== undefined) {
      onFileSelected(file);
    }
  }

  return (
    <section className="capture-source-picker" aria-labelledby="capture-source-picker-title">
      <div className="capture-source-picker__heading">
        <h3 id="capture-source-picker-title">Add evidence</h3>
        <p>
          Photograph a page of notes or choose one from this device. The photo is cropped before it
          is saved, and it never leaves this device.
        </p>
      </div>

      <div className="capture-source-picker__actions">
        <Button
          className="capture-source-picker__action"
          variant="primary"
          size="lg"
          fullWidth
          leadingIcon="◉"
          disabled={disabled}
          onClick={() => takePhotoRef.current?.click()}
        >
          Take photo
        </Button>

        <Button
          className="capture-source-picker__action"
          variant="secondary"
          size="lg"
          fullWidth
          leadingIcon="▣"
          disabled={disabled}
          onClick={() => choosePhotoRef.current?.click()}
        >
          Choose photo
        </Button>

        <Button
          className="capture-source-picker__action"
          variant="secondary"
          size="lg"
          fullWidth
          leadingIcon="✎"
          disabled={disabled}
          onClick={onAddTopic}
        >
          Add topic
        </Button>
      </div>

      <p className="capture-source-picker__note">
        A topic is a text label only. Use it for a theme you want to connect evidence to later; it
        never asks for a photo.
      </p>

      <input
        ref={takePhotoRef}
        className="capture-source-picker__file"
        type="file"
        accept={PHOTO_ACCEPT}
        capture="environment"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        data-testid="capture-take-photo"
        onChange={handleChange}
      />
      <input
        ref={choosePhotoRef}
        className="capture-source-picker__file"
        type="file"
        accept={PHOTO_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        data-testid="capture-choose-photo"
        onChange={handleChange}
      />
    </section>
  );
}
