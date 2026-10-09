// Field Pulse screenshots at 390x844. Usage: node scripts/pulse-screenshots.mjs [baseUrl]
// Submissions made here are flagged test:true (localStorage ccp.fp.test) and excluded from aggregates.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4173/cluster-credit-pulse/';
const OUT = (process.env.SHOT_DIR || new URL('../screenshots/', import.meta.url).pathname);
const exe = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const posts = [];
page.on('response', (r) => { if (r.request().method() === 'POST') posts.push(`${r.status()} ${r.url().replace(/[^/]+$/, '<topic>')}`); });
const shot = async (name, full = false) => { await page.waitForTimeout(700); const f = `${OUT}pulse-${name}.png`; await page.screenshot({ path: f, fullPage: full }); console.log('saved', f); };

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('ccp.fp.test', 'true'));
await page.getByText('Skip — show everything').click();
await page.waitForTimeout(500);
await shot('00-feed-with-cta');
await page.locator('.fp-cta').first().click();
await shot('01-role-picker');
await page.locator('.role-opt', { hasText: 'Banker' }).click();
await shot('02-poll-sheet');
await page.locator('.sheet .x').click();
// card detail poll on a Morbi card
const { polls } = await page.evaluate(async () => (await (await fetch('./data/polls.json')).json()));
const feed = await page.evaluate(async () => (await (await fetch('./data/feed.json')).json()));
const ok = (i) => polls[i.id] && !polls[i.id].no_poll && polls[i.id].roles.some((r) => r.role === 'banker');
const morbi = feed.items.find((i) => i.cluster === 'morbi' && i.credit_signal === 'negative' && ok(i)) || feed.items.find((i) => i.cluster === 'morbi' && polls[i.id] && !polls[i.id].no_poll && polls[i.id].roles.some((r) => r.role === 'banker'));
await page.goto(`${BASE}#/item/${morbi.id}`, { waitUntil: 'networkidle' });
await page.locator('#poll').scrollIntoViewIfNeeded();
await page.evaluate(() => document.querySelector('#poll').scrollIntoView({ block: 'start' }));
await shot('03-poll-on-card');
const qs = page.locator('#poll .q');
for (let i = 0; i < await qs.count(); i++) { await qs.nth(i).locator('.opt').first().click(); await page.waitForTimeout(900); }
await page.locator('#poll textarea').fill('TEST submission from setup — please ignore');
await page.locator('#poll .primary').click();
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('#poll').scrollIntoView({ block: 'start' }));
await shot('04-thankyou-field-pulse');
await page.goto(`${BASE}#/brief/morbi`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.querySelector('.pulseblock')?.scrollIntoView({ block: 'center' }));
await shot('05-brief-field-pulse');
console.log('tested card', morbi.id, 'POSTs:', posts);
await browser.close();
