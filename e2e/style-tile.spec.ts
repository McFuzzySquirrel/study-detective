import { expect, test, type Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const specDirectory = dirname(fileURLToPath(import.meta.url));
const tilePath = resolve(specDirectory, '..', 'prototype', 'style-tile.html');
const tileUrl = pathToFileURL(tilePath).href;

const requiredViewports = [
  { name: 'tablet landscape', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
] as const;

type Rgb = { r: number; g: number; b: number };

function parseRgb(color: string): Rgb {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(color);
  if (!match) {
    throw new Error(`Cannot parse an rgb color from "${color}"`);
  }

  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
  };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function trackRemoteRequests(page: Page): string[] {
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/i.test(request.url())) {
      remoteRequests.push(request.url());
    }
  });
  return remoteRequests;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));

  expect(
    layout.documentScrollWidth,
    `document scrollWidth ${layout.documentScrollWidth}px should not exceed clientWidth ${layout.documentClientWidth}px`,
  ).toBeLessThanOrEqual(layout.documentClientWidth);
  expect(
    layout.bodyScrollWidth,
    `body scrollWidth ${layout.bodyScrollWidth}px should not exceed clientWidth ${layout.documentClientWidth}px`,
  ).toBeLessThanOrEqual(layout.documentClientWidth);
}

for (const viewport of requiredViewports) {
  test.describe(`${viewport.name} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('renders three complete directions with no page overflow', async ({ page }) => {
      const remoteRequests = trackRemoteRequests(page);
      await page.goto(tileUrl);

      expect(new URL(page.url()).protocol, 'opens from the file protocol').toBe('file:');
      await expect(page.locator('script')).toHaveCount(0);

      await expect(
        page.getByRole('heading', {
          level: 1,
          name: /which case file should notes detective open/i,
        }),
      ).toBeVisible();

      const legend = page.getByTestId('legend');
      await expect(legend).toBeVisible();
      await expect(legend.getByRole('heading', { name: 'What to judge' })).toBeVisible();
      await expect(legend.locator('li')).toHaveCount(6);
      await expect(legend).toContainText(/solid red association\s+string/i);
      await expect(legend).toContainText(/dashed amber provenance\s+string/i);

      const directions = page.locator('[data-direction]');
      await expect(directions).toHaveCount(3);

      const labels = await directions.locator('[data-direction-label]').allTextContents();
      expect(new Set(labels.map((label) => label.trim())).size).toBe(3);
      await expect(directions.locator('[data-direction-label]')).toHaveCount(3);

      const names = await directions.locator('h2').allTextContents();
      expect(new Set(names.map((name) => name.trim())).size).toBe(3);

      const signatures: string[] = [];

      for (let index = 0; index < 3; index += 1) {
        const direction = directions.nth(index);
        const label = `direction ${index + 1} (${labels[index] ?? 'unlabeled'})`;

        await expect(direction, label).toBeVisible();
        await expect(direction.locator('[data-direction-label]'), label).toBeVisible();
        await expect(direction.getByRole('heading', { level: 2 }), label).toBeVisible();

        const cork = direction.locator('[data-surface="cork"]');
        await expect(cork, `${label} cork surface`).toHaveCount(1);
        await expect(cork, `${label} cork surface`).toBeVisible();

        const pins = direction.locator('[data-pin]');
        await expect(pins, `${label} pin styles`).toHaveCount(3);
        const pinStyles = await pins.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('data-pin') ?? ''),
        );
        expect(
          pinStyles.filter((pin) => pin.length > 0),
          `${label} pin names`,
        ).toHaveLength(3);
        expect(new Set(pinStyles).size, `${label} distinct pin styles`).toBe(3);
        for (let pinIndex = 0; pinIndex < 3; pinIndex += 1) {
          await expect(pins.nth(pinIndex), `${label} pin ${pinIndex + 1}`).toBeVisible();
        }

        const association = direction.locator('[data-string="association"]');
        await expect(association, `${label} association string`).toHaveCount(1);
        const associationStyle = await association.evaluate((element) => {
          const path = element as SVGPathElement;
          const style = getComputedStyle(element);
          return {
            stroke: style.stroke,
            dashArray: style.strokeDasharray,
            length: path.getTotalLength(),
          };
        });
        const associationColor = parseRgb(associationStyle.stroke);
        expect(associationStyle.length, `${label} association string path length`).toBeGreaterThan(
          0,
        );
        expect(associationStyle.stroke, `${label} association stroke`).not.toBe('none');
        expect(associationStyle.dashArray, `${label} association is solid`).toBe('none');
        expect(associationColor.r, `${label} association is red`).toBeGreaterThan(
          associationColor.g,
        );
        expect(associationColor.r, `${label} association is red`).toBeGreaterThan(
          associationColor.b,
        );

        const provenance = direction.locator('[data-string="provenance"]');
        await expect(provenance, `${label} provenance string`).toHaveCount(1);
        const provenanceStyle = await provenance.evaluate((element) => {
          const path = element as SVGPathElement;
          const style = getComputedStyle(element);
          return {
            stroke: style.stroke,
            dashArray: style.strokeDasharray,
            length: path.getTotalLength(),
          };
        });
        const provenanceColor = parseRgb(provenanceStyle.stroke);
        expect(provenanceStyle.length, `${label} provenance string path length`).toBeGreaterThan(0);
        expect(provenanceStyle.stroke, `${label} provenance stroke`).not.toBe('none');
        expect(provenanceStyle.dashArray, `${label} provenance is dashed`).not.toBe('none');
        expect(provenanceStyle.dashArray, `${label} provenance dash pattern`).toMatch(/\d/);
        expect(provenanceColor.g, `${label} provenance is amber`).toBeGreaterThan(
          provenanceColor.b,
        );
        expect(provenanceColor.r, `${label} provenance is amber`).toBeGreaterThan(
          provenanceColor.b,
        );

        const heading = direction.locator('[data-type-sample="period-heading"]');
        const body = direction.locator('[data-type-sample="system-body"]');
        await expect(heading, `${label} period heading`).toBeVisible();
        await expect(body, `${label} system body text`).toBeVisible();

        const typeSample = await direction.evaluate((element) => {
          const headingElement = element.querySelector<HTMLElement>(
            '[data-type-sample="period-heading"]',
          );
          const bodyElement = element.querySelector<HTMLElement>(
            '[data-type-sample="system-body"]',
          );
          const panel = bodyElement?.parentElement;
          if (!headingElement || !bodyElement || !panel) {
            throw new Error('The type sample is incomplete');
          }
          const headingStyle = getComputedStyle(headingElement);
          const bodyStyle = getComputedStyle(bodyElement);
          return {
            headingFont: headingStyle.fontFamily,
            bodyFont: bodyStyle.fontFamily,
            headingSize: Number.parseFloat(headingStyle.fontSize),
            bodySize: Number.parseFloat(bodyStyle.fontSize),
            headingColor: headingStyle.color,
            bodyColor: bodyStyle.color,
            panelBackground: getComputedStyle(panel).backgroundColor,
          };
        });

        expect(
          typeSample.headingFont.toLowerCase(),
          `${label} heading uses a period face`,
        ).not.toBe(typeSample.bodyFont.toLowerCase());
        expect(typeSample.headingFont.toLowerCase(), `${label} heading face`).toMatch(
          /serif|monospace/,
        );
        expect(typeSample.bodyFont.toLowerCase(), `${label} body face`).toMatch(
          /system-ui|sans-serif/,
        );
        expect(typeSample.headingSize, `${label} heading is larger than body`).toBeGreaterThan(
          typeSample.bodySize,
        );
        expect(
          contrastRatio(parseRgb(typeSample.bodyColor), parseRgb(typeSample.panelBackground)),
          `${label} body contrast`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(parseRgb(typeSample.headingColor), parseRgb(typeSample.panelBackground)),
          `${label} heading contrast`,
        ).toBeGreaterThanOrEqual(3);

        const controls = direction.locator('button[data-control]');
        await expect(controls, `${label} 44px control`).toHaveCount(1);
        const control = controls.first();
        await expect(control, label).toBeVisible();
        await expect(control, label).toHaveAccessibleName(/\S/);

        const controlBox = await control.boundingBox();
        if (!controlBox) {
          throw new Error(`${label}: the control has no bounding box`);
        }
        expect(controlBox.width, `${label} control width`).toBeGreaterThanOrEqual(44);
        expect(controlBox.height, `${label} control height`).toBeGreaterThanOrEqual(44);

        const controlStyle = await control.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            color: style.color,
            background: style.backgroundColor,
          };
        });
        expect(
          contrastRatio(parseRgb(controlStyle.color), parseRgb(controlStyle.background)),
          `${label} control contrast`,
        ).toBeGreaterThanOrEqual(4.5);

        const signature = await direction.evaluate((element) => {
          const corkElement = element.querySelector<HTMLElement>('[data-surface="cork"]');
          const headingElement = element.querySelector<HTMLElement>(
            '[data-type-sample="period-heading"]',
          );
          const controlElement = element.querySelector<HTMLElement>('button[data-control]');
          if (!corkElement || !headingElement || !controlElement) {
            throw new Error('The direction signature is incomplete');
          }
          return {
            cork: getComputedStyle(corkElement).backgroundColor,
            control: getComputedStyle(controlElement).backgroundColor,
            heading: getComputedStyle(headingElement).fontFamily,
          };
        });
        signatures.push(`${signature.cork}|${signature.control}|${signature.heading}`);
      }

      expect(new Set(signatures).size, 'directions are visually distinct').toBe(3);

      expect(remoteRequests, 'no http(s) network requests').toEqual([]);
      const externalReferences = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('[src], [href]'))
          .map((element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '')
          .filter((value) => /^(?:https?:)?\/\//i.test(value)),
      );
      expect(externalReferences, 'no external asset references').toEqual([]);
      const remoteResources = await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => /^https?:/i.test(name)),
      );
      expect(remoteResources, 'no remote resource timings').toEqual([]);

      await expectNoHorizontalOverflow(page);
    });

    test('keeps every control keyboard reachable with a visible focus ring', async ({ page }) => {
      await page.goto(tileUrl);

      const controls = page.locator('button[data-control]');
      await expect(controls).toHaveCount(3);

      await page.keyboard.press('Tab');
      await expect(page.locator('.skip-link')).toBeFocused();

      for (let index = 0; index < 3; index += 1) {
        await page.keyboard.press('Tab');
        const control = controls.nth(index);
        await expect(control).toBeFocused();

        const outline = await control.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            style: style.outlineStyle,
            width: Number.parseFloat(style.outlineWidth),
          };
        });
        expect(outline.style, `control ${index + 1} focus outline style`).not.toBe('none');
        expect(outline.width, `control ${index + 1} focus outline width`).toBeGreaterThanOrEqual(2);
      }
    });
  });
}

test('honors reduced motion while keeping the final pin state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(tileUrl);

  const pin = page.locator('[data-pin]').first();
  const control = page.locator('button[data-control]').first();

  expect(await pin.evaluate((element) => getComputedStyle(element).animationName)).toBe(
    'pin-settle',
  );
  expect(
    await control.evaluate((element) => getComputedStyle(element).transitionDuration),
  ).not.toBe('0s');

  await page.emulateMedia({ reducedMotion: 'reduce' });

  expect(await pin.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  expect(await pin.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  expect(await control.evaluate((element) => getComputedStyle(element).transitionDuration)).toMatch(
    /^0s(?:\s*,\s*0s)*$/,
  );
});
