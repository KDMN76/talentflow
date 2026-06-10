// One-off: rasteriseert public/icons/icon.svg naar de PNG-groottes die
// manifest.json + layout.tsx verwachten. Gebruikt de Playwright-Chromium die
// het project toch al voor e2e heeft. Niet onderdeel van de build — handmatig
// draaien wanneer het brand-icoon wijzigt: `node apps/web/scripts/gen-pwa-icons.mjs`.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const svg = readFileSync(join(iconsDir, "icon.svg"), "utf8");

const browser = await chromium.launch();
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><meta charset="utf8">` +
        `<style>html,body{margin:0;padding:0}svg{display:block;width:100vw;height:100vh}</style>` +
        svg
    );
    const buf = await page.screenshot({
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    writeFileSync(join(iconsDir, `icon-${size}.png`), buf);
    console.log(`wrote icon-${size}.png (${buf.length} bytes)`);
    await page.close();
  }
} finally {
  await browser.close();
}
