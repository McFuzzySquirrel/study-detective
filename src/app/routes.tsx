import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router';

import type { CaseRepositoryPort } from '../data/caseRepository';
import type { CardDetailRepositoryLoader } from '../features/cards/CardDetailPage';
import type { CaptureRepositoryLoader } from '../features/capture/CapturePage';
import type { CaseRepositoryLoader } from '../features/shelf/CaseShelfPage';

import ErrorBoundary from './ErrorBoundary';

const ShelfScreen = lazy(() =>
  import('../features/shelf/CaseShelfPage').then((module) => ({
    default: module.CaseShelfPage,
  })),
);
const CaseBoardScreen = lazy(() =>
  import('./placeholders').then((module) => ({ default: module.CaseBoardPlaceholder })),
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
  import('./placeholders').then((module) => ({ default: module.RecallPlaceholder })),
);
const SettingsScreen = lazy(() =>
  import('./placeholders').then((module) => ({ default: module.SettingsPlaceholder })),
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
          <Route path="/case/:caseId" element={<CaseBoardScreen />} />
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
          <Route path="/case/:caseId/recall" element={<RecallScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default AppRoutes;
