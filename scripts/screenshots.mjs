// Headless screenshots at 390x844 (iPhone 12/13/14 size). Usage: node scripts/screenshots.mjs [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4173/cluster-credit-pulse/';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
const PREFIX = process.env.SHOT_PREFIX || "";
const exe = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const shot = async (name) => { await page.waitForTimeout(600); const f = `${OUT}${PREFIX}${name}.png`; await page.screenshot({ path: f }); console.log("saved", f); };

await page.goto(BASE, { waitUntil: 'networkidle' });
await shot('01-picker-first-visit');
await page.getByText('Skip — show everything').click();
await shot('02-feed');
await page.locator('.chip.sig-negative').click();
await shot('03-feed-negative-filter');
await page.locator('.chip.sig-all').click();
const id = await page.evaluate(async () => (await (await fetch('./data/feed.json')).json()).items.find((i) => i.credit_signal === 'negative')?.id);
await page.goto(`${BASE}#/item/${id}`, { waitUntil: 'networkidle' });
await shot('04-card-detail');
await page.screenshot({ path: `${OUT}${PREFIX}04b-card-detail-full.png`, fullPage: true });
await page.goto(`${BASE}#/briefs`, { waitUntil: 'networkidle' });
await shot('05-briefs-list');
await page.goto(`${BASE}#/brief/surat`, { waitUntil: 'networkidle' });
await shot('06-brief-surat');
await page.goto(`${BASE}#/brief/morbi`, { waitUntil: 'networkidle' });
await shot('07-brief-morbi');
await browser.close();
