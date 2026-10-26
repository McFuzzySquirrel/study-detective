import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './app/App';
import { ensureMotionPreference } from './app/motionPreference';
import { registerPwa } from './pwa';
import './styles/base.css';
// Imported last so the cross-screen layout layer can adjust screen rules at
// the documented phone/tablet/desktop breakpoints without touching tokens.
import './styles/responsive.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('The application root element is missing.');
}

registerPwa();

// Apply the persisted or device motion preference before the first render so a
// reduced-motion install never sees a pin, string, or page transition animate.
ensureMotionPreference();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
