import type {
  DemoCanvas,
  DemoCanvas2DContext,
  DemoCanvasFactory,
} from '../../src/features/demo/demoImages';

/**
 * A tiny drawing surface for tests. It records text so a test can prove the
 * four pages were actually drawn locally, then encodes a deterministic Blob
 * whose bytes differ by page and derivative size.
 */
export class FakeDemoContext implements DemoCanvas2DContext {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  readonly texts: string[] = [];

  fillRect(): void {}
  strokeRect(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  fill(): void {}
  stroke(): void {}

  fillText(text: string): void {
    this.texts.push(text);
  }
}

export class FakeDemoCanvas implements DemoCanvas {
  width: number;
  height: number;
  readonly context = new FakeDemoContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(): DemoCanvas2DContext {
    return this.context;
  }

  async convertToBlob(options?: {
    readonly type?: string;
    readonly quality?: number;
  }): Promise<Blob> {
    const type = options?.type ?? 'image/png';
    const text = this.context.texts.join('|');
    return new Blob([`demo:${this.width}x${this.height}:${text}`], { type });
  }
}

/** Mimics HTMLCanvasElement: it exposes toBlob but no convertToBlob. */
export class LegacyDemoCanvas implements DemoCanvas {
  width: number;
  height: number;
  readonly context = new FakeDemoContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(): DemoCanvas2DContext {
    return this.context;
  }

  toBlob(callback: (blob: Blob | null) => void, type = 'image/png'): void {
    callback(
      new Blob([`demo:${this.width}x${this.height}:${this.context.texts.join('|')}`], { type }),
    );
  }
}

/** A drawing surface with neither encoder, like a stripped-down test canvas. */
export class UnencodableDemoCanvas implements DemoCanvas {
  width: number;
  height: number;
  readonly context = new FakeDemoContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(): DemoCanvas2DContext {
    return this.context;
  }
}

/** A canvas whose 2D context cannot be created. */
export class ContextlessDemoCanvas implements DemoCanvas {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(): null {
    return null;
  }
}

export type FakeCanvasHarness = {
  readonly factory: DemoCanvasFactory;
  readonly canvases: FakeDemoCanvas[];
};

export function fakeDemoCanvasHarness(): FakeCanvasHarness {
  const canvases: FakeDemoCanvas[] = [];
  const factory: DemoCanvasFactory = (width, height) => {
    const canvas = new FakeDemoCanvas(width, height);
    canvases.push(canvas);
    return canvas;
  };
  return { factory, canvases };
}

export type MemoryStorage = Pick<Storage, 'getItem' | 'setItem'> & {
  readonly values: Map<string, string>;
};

/** Stand-in for localStorage that a test can share across simulated reloads. */
export function createMemoryStorage(): MemoryStorage {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
  };
}
