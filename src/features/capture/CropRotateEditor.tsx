/**
 * Touch and keyboard crop/rotate editor.
 *
 * The component owns presentation state only. It never reads or writes storage,
 * never creates or revokes an object URL, and never touches the retained
 * original. `onSave` receives a normalized source-frame crop plus an exact
 * quarter-turn rotation; the caller decides whether to run the image pipeline,
 * regenerate derivatives, or persist anything.
 */

import { useId, useState } from 'react';
import Cropper, {
  getInitialCropFromCroppedAreaPercentages,
  type Area,
  type MediaSize,
  type Point,
  type Size as CropperSize,
} from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';

import Button from '../../components/Button';
import IconButton from '../../components/IconButton';

import {
  clampCropRect,
  cropFromRotated,
  cropRectsEqual,
  cropToRotated,
  DEFAULT_NUDGE_STEP,
  describeCrop,
  FULL_CROP,
  normalizeCropRect,
  normalizeRotation,
  rotateLeft,
  rotateRight,
  rotatedAspectRatio,
  translateCropRect,
  type CropNudgeDirection,
  type CropRect,
  type Rotation,
} from './cropMath';

import './crop.css';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const KEYBOARD_STEP_PX = 12;

export interface CropResult {
  /** Normalized 0-1 rectangle of the oriented source image. */
  readonly crop: CropRect;
  readonly rotation: Rotation;
}

export interface CropRotateEditorProps {
  /** Display URL or object URL owned by the caller; the editor never revokes it. */
  readonly imageSrc: string;
  /** Oriented source width in pixels, before crop and rotation. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Initial crop in the source orientation. Defaults to the whole image. */
  readonly initialCrop?: Partial<CropRect>;
  /** Initial clockwise rotation. Defaults to upright. */
  readonly initialRotation?: number;
  /**
   * Frame aspect ratio. Defaults to the initial crop's aspect and swaps for a
   * quarter turn so a full-frame selection stays whole. Passing a number pins
   * the frame (for example `1` for a square crop).
   */
  readonly aspect?: number;
  /** Normalized step for each keyboard nudge. Defaults to 2%. */
  readonly nudgeStep?: number;
  readonly title?: string;
  readonly imageAlt?: string;
  readonly saveLabel?: string;
  readonly onSave: (result: CropResult) => void;
  readonly onCancel: () => void;
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeCrop(input: Partial<CropRect> | undefined): CropRect {
  if (input === undefined) {
    return FULL_CROP;
  }

  try {
    return clampCropRect(input);
  } catch {
    return FULL_CROP;
  }
}

function percentArea(crop: CropRect): Area {
  return {
    x: crop.x * 100,
    y: crop.y * 100,
    width: crop.width * 100,
    height: crop.height * 100,
  };
}

function summaryFor(area: CropRect, rotation: Rotation): string {
  try {
    return describeCrop(cropFromRotated(area, rotation), rotation);
  } catch {
    return describeCrop(FULL_CROP, rotation);
  }
}

export default function CropRotateEditor({
  imageSrc,
  sourceWidth,
  sourceHeight,
  initialCrop,
  initialRotation = 0,
  aspect: aspectProp,
  nudgeStep = DEFAULT_NUDGE_STEP,
  title = 'Crop and rotate',
  imageAlt = 'Photo to crop and rotate',
  saveLabel = 'Save crop',
  onSave,
  onCancel,
}: CropRotateEditorProps) {
  const [initial] = useState(() => {
    let rotation: Rotation = 0;
    try {
      rotation = normalizeRotation(initialRotation);
    } catch {
      // A bad initial prop must not block the photo; fall back to upright.
    }

    const crop = safeCrop(initialCrop);
    const width = positiveOr(sourceWidth, 1);
    const height = positiveOr(sourceHeight, 1);
    const area = cropToRotated(crop, rotation);
    const baseAspect = (crop.width * width) / (crop.height * height);
    const aspect = rotatedAspectRatio(baseAspect, rotation);

    return { rotation, area, areaPercent: percentArea(area), baseAspect, aspect };
  });

  const [rotation, setRotation] = useState<Rotation>(initial.rotation);
  const [frameAspect, setFrameAspect] = useState(initial.aspect);
  const [area, setArea] = useState<CropRect>(initial.area);
  const [cropPosition, setCropPosition] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null);
  const [cropSize, setCropSize] = useState<CropperSize | null>(null);

  const titleId = useId();
  const instructionsId = useId();
  const summaryId = useId();

  const fixedAspect =
    aspectProp !== undefined && Number.isFinite(aspectProp) && aspectProp > 0
      ? aspectProp
      : undefined;
  const aspect = fixedAspect ?? frameAspect;
  const step = Number.isFinite(nudgeStep) && nudgeStep > 0 ? nudgeStep : DEFAULT_NUDGE_STEP;
  const summary = summaryFor(area, rotation);

  function handleCropComplete(next: Area): void {
    try {
      const clamped = clampCropRect({
        x: next.x / 100,
        y: next.y / 100,
        width: next.width / 100,
        height: next.height / 100,
      });
      // Both callbacks can report the same area; keep one render per change.
      setArea((current) => (cropRectsEqual(current, clamped) ? current : clamped));
    } catch {
      // A transient zero-size area is emitted while the cropper is measured;
      // keep the last stable selection instead of blanking the editor.
    }
  }

  function nudge(direction: CropNudgeDirection): void {
    const dx = direction === 'left' ? -step : direction === 'right' ? step : 0;
    const dy = direction === 'up' ? -step : direction === 'down' ? step : 0;
    let next: CropRect;

    try {
      next = translateCropRect(area, dx, dy);
    } catch {
      return;
    }

    setArea(next);

    if (mediaSize === null || cropSize === null) {
      return;
    }

    try {
      const positioned = getInitialCropFromCroppedAreaPercentages(
        percentArea(next),
        mediaSize,
        rotation,
        cropSize,
        MIN_ZOOM,
        MAX_ZOOM,
      );
      setCropPosition(positioned.crop);
      setZoom(positioned.zoom);
    } catch {
      // The optimistic area keeps the keyboard path usable even if the
      // cropper cannot be repositioned in this frame.
    }
  }

  function changeRotation(next: Rotation): void {
    setRotation(next);

    if (fixedAspect === undefined) {
      setFrameAspect(rotatedAspectRatio(initial.baseAspect, next));
    }
  }

  function reset(): void {
    // Reset returns to the selection the editor opened with. At import that is
    // the whole image; from card detail it is the card's stored crop.
    setRotation(initial.rotation);
    setArea(initial.area);

    if (fixedAspect === undefined) {
      setFrameAspect(initial.aspect);
    }

    if (mediaSize === null || cropSize === null) {
      setCropPosition({ x: 0, y: 0 });
      setZoom(MIN_ZOOM);
      return;
    }

    try {
      const positioned = getInitialCropFromCroppedAreaPercentages(
        initial.areaPercent,
        mediaSize,
        initial.rotation,
        cropSize,
        MIN_ZOOM,
        MAX_ZOOM,
      );
      setCropPosition(positioned.crop);
      setZoom(positioned.zoom);
    } catch {
      setCropPosition({ x: 0, y: 0 });
      setZoom(MIN_ZOOM);
    }
  }

  function save(): void {
    let crop: CropRect;

    try {
      crop = normalizeCropRect(cropFromRotated(area, rotation));
    } catch {
      crop = { ...FULL_CROP };
    }

    onSave({ crop, rotation });
  }

  return (
    <section className="nd-crop" aria-labelledby={titleId} data-rotation={rotation}>
      <div className="nd-crop__header">
        <h2 id={titleId} className="nd-crop__title">
          {title}
        </h2>
        <p id={instructionsId} className="nd-crop__hint">
          Drag the photo to position it. Pinch or use the mouse wheel to zoom. Rotate in 90° steps,
          then save the selection.
        </p>
      </div>

      <div className="nd-crop__stage">
        <Cropper
          image={imageSrc}
          crop={cropPosition}
          zoom={zoom}
          rotation={rotation}
          aspect={aspect}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          cropShape="rect"
          showGrid={false}
          zoomSpeed={1}
          restrictPosition
          keyboardStep={KEYBOARD_STEP_PX}
          disableAutomaticStylesInjection
          initialCroppedAreaPercentages={initial.areaPercent}
          mediaProps={{ alt: imageAlt, draggable: false }}
          cropperProps={{
            role: 'group',
            'aria-label': 'Crop area',
            'aria-describedby': `${instructionsId} ${summaryId}`,
          }}
          classes={{
            containerClassName: 'nd-crop__cropper',
            cropAreaClassName: 'nd-crop__area',
          }}
          onCropChange={setCropPosition}
          onZoomChange={setZoom}
          onCropComplete={handleCropComplete}
          onCropAreaChange={handleCropComplete}
          onMediaLoaded={setMediaSize}
          onCropSizeChange={setCropSize}
        />
      </div>

      <div className="nd-crop__toolbar" role="group" aria-label="Rotate and reset">
        <Button
          variant="secondary"
          onClick={() => changeRotation(rotateLeft(rotation))}
          leadingIcon="↺"
          aria-label="Rotate left 90 degrees"
        >
          Rotate left
        </Button>
        <Button
          variant="secondary"
          onClick={() => changeRotation(rotateRight(rotation))}
          leadingIcon="↻"
          aria-label="Rotate right 90 degrees"
        >
          Rotate right
        </Button>
        <Button variant="quiet" onClick={reset}>
          Reset
        </Button>
      </div>

      <fieldset className="nd-crop__nudge">
        <legend>Nudge crop</legend>
        <div className="nd-crop__nudge-pad">
          <IconButton
            label="Nudge crop up"
            className="nd-crop__nudge--up"
            onClick={() => nudge('up')}
          >
            ↑
          </IconButton>
          <IconButton
            label="Nudge crop left"
            className="nd-crop__nudge--left"
            onClick={() => nudge('left')}
          >
            ←
          </IconButton>
          <IconButton
            label="Nudge crop down"
            className="nd-crop__nudge--down"
            onClick={() => nudge('down')}
          >
            ↓
          </IconButton>
          <IconButton
            label="Nudge crop right"
            className="nd-crop__nudge--right"
            onClick={() => nudge('right')}
          >
            →
          </IconButton>
        </div>
        <p className="nd-crop__nudge-hint">
          Each press moves the selection by {Math.round(step * 100)}%. You can also focus the crop
          area and use the arrow keys; hold Shift for a finer step.
        </p>
      </fieldset>

      <p
        id={summaryId}
        className="nd-crop__summary"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {summary}
      </p>

      <div className="nd-crop__actions">
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save}>
          {saveLabel}
        </Button>
      </div>
    </section>
  );
}
