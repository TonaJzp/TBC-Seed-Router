'use strict';

// Usage: node scripts/validate.js "<godfat seed url>" [from] [to]
// Scrapes the banners and checks the local reroll/guaranteed math against godfat.

const { scrapeSeed, DEFAULT_ROLLS } = require('../src/scraper');
const { Simulator } = require('../src/simulator');

(async () => {
  const [url = 'https://bc.godfat.org/?seed=1234567', from, to] = process.argv.slice(2);
  const today = new Date().toISOString().slice(0, 10);
  const { seedInfo, events, skipped } = await scrapeSeed(url, {
    from: from || today,
    to: to || today,
    onProgress: (m) => console.log('·', m),
  });
  new Simulator(seedInfo.seed, events, DEFAULT_ROLLS); // annotates ev.validation
  for (const ev of events) {
    const s = ev.validation;
    console.log(
      `${ev.start}~${ev.end} ${ev.name.slice(0, 50).padEnd(50)} cells=${Object.keys(ev.raw).length}` +
        ` reroll ${s.rerollOk}/${s.rerollChecked} guaranteed ${s.guaranteedOk}/${s.guaranteedChecked}`
    );
  }
  for (const s of skipped) console.log('skipped:', s.name, '-', s.reason);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
