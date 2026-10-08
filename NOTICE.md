# NOTICE

**TBC Seed Router**
Copyright (C) 2026 TonaJzp — https://github.com/TonaJzp/TBC-Seed-Router

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU Affero General Public License, version 3 ([LICENSE](LICENSE)), with the additional terms below.
It is distributed WITHOUT ANY WARRANTY; see the license for details.

## Additional terms (AGPL-3.0, section 7)

1. **Author attribution (section 7(b)).** Every copy, modified version or work based on this
   program, including any version made available to users over a network, must keep the
   following attribution visible to its users, in the user interface (for example, in the page
   footer) and in its documentation:

   > Basado en TBC Seed Router, creado por TonaJzp — https://github.com/TonaJzp/TBC-Seed-Router

   Unmodified copies may instead keep the original footer ("TBC Seed Router, creado por TonaJzp",
   with the same link).

2. **Origin (section 7(c)).** Modified versions must be marked as different from the original and
   must not be presented as the original project or as made by its author.

## Third-party material

- **Battle Cats Rolls** by Lin Jen-Shin (godfat), https://gitlab.com/godfat/battle-cats-rolls,
  Copyright (c) 2018-2026 Lin Jen-Shin, licensed under the Apache License 2.0
  ([LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt)).
  - `public/core/gacha.js` is a port of its roll algorithm (`lib/battle-cats-rolls/gacha.rb`,
    `gacha_pool.rb`, `cat.rb`) and `scripts/lib/godfat-data.js` ports its end-date normalisation
    (`crystal_ball.rb`). Changes: rewritten in JavaScript and limited to what the route planner needs.
  - The banner data (`build/bc-en.yaml`) is downloaded from that repository when the site is
    built; it is not stored here, except the test snapshot `test/fixtures/gacha-data.json`.
  - `test/fixtures/events.json`, `variants.json` and `godfat-table.html` are pages and tables
    rendered by bc.godfat.org, kept as the reference the tests compare against.
- **Cat icons** are downloaded from the Battle Cats Wiki (https://battlecats.miraheze.org) when the
  site is built. The images are © PONOS Corporation.
- **The Battle Cats**, PONOS and the names and images of its units are trademarks or copyrighted
  material of PONOS Corporation. This is an unofficial fan tool, not affiliated with or endorsed by
  PONOS Corporation, godfat or the Battle Cats Wiki.
- Build-time tools, not included in the published site: js-yaml (MIT), linkedom (ISC).
