import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router';

import type { CaseRepositoryPort } from '../data/caseRepository';
import type { CardDetailRepositoryLoader } from '../features/cards/CardDetailPage';
import type { CardListRepositoryLoader } from '../features/case/CardListPage';
import type { CaseBoardRepositoryLoader } from '../features/case/CaseBoardPage';
import type { CaptureRepositoryLoader } from '../features/capture/CapturePage';
import type { RecallRepositoryLoader } from '../features/recall/RecallPage';
import type { CaseRepositoryLoader } from '../features/shelf/CaseShelfPage';

import ErrorBoundary from './ErrorBoundary';

const ShelfScreen = lazy(() =>
  import('../features/shelf/CaseShelfPage').then((module) => ({
    default: module.CaseShelfPage,
  })),
);
const CaseBoardScreen = lazy(() =>
  import('../features/case/CaseBoardPage').then((module) => ({
    default: module.CaseBoardPage,
  })),
);
const CardListScreen = lazy(() =>
  import('../features/case/CardListPage').then((module) => ({
    default: module.CardListPage,
  })),
);
const CaptureScreen = lazy(() =>
  import('../features/capture/CapturePage').then((module) => ({
    default: module.CapturePage,
  })),
);
const CardDetailScreen = lazy(() =>
  import('../features/cards/CardDetailPage').then((module) => ({
    default: module.CardDetailPage,
  })),
);
const RecallScreen = lazy(() =>
  import('../features/recall/RecallPage').then((module) => ({ default: module.RecallPage })),
);
const SettingsScreen = lazy(() =>
  import('../features/settings/SettingsPage').then((module) => ({
    default: module.SettingsPage,
  })),
);
const NotFoundScreen = lazy(() =>
  import('./placeholders').then((module) => ({ default: module.NotFoundPlaceholder })),
);

export interface AppRoutesProps {
  /** Replaces the shelf's repository in tests and future composition. */
  readonly shelfRepository?: CaseRepositoryPort | undefined;
  /** Replaces the shelf's repository opener, including its failure path. */
  readonly loadShelfRepository?: CaseRepositoryLoader | undefined;
  /** Replaces the capture route's repository in tests and future composition. */
  readonly captureRepository?: CaseRepositoryPort | undefined;
  /** Replaces the capture route's repository opener, including its failure path. */
  readonly loadCaptureRepository?: CaptureRepositoryLoader | undefined;
  /** Replaces the card-detail route's repository in tests and future composition. */
  readonly cardRepository?: CaseRepositoryPort | undefined;
  /** Replaces the card-detail route's repository opener, including its failure path. */
  readonly loadCardRepository?: CardDetailRepositoryLoader | undefined;
  /** Replaces the board route's repository in tests and future composition. */
  readonly boardRepository?: CaseRepositoryPort | undefined;
  /** Replaces the board route's repository opener, including its failure path. */
  readonly loadBoardRepository?: CaseBoardRepositoryLoader | undefined;
  /** Replaces the card-list route's repository in tests and future composition. */
  readonly cardListRepository?: CaseRepositoryPort | undefined;
  /** Replaces the card-list route's repository opener, including its failure path. */
  readonly loadCardListRepository?: CardListRepositoryLoader | undefined;
  /** Replaces the recall route's read-only repository in tests and composition. */
  readonly recallRepository?: CaseRepositoryPort | undefined;
  /** Replaces the recall route's repository opener, including its failure path. */
  readonly loadRecallRepository?: RecallRepositoryLoader | undefined;
}

/**
 * The only route table in the app. Every feature screen is loaded lazily and
 * every route sits inside a boundary keyed by location, so recovering to the
 * shelf remounts the view instead of leaving the boundary latched.
 */
export function AppRoutes({
  shelfRepository,
  loadShelfRepository,
  captureRepository,
  loadCaptureRepository,
  cardRepository,
  loadCardRepository,
  boardRepository,
  loadBoardRepository,
  cardListRepository,
  loadCardListRepository,
  recallRepository,
  loadRecallRepository,
}: AppRoutesProps = {}) {
  const location = useLocation();

  return (
    <ErrorBoundary resetKey={location.key}>
      <Suspense
        fallback={
          <p className="route-loading" aria-live="polite">
            Opening the case file…
          </p>
        }
      >
        <Routes>
          <Route
            path="/"
            element={
              <ShelfScreen repository={shelfRepository} loadRepository={loadShelfRepository} />
            }
          />
          <Route
            path="/case/:caseId"
            element={
              <CaseBoardScreen repository={boardRepository} loadRepository={loadBoardRepository} />
            }
          />
          <Route
            path="/case/:caseId/list"
            element={
              <CardListScreen
                repository={cardListRepository ?? boardRepository}
                loadRepository={loadCardListRepository ?? loadBoardRepository}
              />
            }
          />
          <Route
            path="/case/:caseId/card/:cardId"
            element={
              <CardDetailScreen repository={cardRepository} loadRepository={loadCardRepository} />
            }
          />
          <Route
            path="/case/:caseId/capture"
            element={
              <CaptureScreen
                repository={captureRepository}
                loadRepository={loadCaptureRepository}
              />
            }
          />
          <Route
            path="/case/:caseId/recall"
            element={
              <RecallScreen
                repository={recallRepository ?? boardRepository}
                loadRepository={loadRecallRepository ?? loadBoardRepository}
              />
            }
          />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default AppRoutes;
