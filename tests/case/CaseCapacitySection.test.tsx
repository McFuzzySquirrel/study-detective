import { MemoryRouter, Route, Routes } from 'react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MAX_BOARD_CARDS,
  canAddCard,
  remainingCardCapacity,
  boardCapacityLevel,
  splitCaseMessage,
} from '../../src/board/boardCapacity';
import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import type { CardRecord, CaseRecord } from '../../src/domain/model';
import { CapturePage } from '../../src/features/capture/CapturePage';
import CaseCapacitySection from '../../src/features/case/CaseCapacitySection';

const CASE_ID = '11111111-1111-4111-8111-111111111111';

const CASE: CaseRecord = {
  id: CASE_ID,
  title: 'Tudor England',
  subject: 'History',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  viewport: { x: 0, y: 0, scale: 1 },
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

function cardId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function makeCard(index: number): CardRecord {
  return {
    id: cardId(index),
    caseId: CASE_ID,
    type: 'note',
    title: `Card ${index}`,
    position: { x: (index % 10) * 300, y: Math.floor(index / 10) * 360 },
    tags: [],
    createdAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
  };
}

function makeRepository(cardCount: number): InMemoryCaseRepository {
  return new InMemoryCaseRepository({
    seed: {
      cases: [CASE],
      cards: Array.from({ length: cardCount }, (_value, index) => makeCard(index)),
    },
  });
}

function renderSection(cardCount: number) {
  return render(
    <MemoryRouter>
      <CaseCapacitySection cardCount={cardCount} />
    </MemoryRouter>,
  );
}

function renderCapture(repository: InMemoryCaseRepository) {
  return render(
    <MemoryRouter initialEntries={[`/case/${CASE_ID}/capture`]}>
      <Routes>
        <Route path="/case/:caseId/capture" element={<CapturePage repository={repository} />} />
        <Route path="/case/:caseId" element={<h2>Case board</h2>} />
        <Route path="/" element={<h2>Case shelf</h2>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('board capacity guard', () => {
  it('classifies the documented thresholds and never blocks below 200', () => {
    expect(boardCapacityLevel(0)).toBe('normal');
    expect(boardCapacityLevel(119)).toBe('normal');
    expect(boardCapacityLevel(120)).toBe('soft');
    expect(boardCapacityLevel(149)).toBe('soft');
    expect(boardCapacityLevel(150)).toBe('persistent');
    expect(boardCapacityLevel(199)).toBe('persistent');
    expect(boardCapacityLevel(200)).toBe('blocked');

    expect(canAddCard(0)).toBe(true);
    expect(canAddCard(119)).toBe(true);
    expect(canAddCard(150)).toBe(true);
    expect(canAddCard(199)).toBe(true);
    expect(canAddCard(200)).toBe(false);
    expect(canAddCard(201)).toBe(false);

    expect(remainingCardCapacity(199)).toBe(1);
    expect(remainingCardCapacity(200)).toBe(0);
    expect(splitCaseMessage()).toContain('200 cards');
  });
});

describe('CaseCapacitySection', () => {
  it('renders nothing below 120 cards', () => {
    const { container } = renderSection(119);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows a dismissible soft warning at 120 cards', () => {
    renderSection(120);

    const warning = screen.getByRole('status');
    expect(warning).toHaveAttribute('data-card-capacity', 'soft');
    expect(warning).toHaveTextContent('This case is getting large (120)');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss warning' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a persistent warning at 150 cards with no dismiss control', () => {
    renderSection(150);

    const warning = screen.getByRole('status');
    expect(warning).toHaveAttribute('data-card-capacity', 'persistent');
    expect(warning).toHaveTextContent('This case is large — consider splitting it (150)');
    expect(screen.queryByRole('button', { name: 'Dismiss warning' })).not.toBeInTheDocument();
  });

  it('keeps the persistent warning at 199 cards but does not block new cards', () => {
    renderSection(199);

    expect(screen.getByRole('status')).toHaveAttribute('data-card-capacity', 'persistent');
    expect(canAddCard(199)).toBe(true);
  });

  it('blocks at 200 with the shared split-case message and a new-case link', () => {
    renderSection(200);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-card-capacity', 'blocked');
    expect(alert).toHaveTextContent('This case is full');
    expect(alert).toHaveTextContent('Create a new case and split these cards');
    expect(alert).toHaveTextContent('No case below 200 cards is limited');

    expect(screen.getByRole('link', { name: 'Create a new case' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Dismiss warning' })).not.toBeInTheDocument();
  });
});

describe('capture route capacity guard', () => {
  it('refuses a direct capture URL at 200 cards with the split-case message', async () => {
    const repository = makeRepository(MAX_BOARD_CARDS);
    renderCapture(repository);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Case board is full');
    expect(alert).toHaveTextContent('This case is full at 200 cards');
    expect(alert).toHaveTextContent('direct capture address cannot bypass this limit');
    expect(screen.queryByRole('button', { name: 'Take photo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add topic' })).not.toBeInTheDocument();
  });

  it('still opens the picker at 199 cards', async () => {
    const repository = makeRepository(MAX_BOARD_CARDS - 1);
    renderCapture(repository);

    expect(await screen.findByRole('button', { name: 'Take photo' })).toBeInTheDocument();
    expect(screen.queryByText('Case board is full')).not.toBeInTheDocument();
  });
});
