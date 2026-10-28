/**
 * Replace one photo card's image set without changing its identity.
 *
 * The new derivatives are built locally from either the selected file or the
 * card's retained original. Only after the repository commits the new Blobs
 * and card metadata does it remove the previous rows, so a failure can never
 * leave the card without an image or detach its existing connections.
 */

import type { NewAttachment } from '../../data/attachmentStore';
import type { CaseRepositoryPort } from '../../data/caseRepository';
import type { AttachmentMime, AttachmentRecord, CardRecord } from '../../domain/model';

import {
  ImageDecodeError,
  isAbortError,
  throwIfAborted,
  type ImageDecodeOptionsWithoutSignal,
  type ImageDecoder,
} from '../capture/imageValidation';
import {
  FULL_CROP,
  ImageProcessingError,
  InvalidImageInputError,
  normalizeCropRect,
  normalizeRotation,
  processImage,
  type CanvasFactory,
  type CropRect,
  type BlobDigest,
  type ImageDerivative,
  type ProcessedImage,
  type Rotation,
} from '../capture/imagePipeline';

/** Where a replacement image comes from. */
export type CardPhotoSource =
  | { readonly kind: 'file'; readonly file: File }
  | {
      /** The card's retained, uncropped original Blob. */
      readonly kind: 'original';
      readonly blob: Blob;
      readonly mime: AttachmentMime;
    };

export type ReplaceCardPhotoInput = {
  readonly card: Pick<CardRecord, 'id' | 'retainFullResolution'>;
  readonly source: CardPhotoSource;
  /** Normalized source-frame crop. Ignored for a newly selected file. */
  readonly crop?: CropRect;
  readonly rotation?: Rotation;
};

export type ReplaceStage = 'decoding' | 'transforming' | 'encoding' | 'saving' | 'done';

export type ReplaceProgress = {
  readonly stage: ReplaceStage;
};

export type ReplaceCardPhotoOptions = {
  /** The repository boundary; only the atomic replacement method is required. */
  readonly repository: Pick<CaseRepositoryPort, 'replaceCardAttachments'>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ReplaceProgress) => void;
  readonly decode?: ImageDecoder;
  readonly decodeOptions?: ImageDecodeOptionsWithoutSignal;
  readonly createCanvas?: CanvasFactory;
  readonly digest?: BlobDigest;
  /** Injection seam for component tests; defaults to the real local pipeline. */
  readonly process?: typeof processImage;
};

export type ReplaceCardPhotoFailureCode = 'invalid-image' | 'processing' | 'storage';

export type ReplaceCardPhotoFailure = {
  readonly status: 'failed';
  readonly code: ReplaceCardPhotoFailureCode;
  /** Safe to show to a student. Never includes image bytes or image content. */
  readonly message: string;
  readonly cause?: unknown;
};

export type ReplaceCardPhotoOutcome =
  | {
      readonly status: 'replaced';
      readonly card: CardRecord;
      readonly attachments: readonly AttachmentRecord[];
      readonly cleanupPending: boolean;
    }
  | { readonly status: 'cancelled' }
  | ReplaceCardPhotoFailure;

function toNewAttachment(derivative: ImageDerivative): NewAttachment {
  return {
    kind: derivative.kind,
    mime: derivative.mime,
    width: derivative.width,
    height: derivative.height,
    bytes: derivative.bytes,
    sha256: derivative.sha256,
    blob: derivative.blob,
  };
}

function emit(options: ReplaceCardPhotoOptions, stage: ReplaceStage): void {
  try {
    options.onProgress?.({ stage });
  } catch {
    // Progress is advisory; a UI callback must never corrupt the replacement.
  }
}

function failure(
  code: ReplaceCardPhotoFailureCode,
  message: string,
  cause?: unknown,
): ReplaceCardPhotoFailure {
  return {
    status: 'failed',
    code,
    message,
    ...(cause !== undefined ? { cause } : {}),
  };
}

/**
 * Validate, process, and replace the card's original, display, and thumbnail.
 *
 * A cancel before the repository call leaves the card exactly as it was. A
 * failure in decoding, encoding, or the replace transaction keeps the old
 * attachment set; the card ID and every connection row are never modified.
 */
export async function replaceCardPhoto(
  input: ReplaceCardPhotoInput,
  options: ReplaceCardPhotoOptions,
): Promise<ReplaceCardPhotoOutcome> {
  let phase: 'processing' | 'saving' = 'processing';

  try {
    throwIfAborted(options.signal);

    const fromOriginal = input.source.kind === 'original';
    const sourceBlob = fromOriginal ? input.source.blob : input.source.file;
    const crop = fromOriginal ? normalizeCropRect(input.crop ?? FULL_CROP) : FULL_CROP;
    const rotation = fromOriginal ? normalizeRotation(input.rotation ?? 0) : 0;
    const retainFullResolution = input.card.retainFullResolution === true;

    throwIfAborted(options.signal);

    const process = options.process ?? processImage;
    const processed: ProcessedImage = await process(sourceBlob, {
      crop,
      rotation,
      retainFullResolution,
      ...(input.source.kind === 'original' ? { sourceMime: input.source.mime } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.decode !== undefined ? { decode: options.decode } : {}),
      ...(options.decodeOptions !== undefined ? { decodeOptions: options.decodeOptions } : {}),
      ...(options.createCanvas !== undefined ? { createCanvas: options.createCanvas } : {}),
      ...(options.digest !== undefined ? { digest: options.digest } : {}),
      onProgress: (stage) => emit(options, stage),
    });

    throwIfAborted(options.signal);
    emit(options, 'saving');
    throwIfAborted(options.signal);

    phase = 'saving';
    const result = await options.repository.replaceCardAttachments(
      input.card.id,
      [
        toNewAttachment(processed.original),
        toNewAttachment(processed.display),
        toNewAttachment(processed.thumbnail),
      ],
      {
        crop: processed.crop,
        rotation: processed.rotation,
        retainFullResolution: processed.retainFullResolution,
      },
    );

    emit(options, 'done');
    return {
      status: 'replaced',
      card: result.card,
      attachments: result.attachments,
      cleanupPending: result.cleanupPending === true,
    };
  } catch (error) {
    if (isAbortError(error)) {
      return { status: 'cancelled' };
    }

    if (error instanceof ImageDecodeError) {
      return failure(
        'invalid-image',
        'That image could not be read. Choose another JPEG, PNG, WebP, or GIF image.',
        error,
      );
    }

    if (error instanceof InvalidImageInputError) {
      return failure('invalid-image', error.validation.message, error);
    }

    if (error instanceof ImageProcessingError) {
      return failure(phase === 'saving' ? 'storage' : 'processing', error.message, error);
    }

    if (phase === 'saving') {
      return failure('storage', 'The photo could not be replaced. Try again.', error);
    }

    return failure('processing', 'The image could not be prepared. Choose another photo.', error);
  }
}
