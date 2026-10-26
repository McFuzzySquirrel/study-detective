import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
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

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
