import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Area, CropperProps, MediaSize, Size } from 'react-easy-crop';

import CropRotateEditor, { type CropResult } from '../../src/features/capture/CropRotateEditor';
import {
  FULL_CROP,
  cropToRotated,
  normalizeRotation,
  type CropRect,
} from '../../src/features/capture/cropMath';
import {
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveLengthPx,
} from '../helpers/css-contract';

const cropper = vi.hoisted(() => ({
  props: null as CropperProps | null,
  area: { x: 0, y: 0, width: 100, height: 100 },
  initialCropArgs: null as {
    readonly area: Area;
    readonly rotation: number;
    readonly cropSize: Size;
  } | null,
  mediaLoadedCount: 0,
}));

vi.mock('react-easy-crop', async () => {
  const React = await import('react');
  const MEDIA: MediaSize = { width: 800, height: 600, naturalWidth: 800, naturalHeight: 600 };
  const CROP_SIZE: Size = { width: 640, height: 480 };

  function CropperMock(props: CropperProps) {
    cropper.props = props;
    const lastRotation = React.useRef<number | null>(null);

    React.useEffect(() => {
      if (lastRotation.current === null) {
        props.onMediaLoaded?.(MEDIA);
        props.onCropSizeChange?.(CROP_SIZE);
        cropper.mediaLoadedCount += 1;
      }

      if (lastRotation.current !== props.rotation) {
        lastRotation.current = props.rotation;
        props.onCropComplete?.(cropper.area, { x: 0, y: 0, width: 640, height: 480 });
        props.onCropAreaChange?.(cropper.area, { x: 0, y: 0, width: 640, height: 480 });
      }
    }, [props]);

    return React.createElement('div', {
      'data-testid': 'cropper-mock',
      'data-rotation': String(props.rotation),
      'data-crop-x': String(props.crop.x),
      'data-crop-y': String(props.crop.y),
      'data-zoom': String(props.zoom),
      'data-aspect': String(props.aspect),
      tabIndex: 0,
      role: 'group',
      'aria-label': 'Crop area',
    });
  }

  return {
    default: CropperMock,
    getInitialCropFromCroppedAreaPercentages: (
      area: Area,
      _mediaSize: MediaSize,
      rotation: number,
      cropSize: Size,
    ) => {
      cropper.initialCropArgs = { area, rotation, cropSize };
      return { crop: { x: -area.x, y: -area.y }, zoom: 1 };
    },
  };
});

const cropCss = readRepositoryFile('src/features/capture/crop.css');
const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));

function percent(crop: CropRect): Area {
  return {
    x: crop.x * 100,
    y: crop.y * 100,
    width: crop.width * 100,
    height: crop.height * 100,
  };
}

function maxLength(...values: number[]): number {
  return Math.max(...values.filter((value) => Number.isFinite(value)));
}

function expectMinimumTarget(selector: string): void {
  const styles = declarationsFor(cropCss, selector);
  const block = maxLength(
    resolveLengthPx(tokens, styles.get('min-block-size')),
    resolveLengthPx(tokens, styles.get('block-size')),
  );
  const inline = maxLength(
    resolveLengthPx(tokens, styles.get('min-inline-size')),
    resolveLengthPx(tokens, styles.get('inline-size')),
  );

  expect(block, `${selector} block target`).toBeGreaterThanOrEqual(44);
  expect(inline, `${selector} inline target`).toBeGreaterThanOrEqual(44);
}

function expectVisibleFocusRing(selector: string): void {
  const styles = declarationsFor(cropCss, selector);

  expect(styles.get('outline'), `${selector} outline`).toContain('var(--focus-ring-width)');
  expect(styles.get('outline'), `${selector} outline`).toContain('var(--color-focus-ring)');
}

interface RenderOptions {
  readonly first?: Partial<CropRect>;
  readonly rotation?: number;
  readonly aspect?: number;
  readonly sourceWidth?: number;
  readonly sourceHeight?: number;
}

function renderEditor(options: RenderOptions = {}) {
  const onSave = vi.fn<(result: CropResult) => void>();
  const onCancel = vi.fn<() => void>();

  cropper.area =
    options.first === undefined
      ? percent(FULL_CROP)
      : percent(
          cropToRotated(
            { ...FULL_CROP, ...options.first },
            normalizeRotation(options.rotation ?? 0),
          ),
        );

  render(
    <CropRotateEditor
      imageSrc="blob:local-preview"
      sourceWidth={options.sourceWidth ?? 4000}
      sourceHeight={options.sourceHeight ?? 3000}
      {...(options.first !== undefined ? { initialCrop: options.first } : {})}
      {...(options.rotation !== undefined ? { initialRotation: options.rotation } : {})}
      {...(options.aspect !== undefined ? { aspect: options.aspect } : {})}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );

  return { onSave, onCancel };
}

beforeEach(() => {
  cropper.props = null;
  cropper.area = { x: 0, y: 0, width: 100, height: 100 };
  cropper.initialCropArgs = null;
  cropper.mediaLoadedCount = 0;
});

afterEach(() => {
  cleanup();
});

describe('CropRotateEditor', () => {
  it('renders the image on a dark mat with an announced full-frame summary', () => {
    renderEditor();

    expect(screen.getByRole('heading', { name: 'Crop and rotate' })).toBeInTheDocument();
    expect(screen.getByTestId('cropper-mock')).toBeInTheDocument();
    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-rotation', '0');
    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-aspect', String(4000 / 3000));

    const summary = screen.getByRole('status');
    expect(summary).toHaveAttribute('aria-live', 'polite');
    expect(summary).toHaveAttribute('aria-atomic', 'true');
    expect(summary).toHaveTextContent(
      'Crop 100% wide, 100% tall, starting 0% from the left and 0% from the top. Rotation: upright.',
    );
    expect(cropper.mediaLoadedCount).toBe(1);
  });

  it('cycles rotation with keyboard-activated buttons without floating error', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();

    const rotateRight = screen.getByRole('button', { name: 'Rotate right 90 degrees' });
    const rotateLeft = screen.getByRole('button', { name: 'Rotate left 90 degrees' });

    rotateRight.focus();
    expect(rotateRight).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-rotation', '90');
    expect(screen.getByRole('status')).toHaveTextContent('Rotation: 90° clockwise.');

    await user.keyboard('{Enter}{Enter}{Enter}');
    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-rotation', '0');
    expect(screen.getByRole('status')).toHaveTextContent('Rotation: upright.');
    expect(cropper.props?.rotation).toBe(0);

    await user.click(rotateLeft);
    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-rotation', '270');
    expect(screen.getByRole('status')).toHaveTextContent('Rotation: 270° clockwise.');

    for (let index = 0; index < 20; index += 1) {
      await user.click(rotateRight);
    }

    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-rotation', '270');
    expect(cropper.props?.rotation).toBe(270);

    await user.click(rotateRight);
    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-rotation', '0');
    expect(cropper.props?.rotation).toBe(0);
    expect(onSave).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save crop' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0].rotation).toBe(0);
  });

  it('exposes every control in a complete keyboard tab path', async () => {
    const user = userEvent.setup();
    renderEditor();

    const names: string[] = [];

    for (let index = 0; index < 10; index += 1) {
      await user.tab();
      const active = document.activeElement;

      if (active instanceof HTMLElement) {
        names.push(active.getAttribute('aria-label') ?? active.textContent?.trim() ?? '');
      }
    }

    expect(names).toEqual([
      'Crop area',
      'Rotate left 90 degrees',
      'Rotate right 90 degrees',
      'Reset',
      'Nudge crop up',
      'Nudge crop left',
      'Nudge crop down',
      'Nudge crop right',
      'Cancel',
      'Save crop',
    ]);
  });

  it('nudges the crop with keyboard buttons and announces the new position', async () => {
    const user = userEvent.setup();
    const initial: CropRect = Object.freeze({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 });
    const { onSave } = renderEditor({ first: initial });

    expect(screen.getByRole('status')).toHaveTextContent('starting 20% from the left and 20%');
    expect(initial).toEqual({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 });

    const nudgeRight = screen.getByRole('button', { name: 'Nudge crop right' });
    nudgeRight.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('status')).toHaveTextContent('starting 22% from the left and 20%');
    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-crop-x', '-22');
    expect(cropper.initialCropArgs?.area.x).toBe(22);
    expect(cropper.initialCropArgs?.rotation).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Nudge crop down' }));
    expect(screen.getByRole('status')).toHaveTextContent('starting 22% from the left and 22%');
    expect(onSave).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save crop' }));
    const result = onSave.mock.calls[0]?.[0];

    expect(result?.crop.x).toBeCloseTo(0.22, 6);
    expect(result?.crop.y).toBeCloseTo(0.22, 6);
    expect(result?.crop.width).toBe(0.5);
    expect(result?.crop.height).toBe(0.5);
    expect(initial).toEqual({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 });
  });

  it('resets to the crop and rotation the editor opened with', async () => {
    const user = userEvent.setup();
    const initial: CropRect = Object.freeze({ x: 0.4, y: 0.4, width: 0.3, height: 0.3 });
    renderEditor({ first: initial, rotation: 180 });

    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-rotation', '180');
    expect(screen.getByRole('status')).toHaveTextContent('Crop 30% wide, 30% tall');

    await user.click(screen.getByRole('button', { name: 'Rotate right 90 degrees' }));
    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-rotation', '270');

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-rotation', '180');
    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-crop-x', '-30');
    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-crop-y', '-30');
    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-zoom', '1');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Crop 30% wide, 30% tall, starting 40% from the left and 40% from the top. Rotation: 180°.',
    );
    expect(cropper.initialCropArgs?.rotation).toBe(180);
    expect(cropper.initialCropArgs?.area.x).toBe(30);
  });

  it('resets an import-time editor to the full upright image', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Rotate right 90 degrees' }));
    await user.click(screen.getByRole('button', { name: 'Rotate right 90 degrees' }));
    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-rotation', '180');

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-rotation', '0');
    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-zoom', '1');
    expect(screen.getByRole('status')).toHaveTextContent('Rotation: upright.');
    expect(screen.getByRole('status')).toHaveTextContent('Crop 100% wide, 100% tall');
  });

  it('saves the normalized crop and rotation without mutating the source crop', async () => {
    const user = userEvent.setup();
    const initial: CropRect = Object.freeze({ x: 0.1, y: 0.2, width: 0.5, height: 0.5 });
    const { onSave, onCancel } = renderEditor({ first: initial, rotation: 90 });

    cropper.area = percent(cropToRotated(initial, 90));
    await user.click(screen.getByRole('button', { name: 'Save crop' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    const result = onSave.mock.calls[0]?.[0];
    expect(result?.rotation).toBe(90);
    expect(result?.crop.x).toBeCloseTo(0.1, 6);
    expect(result?.crop.y).toBeCloseTo(0.2, 6);
    expect(result?.crop.width).toBeCloseTo(0.5, 6);
    expect(result?.crop.height).toBeCloseTo(0.5, 6);
    expect(Object.keys(result ?? {}).sort()).toEqual(['crop', 'rotation']);
    expect(initial).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.5 });
  });

  it('cancels without saving anything', async () => {
    const user = userEvent.setup();
    const { onSave, onCancel } = renderEditor();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('derives a rotation-aware frame aspect and allows an override', async () => {
    const user = userEvent.setup();
    renderEditor();

    expect(Number(screen.getByTestId('cropper-mock').getAttribute('data-aspect'))).toBeCloseTo(
      4000 / 3000,
      9,
    );

    await user.click(screen.getByRole('button', { name: 'Rotate right 90 degrees' }));
    expect(Number(screen.getByTestId('cropper-mock').getAttribute('data-aspect'))).toBeCloseTo(
      3000 / 4000,
      9,
    );

    await user.click(screen.getByRole('button', { name: 'Rotate right 90 degrees' }));
    expect(Number(screen.getByTestId('cropper-mock').getAttribute('data-aspect'))).toBeCloseTo(
      4000 / 3000,
      9,
    );

    cleanup();
    renderEditor({ rotation: 90 });

    expect(Number(screen.getByTestId('cropper-mock').getAttribute('data-aspect'))).toBeCloseTo(
      3000 / 4000,
      9,
    );

    cleanup();
    renderEditor({ aspect: 1, first: { x: 0, y: 0, width: 1, height: 1 } });

    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-aspect', '1');

    await user.click(screen.getByRole('button', { name: 'Rotate right 90 degrees' }));
    expect(screen.getByTestId('cropper-mock')).toHaveAttribute('data-aspect', '1');
  });
});

describe('crop editor styles', () => {
  it('gives every button and the crop frame a 44px target', () => {
    expectMinimumTarget('.nd-crop .nd-button');
    expectMinimumTarget('.nd-crop .nd-icon-button');
  });

  it('shows a visible focus ring on buttons and the crop frame', () => {
    expectVisibleFocusRing('.nd-crop button:focus-visible');
    expectVisibleFocusRing('.nd-crop__area:focus-visible');
  });

  it('uses the dark mat token and introduces no palette literals', () => {
    expect(declarationsFor(cropCss, '.nd-crop__stage').get('background-color')).toBe(
      'var(--color-canvas-deep)',
    );
    expect(cropCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
