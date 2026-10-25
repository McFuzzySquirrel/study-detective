import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const iconsDirectory = path.join(projectRoot, 'public', 'icons');
const sourceFile = path.join(iconsDirectory, 'icon.svg');

const MASKABLE_SIZE = 512;
const MASKABLE_ARTWORK_RATIO = 0.72;
// Matches the icon background and the manifest background_color.
const MASKABLE_BACKGROUND = { r: 47, g: 36, b: 27, alpha: 1 };

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
];

async function writePng(destination, size) {
  await sharp(sourceFile, { density: 512 })
    .resize(size, size, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toFile(destination);
}

async function writeMaskablePng(destination) {
  const artworkSize = Math.round(MASKABLE_SIZE * MASKABLE_ARTWORK_RATIO);
  const artwork = await sharp(sourceFile, { density: 512 })
    .resize(artworkSize, artworkSize, { fit: 'fill' })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: MASKABLE_SIZE,
      height: MASKABLE_SIZE,
      channels: 4,
      background: MASKABLE_BACKGROUND,
    },
  })
    .composite([{ input: artwork, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(destination);
}

async function main() {
  const source = await readFile(sourceFile);
  if (source.length === 0) {
    throw new Error(`Icon source is empty: ${sourceFile}`);
  }

  await mkdir(iconsDirectory, { recursive: true });

  const written = [];
  for (const target of targets) {
    const destination = path.join(iconsDirectory, target.file);
    await writePng(destination, target.size);
    written.push({ destination, size: target.size });
  }

  const maskableDestination = path.join(iconsDirectory, 'maskable-512.png');
  await writeMaskablePng(maskableDestination);
  written.push({ destination: maskableDestination, size: MASKABLE_SIZE });

  for (const { destination, size } of written) {
    const details = await stat(destination);
    if (details.size === 0) {
      throw new Error(`Generated icon is empty: ${destination}`);
    }
    console.log(`generated ${path.relative(projectRoot, destination)} (${size}x${size})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Icon generation failed.');
  process.exitCode = 1;
});
