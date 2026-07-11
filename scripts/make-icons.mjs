// Renders the PWA icons from the desk's material language (tokens.css
// values) so the icon and the product share one aesthetic. Run once:
//   node scripts/make-icons.mjs
import { chromium } from "@playwright/test";

const html = (size) => `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; }
  .icon {
    width: ${size}px; height: ${size}px;
    display: flex; align-items: center; justify-content: center;
    background:
      radial-gradient(circle at 32% 28%, #2C2D31 0, #232427 55%, #18191B 100%);
    border-radius: ${Math.round(size * 0.14)}px;
    box-sizing: border-box;
    border: ${Math.max(1, Math.round(size / 128))}px solid #0D0E10;
  }
  .w {
    font-family: Arial, sans-serif;
    font-weight: 700;
    font-size: ${Math.round(size * 0.52)}px;
    letter-spacing: -0.02em;
    color: #E8A33D;
    text-shadow: 0 0 ${Math.round(size * 0.06)}px rgba(232, 163, 61, 0.55);
  }
</style>
<div class="icon"><span class="w">W</span></div>`;

const browser = await chromium.launch();
for (const size of [192, 512]) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
  });
  await page.setContent(html(size));
  await page.screenshot({
    path: `public/assets/icon-${size}.png`,
    omitBackground: true,
  });
  await page.close();
}
await browser.close();
console.log("icons written");
