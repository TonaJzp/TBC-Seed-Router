# NOTICE

**TBC Seed Router**
Copyright (c) 2026 TonaJzp. All rights reserved. — https://github.com/TonaJzp/TBC-Seed-Router

The code is published so that it can be read, not reused: copying, publishing or hosting it, or
works based on it, needs the author's written permission. See [LICENSE](LICENSE).

## Third-party material

- **Battle Cats Rolls** by Lin Jen-Shin (godfat), https://gitlab.com/godfat/battle-cats-rolls,
  Copyright (c) 2018-2026 Lin Jen-Shin, licensed under the Apache License 2.0
  ([LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt)).
  - `public/core/gacha.js` is a port of its roll algorithm (`lib/battle-cats-rolls/gacha.rb`,
    `gacha_pool.rb`, `cat.rb`) and `scripts/lib/godfat-data.js` ports its end-date normalisation
    (`crystal_ball.rb`). Changes: rewritten in JavaScript and limited to what the route planner needs.
  - The banner data (`build/bc-en.yaml`) and the hours of the banners (the game's event files
    in `data/en/events`) are downloaded from that repository when the site is built; they are not
    stored here, except the test snapshot `test/fixtures/gacha-data.json`. `scripts/lib/godfat-data.js`
    also ports the reading of those event files (`tsv_reader.rb`).
  - `test/fixtures/events.json`, `variants.json` and `godfat-table.html` are pages and tables
    rendered by bc.godfat.org, kept as the reference the tests compare against.
- **Cat icons** are downloaded from the Battle Cats Wiki (https://battlecats.miraheze.org) when the
  site is built. The images are © PONOS Corporation.
- **The Battle Cats**, PONOS and the names and images of its units are trademarks or copyrighted
  material of PONOS Corporation. This is an unofficial fan tool, not affiliated with or endorsed by
  PONOS Corporation, godfat or the Battle Cats Wiki.
- Build-time tools, not included in the published site: js-yaml (MIT), linkedom (ISC).
