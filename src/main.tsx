import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { registerPwa } from './pwa';
import './styles/base.css';

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
