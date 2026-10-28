import { readFileSync } from 'node:fs';
import path from 'node:path';

import { MemoryRouter } from 'react-router';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../../src/app/App';
import BrowserNotice from '../../src/app/BrowserNotice';
import {
  CORE_API_NOTICES,
  SUPPORT_MATRIX_URL,
  supportsCoreApis,
} from '../../src/app/browserSupport';
import type { CoreApiEnvironment, CoreApiKey } from '../../src/app/browserSupport';
import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import { CaseShelfPage } from '../../src/features/shelf/CaseShelfPage';

/**
 * A11Y-FR-08 component evidence.
 *
 * Each capability is removed from an otherwise complete environment and the
 * notice is rendered beside the real shelf page. That proves the banner is
 * specific, non-blocking, and does not prevent the shelf from rendering. The
 * support link is checked against the README anchor on disk, so the notice
 * cannot point at a matrix that does not exist.
 */

const SUPPORTED_ENVIRONMENT: CoreApiEnvironment = {
  indexedDB: {},
  Worker: class TestWorker {},
  WebAssembly: { instantiate: () => undefined, compile: () => undefined },
  navigator: { serviceWorker: {} },
};

const ENVIRONMENT_PROPERTY: Record<CoreApiKey, string> = {
  indexedDB: 'indexedDB',
  webWorkers: 'Worker',
  webAssembly: 'WebAssembly',
  serviceWorkers: 'navigator',
};

function environmentMissing(key: CoreApiKey): CoreApiEnvironment {
  const environment: Record<string, unknown> = {
    indexedDB: {},
    Worker: class TestWorker {},
    WebAssembly: { instantiate: () => undefined, compile: () => undefined },
    navigator: { serviceWorker: {} },
  };

  delete environment[ENVIRONMENT_PROPERTY[key]];

  return environment as CoreApiEnvironment;
}

function renderShelfWithNotice(environment: CoreApiEnvironment) {
  return render(
    <MemoryRouter>
      <BrowserNotice environment={environment} />
      <CaseShelfPage repository={new InMemoryCaseRepository()} />
    </MemoryRouter>,
  );
}

const missingCases: ReadonlyArray<{
  readonly key: CoreApiKey;
  readonly api: RegExp;
  readonly capability: RegExp;
  readonly message: string;
}> = [
  {
    key: 'indexedDB',
    api: /IndexedDB/,
    capability: /local case storage/i,
    message:
      'Local case storage is reduced: this browser does not provide IndexedDB, so cases and cards cannot be saved on this device.',
  },
  {
    key: 'webWorkers',
    api: /Web Workers/,
    capability: /on-device text recognition/i,
    message:
      'On-device text recognition is reduced: this browser does not provide Web Workers, so OCR is unavailable.',
  },
  {
    key: 'webAssembly',
    api: /WebAssembly/,
    capability: /on-device text recognition/i,
    message:
      'On-device text recognition is reduced: this browser does not provide WebAssembly, so OCR is unavailable.',
  },
  {
    key: 'serviceWorkers',
    api: /service workers/,
    capability: /offline use/i,
    message:
      'Offline use is reduced: this browser does not provide service workers, so the app shell cannot be cached for offline use.',
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('supportsCoreApis', () => {
  it('reports all four APIs present for a supported browser', () => {
    expect(supportsCoreApis(SUPPORTED_ENVIRONMENT)).toEqual({
      indexedDB: true,
      webWorkers: true,
      webAssembly: true,
      serviceWorkers: true,
    });
  });

  it('requires WebAssembly to expose its instantiate entry point', () => {
    const support = supportsCoreApis({
      ...SUPPORTED_ENVIRONMENT,
      WebAssembly: { compile: () => undefined },
    });

    expect(support.webAssembly).toBe(false);
  });

  it('treats a null service worker container as missing', () => {
    const support = supportsCoreApis({
      ...SUPPORTED_ENVIRONMENT,
      navigator: { serviceWorker: null },
    });

    expect(support.serviceWorkers).toBe(false);
  });
});

describe('BrowserNotice', () => {
  it('renders nothing when the browser provides every required API', () => {
    const { container } = render(<BrowserNotice environment={SUPPORTED_ENVIRONMENT} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('browser-notice')).not.toBeInTheDocument();
  });

  it.each(missingCases)(
    'names the reduced capability for a missing $key and keeps the shelf usable',
    async ({ key, api, capability, message }) => {
      renderShelfWithNotice(environmentMissing(key));

      const notice = screen.getByTestId('browser-notice');
      expect(notice).toBeVisible();
      expect(notice).toHaveAttribute('aria-labelledby', 'browser-notice-title');
      expect(notice).not.toHaveAttribute('role', 'dialog');
      expect(notice).not.toHaveAttribute('aria-modal');

      const items = within(notice).getAllByRole('listitem');
      expect(items).toHaveLength(1);
      expect(items[0]).toHaveAttribute('data-capability', key);
      expect(items[0]).toHaveTextContent(message);
      expect(items[0]).toHaveTextContent(api);
      expect(items[0]).toHaveTextContent(capability);

      // The shelf is still a normal, usable page: no modal and no focus trap.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible();
      expect(await screen.findByText('No case files yet')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Dismiss browser support notice' })).toBeVisible();
    },
  );

  it('lists every missing API together instead of showing only the first', () => {
    renderShelfWithNotice({});

    const notice = screen.getByTestId('browser-notice');
    const capabilities = within(notice)
      .getAllByRole('listitem')
      .map((item) => item.getAttribute('data-capability'));

    expect(capabilities).toEqual(CORE_API_NOTICES.map((entry) => entry.key));
    expect(screen.getByRole('heading', { level: 2, name: 'Case shelf' })).toBeVisible();
  });

  it('links to the support matrix that exists in README', () => {
    renderShelfWithNotice(environmentMissing('serviceWorkers'));

    const link = within(screen.getByTestId('browser-notice')).getByRole('link', {
      name: 'Browser support matrix (README)',
    });

    expect(link).toHaveAttribute('href', SUPPORT_MATRIX_URL);
    expect(SUPPORT_MATRIX_URL).toContain('README.md#browser-support');

    const readme = readFileSync(path.join(process.cwd(), 'README.md'), 'utf8').toLowerCase();
    expect(readme).toContain('## browser support');

    for (const notice of CORE_API_NOTICES) {
      expect(readme).toContain(notice.api.toLowerCase());
    }
  });

  it('dismisses for the current mount and returns after a fresh page mount', async () => {
    const user = userEvent.setup();
    const first = render(<BrowserNotice environment={environmentMissing('indexedDB')} />);

    expect(screen.getByTestId('browser-notice')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Dismiss browser support notice' }));

    expect(screen.queryByTestId('browser-notice')).not.toBeInTheDocument();

    // Re-rendering the same mounted component does not bring the banner back.
    first.rerender(<BrowserNotice environment={environmentMissing('indexedDB')} />);
    expect(screen.queryByTestId('browser-notice')).not.toBeInTheDocument();

    // A new page session starts with the notice again.
    first.unmount();
    render(<BrowserNotice environment={environmentMissing('indexedDB')} />);
    expect(screen.getByTestId('browser-notice')).toBeVisible();
  });
});

describe('App composition', () => {
  it('mounts the status chip from the composition root while the shelf still renders', async () => {
    // jsdom does not implement IndexedDB, Web Workers, or service workers;
    // remove WebAssembly too so the notice must list all four capabilities.
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('WebAssembly', undefined);

    render(
      <App
        seedFirstRun={() =>
          Promise.resolve({ seeded: false, reason: 'already-seeded', caseId: null })
        }
      />,
    );

    const chip = await screen.findByRole('button', { name: /^System status:/ });
    expect(chip).toBeVisible();

    fireEvent.click(chip);

    const dialog = await screen.findByRole('dialog', { name: 'System status' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(4);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Case shelf' }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Notes Detective' })).toBeVisible();
  });
});
