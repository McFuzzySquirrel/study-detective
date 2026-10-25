import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router';

import ErrorBoundary from './ErrorBoundary';

const ShelfScreen = lazy(() =>
  import('./placeholders').then((module) => ({ default: module.ShelfPlaceholder })),
);
const CaseBoardScreen = lazy(() =>
  import('./placeholders').then((module) => ({ default: module.CaseBoardPlaceholder })),
);
const CaptureScreen = lazy(() =>
  import('./placeholders').then((module) => ({ default: module.CapturePlaceholder })),
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

/**
 * The only route table in the app. Every feature screen is loaded lazily and
 * every route sits inside a boundary keyed by location, so recovering to the
 * shelf remounts the view instead of leaving the boundary latched.
 */
export function AppRoutes() {
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
          <Route path="/" element={<ShelfScreen />} />
          <Route path="/case/:caseId" element={<CaseBoardScreen />} />
          <Route path="/case/:caseId/capture" element={<CaptureScreen />} />
          <Route path="/case/:caseId/recall" element={<RecallScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default AppRoutes;
