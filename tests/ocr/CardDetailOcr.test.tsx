import { MemoryRouter, Route, Routes } from 'react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import { DEFAULT_VIEWPORT } from '../../src/domain/model';
import type { CardRecord, CaseRecord } from '../../src/domain/model';
import { OCR_ENGINE_VERSION } from '../../src/features/ocr/ocrAssets';
import { CardDetailPage } from '../../src/features/cards/CardDetailPage';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const CARD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OCR_TEXT = 'CELL BIOLOGY\nMITOCHONDRIA RELEASE ENERGY';
const OCR_UPDATED_AT = '2026-10-26T10:00:00.000Z';

const CASE: CaseRecord = {
  id: CASE_ID,
  title: 'Biology Final',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  viewport: DEFAULT_VIEWPORT,
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

function card(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: CARD_ID,
    caseId: CASE_ID,
    type: 'note',
    title: 'Cell biology',
    position: { x: 40, y: 60 },
    tags: [],
    createdAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
    ocrText: OCR_TEXT,
    ocrConfidence: 95.4,
    ocrEngineVersion: OCR_ENGINE_VERSION,
    ocrUpdatedAt: OCR_UPDATED_AT,
    ...overrides,
  };
}

function renderDetail(repository: InMemoryCaseRepository) {
  return render(
    <MemoryRouter initialEntries={[`/case/${CASE_ID}/card/${CARD_ID}`]}>
      <Routes>
        <Route
          path="/case/:caseId/card/:cardId"
          element={<CardDetailPage repository={repository} />}
        />
        <Route path="/case/:caseId" element={<h2>Case board</h2>} />
        <Route path="/" element={<h2>Case shelf</h2>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('Card detail OCR wiring', () => {
  it('renders stored OCR text, confidence, engine, and timestamp from the repository', async () => {
    const repository = new InMemoryCaseRepository({
      seed: { cases: [CASE], cards: [card()] },
    });
    renderDetail(repository);

    await screen.findByRole('heading', { level: 2, name: 'Cell biology' });
    expect(screen.getByRole('region', { name: 'Read text with OCR' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Extracted OCR text' })).toHaveValue(OCR_TEXT);
    expect(screen.getByText('95%')).toBeInTheDocument();
    expect(screen.getByText(OCR_ENGINE_VERSION)).toBeInTheDocument();
    expect(screen.getByText('Extracted text')).toBeInTheDocument();
    expect(screen.getByText('Confidence')).toBeInTheDocument();
    expect(screen.getByText('Updated')).toBeInTheDocument();
  });

  it('clears stored OCR only after confirmation and persists the removal', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository({
      seed: { cases: [CASE], cards: [card()] },
    });
    renderDetail(repository);

    await screen.findByRole('heading', { level: 2, name: 'Cell biology' });
    const clearTrigger = screen.getByRole('button', { name: 'Clear OCR' });
    await user.click(clearTrigger);

    const dialog = await screen.findByRole('dialog', { name: 'Clear OCR text?' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect((await repository.getCard(CARD_ID))?.ocrText).toBe(OCR_TEXT);
    await waitFor(() => expect(clearTrigger).toHaveFocus());

    await user.click(clearTrigger);
    const confirmDialog = await screen.findByRole('dialog', { name: 'Clear OCR text?' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Clear OCR' }));

    await waitFor(async () => {
      const stored = await repository.getCard(CARD_ID);
      expect(stored).not.toBeNull();
      expect(stored?.ocrText).toBeUndefined();
      expect(stored?.ocrConfidence).toBeUndefined();
      expect(stored?.ocrEngineVersion).toBeUndefined();
      expect(stored?.ocrUpdatedAt).toBeUndefined();
    });

    expect(screen.queryByRole('textbox', { name: 'Extracted OCR text' })).not.toBeInTheDocument();
    expect(screen.getByText('OCR text cleared from this card.')).toBeInTheDocument();
  });

  it('does not offer OCR for a text-only topic card', async () => {
    const repository = new InMemoryCaseRepository({
      seed: { cases: [CASE], cards: [card({ type: 'topic', title: 'Membrane transport' })] },
    });
    renderDetail(repository);

    await screen.findByRole('heading', { level: 2, name: 'Membrane transport' });
    expect(screen.queryByRole('region', { name: 'Read text with OCR' })).not.toBeInTheDocument();
  });
});
