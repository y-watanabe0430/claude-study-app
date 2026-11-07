

import { chromium } from '@playwright/test';

const URL = 'http://localhost:4173/claude-study-app/';
let browser;
for (const channel of ['chrome', 'msedge']) {
  try { browser = await chromium.launch({ channel, headless: true }); console.log('browser:', channel); break; } catch (e) { console.log(channel, 'unavailable'); }
}
if (!browser) { console.log('NO_BROWSER'); process.exit(2); }

const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(URL);
await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.getRegistration().then((r) => r?.active), null, { timeout: 15000 });
await page.waitForTimeout(2500);
const info = await page.evaluate(async () => {
  const keys = await caches.keys();
  const c = keys.length ? (await (await caches.open(keys[0])).keys()).map((r) => r.url.replace(location.origin, '')) : [];
  return { keys, cached: c, controlled: !!navigator.serviceWorker.controller };
});
console.log('SW/cache:', JSON.stringify(info));

// サンプル取り込み → オフラインで再読み込み → 学習できるか
await page.getByRole('button', { name: /サンプル/ }).click();
await page.getByRole('button', { name: 'この内容で取り込む' }).click();
await page.getByText('取り込みました').waitFor();

await page.reload(); // controller を確実に有効化
await page.waitForTimeout(1000);
await ctx.setOffline(true);
await page.goto(URL + '#/setup');
await page.reload();
await page.getByRole('heading', { name: '学習設定' }).waitFor({ timeout: 10000 });
await page.getByRole('button', { name: /開始する/ }).click();
await page.waitForURL(/#\/quiz\//);
console.log('OFFLINE quiz started:', page.url().replace(URL, ''));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
console.log('horizontal overflow at 375px:', overflow);

// 外部ネットワーク要求がないこと
await ctx.setOffline(false);
const external = [];
page.on('request', (r) => { if (!r.url().startsWith('http://localhost:4173')) external.push(r.url()); });
await page.reload(); await page.waitForTimeout(1000);
console.log('external requests:', JSON.stringify(external));
console.log('errors:', JSON.stringify(errors));
await page.screenshot({ path: 'docs/screenshots/mobile-375-quiz-offline.png' });
await browser.close();
