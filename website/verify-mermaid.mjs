import { chromium } from 'playwright';

const pages = [
  { url: 'http://localhost:3000/docs/guides/agentic-process', name: 'agentic-process' },
  { url: 'http://localhost:3000/docs/reference/architecture/content-model', name: 'content-model' },
  { url: 'http://localhost:3000/docs/reference/architecture/adapter-system', name: 'adapter-system' },
  { url: 'http://localhost:3000/docs/reference/configuration', name: 'configuration' },
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
});

for (const { url, name } of pages) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  // Wait extra for mermaid to render
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `/tmp/verify-${name}.png`, fullPage: true });
  console.log(`Screenshot saved: /tmp/verify-${name}.png`);
  await page.close();
}

await browser.close();
console.log('Done.');
