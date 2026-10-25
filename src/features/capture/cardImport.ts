/**
 * Orchestrates one photo card: validate the selected file, run the local
 * pipeline, then commit the card and its three Blobs in a single repository
 * transaction. Cancellation is honored until the transaction begins; after
 * that the card is durable and the result reports success.
 */

import type { NewAttachment } from '../../data/attachmentStore';
import type { CaseRepositoryPort } from '../../data/caseRepository';
import { DomainValidationError } from '../../domain/validation';
import type { CardPosition, CardRecord, AttachmentRecord, CardType } from '../../domain/model';

import {
  ImageDecodeError,
  isAbortError,
  throwIfAborted,
  inspectImageFile,
  type ImageDecodeOptionsWithoutSignal,
  type ImageDecoder,
  type ImageValidationCode,
  type ImageValidationFailure,
} from './imageValidation';
import {
  ImageProcessingError,
  InvalidImageInputError,
  processImage,
  type BlobDigest,
  type CanvasFactory,
  type CropRect,
  type ImageDerivative,
  type Rotation,
} from './imagePipeline';

/** Image cards are Study Notes and Sources; Topic cards are text-only. */
export type ImageCardType = Extract<CardType, 'note' | 'source'>;

export type ImportImageCardInput = {
  readonly file: File;
  readonly caseId: string;
  readonly type: ImageCardType;
  readonly title: string;
  readonly position: CardPosition;
  readonly tags?: readonly string[];
  /** Normalized 0-1 rectangle of the oriented source. Defaults to the whole image. */
  readonly crop?: CropRect;
  readonly rotation?: Rotation;
  /** Opt in per card to retain the decoded resolution for the original. */
  readonly retainFullResolution?: boolean;
};

export type ImportStage =
  'validating' | 'decoding' | 'transforming' | 'encoding' | 'saving' | 'done';

export type ImportProgress = {
  readonly stage: ImportStage;
};

export type ImportImageCardOptions = {
  /** The repository boundary; only the atomic create method is needed. */
  readonly repository: Pick<CaseRepositoryPort, 'createCardWithAttachments'>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ImportProgress) => void;
  readonly decode?: ImageDecoder;
  readonly decodeOptions?: ImageDecodeOptionsWithoutSignal;
  readonly createCanvas?: CanvasFactory;
  readonly digest?: BlobDigest;
};

export type CardImportFailureCode =
  'invalid-image' | 'unsupported-card-type' | 'invalid-card' | 'processing' | 'storage';

export type CardImportFailure = {
  readonly status: 'failed';
  readonly code: CardImportFailureCode;
  /** Safe to show to a student. Never includes image bytes or OCR text. */
  readonly message: string;
  readonly validationCode?: ImageValidationCode;
  readonly cause?: unknown;
};

export type CardImportOutcome =
  | {
      readonly status: 'imported';
      readonly card: CardRecord;
      readonly attachments: readonly AttachmentRecord[];
    }
  | { readonly status: 'cancelled' }
  | CardImportFailure;

function emit(options: ImportImageCardOptions, stage: ImportStage): void {
  try {
    options.onProgress?.({ stage });
  } catch {
    // Progress is advisory; a UI callback must never corrupt an import.
  }
}

function failure(
  code: CardImportFailureCode,
  message: string,
  extra: { readonly validationCode?: ImageValidationCode; readonly cause?: unknown } = {},
): CardImportFailure {
  return {
    status: 'failed',
    code,
    message,
    ...(extra.validationCode !== undefined ? { validationCode: extra.validationCode } : {}),
    ...(extra.cause !== undefined ? { cause: extra.cause } : {}),
  };
}

function failureFromValidation(validation: ImageValidationFailure): CardImportFailure {
  return failure('invalid-image', validation.message, { validationCode: validation.code });
}

function isImageCardType(type: string): type is ImageCardType {
  return type === 'note' || type === 'source';
}

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

/**
 * Validate, process, and atomically persist one photo card.
 *
 * The returned failure is exhaustive: invalid input, an unsupported card type,
 * a processing failure, or a storage failure. A cancel returns `cancelled` and
 * guarantees that no card, attachment, or object URL survives the call.
 */
export async function importImageCard(
  input: ImportImageCardInput,
  options: ImportImageCardOptions,
): Promise<CardImportOutcome> {
  let phase: 'processing' | 'saving' = 'processing';

  try {
    if (!isImageCardType(input.type)) {
      return failure(
        'unsupported-card-type',
        'Only Study Note and Source cards can use a photo. Create a Topic card from text.',
      );
    }

    throwIfAborted(options.signal);
    emit(options, 'validating');

    const inspection = await inspectImageFile(
      input.file,
      options.signal !== undefined ? { signal: options.signal } : {},
    );
    if (!inspection.ok) {
      return failureFromValidation(inspection);
    }

    throwIfAborted(options.signal);

    const processed = await processImage(input.file, {
      sourceMime: inspection.mime,
      ...(input.crop !== undefined ? { crop: input.crop } : {}),
      ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
      ...(input.retainFullResolution !== undefined
        ? { retainFullResolution: input.retainFullResolution }
        : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.decode !== undefined ? { decode: options.decode } : {}),
      ...(options.decodeOptions !== undefined ? { decodeOptions: options.decodeOptions } : {}),
      ...(options.createCanvas !== undefined ? { createCanvas: options.createCanvas } : {}),
      ...(options.digest !== undefined ? { digest: options.digest } : {}),
      onProgress: (stage) => emit(options, stage),
    });

    throwIfAborted(options.signal);

    emit(options, 'saving');
    // A cancel requested while the saving state was being announced must still
    // win: nothing has been written until the repository call below.
    throwIfAborted(options.signal);

    phase = 'saving';
    const result = await options.repository.createCardWithAttachments(
      {
        caseId: input.caseId,
        type: input.type,
        title: input.title,
        position: input.position,
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      },
      [
        toNewAttachment(processed.original),
        toNewAttachment(processed.display),
        toNewAttachment(processed.thumbnail),
      ],
    );

    emit(options, 'done');
    return {
      status: 'imported',
      card: result.card,
      attachments: result.attachments,
    };
  } catch (error) {
    if (isAbortError(error)) {
      return { status: 'cancelled' };
    }

    if (error instanceof DomainValidationError) {
      return failure('invalid-card', 'Check the card details and try again.', { cause: error });
    }

    if (error instanceof ImageDecodeError) {
      return failure('invalid-image', 'That image could not be read. Try another photo.', {
        validationCode: 'corrupt-image',
        cause: error,
      });
    }

    if (error instanceof InvalidImageInputError) {
      return failureFromValidation(error.validation);
    }

    if (error instanceof ImageProcessingError) {
      return failure(phase === 'saving' ? 'storage' : 'processing', error.message, {
        cause: error,
      });
    }

    if (phase === 'saving') {
      return failure('storage', 'The card could not be saved. Try again.', { cause: error });
    }

    return failure('processing', 'The image could not be prepared. Try another photo.', {
      cause: error,
    });
  }
}
