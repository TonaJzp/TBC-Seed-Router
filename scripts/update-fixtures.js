'use strict';

// Regenerates the offline test fixtures from the live site:
//   test/fixtures/events.json       scraped banners for seed 1234567
//   test/fixtures/variants.json     one banner simulated as step-up (15) and as 7-guaranteed
//   test/fixtures/godfat-table.html raw godfat page (guaranteed + alt cells)
// Usage: node scripts/update-fixtures.js [from] [to]

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { scrapeSeed, scrapeEvent, newBrowser, parseSeedUrl } = require('../src/scraper');

const SEED_URL = 'https://bc.godfat.org/?seed=1234567&lang=en';
const OUT = path.join(__dirname, '..', 'test', 'fixtures');
const MAX_EVENTS = 4;

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const [from = today, to = from] = process.argv.slice(2);
  fs.mkdirSync(OUT, { recursive: true });

  const { seedInfo, events } = await scrapeSeed(SEED_URL, { from, to, rolls: 200 });
  // Keep a small mix of banners with and without guaranteed draws.
  const pick = [
    ...events.filter((e) => e.hasGuaranteed).slice(0, MAX_EVENTS / 2),
    ...events.filter((e) => !e.hasGuaranteed).slice(0, MAX_EVENTS / 2),
  ];
  fs.writeFileSync(
    path.join(OUT, 'events.json'),
    JSON.stringify({ seed: seedInfo.seed, rolls: 200, from, to, events: pick })
  );

  // godfat's "Simulate guaranteed" renders any banner as if it had another
  // guaranteed kind; there may be no real step-up banner to record.
  const plain = pick.find((e) => !e.hasGuaranteed);
  const forced = await newBrowser();
  const variants = {};
  for (const size of [15, 7]) {
    variants[size] = await scrapeEvent(forced, parseSeedUrl(SEED_URL), { ...plain, id: plain.id }, 200, {
      force_guaranteed: String(size),
    });
  }
  await forced.close();
  fs.writeFileSync(path.join(OUT, 'variants.json'), JSON.stringify(variants));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const withGuaranteed = pick.find((e) => e.hasGuaranteed) || pick[0];
  await page.goto(`${SEED_URL}&event=${withGuaranteed.id}&count=40`, { waitUntil: 'domcontentloaded' });
  fs.writeFileSync(path.join(OUT, 'godfat-table.html'), await page.content());
  await browser.close();
  console.log(`Fixtures: ${pick.map((e) => e.name).join(' | ')}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
