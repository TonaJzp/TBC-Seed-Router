# BattleCats Seed Router

Aplicación web local que lee tu semilla en [bc.godfat.org](https://bc.godfat.org/) y calcula
las rutas óptimas de tiros (alternando banners) para conseguir una lista de gatos objetivo.

## Cómo abrirla

La app tiene un pequeño servidor local (busca en godfat y calcula las rutas), así que **no basta
con abrir `public/index.html`**: sin el servidor no carga la lista de gatos ni puede calcular nada.

**En Windows:** doble clic en **`Iniciar Seed Router.bat`**. La primera vez instala lo necesario
(un par de minutos). Después arranca el servidor y abre el navegador en http://localhost:3000.
Deja abierta la ventana negra mientras uses la app; para cerrarla, ciérrala o pulsa Ctrl+C.

**Desde la terminal:**

```bash
npm install        # solo la primera vez: Express, Playwright y Chromium
npm run app        # arranca y abre el navegador (npm start: solo arranca)
```

Requiere [Node.js](https://nodejs.org) 22 o superior. `PORT=4000 npm start` cambia el puerto. Si
la app ya estaba abierta, volver a iniciarla solo abre el navegador.

## Uso

1. Pega la URL de tu semilla de godfat (`https://bc.godfat.org/?seed=...`). Si incluye `last=<id>`
   se usa como último gato obtenido (afecta a si 1A es un rare duplicado).
2. Elige los gatos objetivo en el buscador: escribe parte del nombre (o de otra de sus formas) y
   elígelo con el ratón o con flechas + Enter. Retroceso quita el último. También puedes pegar una
   lista separada por comas; se añaden los nombres reconocidos y se avisa de los demás. No hay
   límite de objetivos.
3. Elige el rango de fechas: solo se analizan los banners **Upcoming** que se solapan con él. La
   fecha inicial nunca puede ser anterior a hoy, tomando la fecha del ordenador del usuario.
4. Elige cuántos tiros hacia delante revisar, es decir, hasta qué fila de godfat se lee en cada
   banner (recomendado 200, máximo 1000). Más tiros solo alargan el análisis: la app no usa IA, así
   que el resultado no pierde precisión.
5. Indica tus Rare Tickets y Cat Food, marca los descuentos que tengas disponibles en tu cuenta y
   elige las protecciones. El plan decide si le conviene usar cada descuento; en cada ruta se indica
   en qué paso se usa o por qué no.

El resultado es la **ruta recomendada** (menor gasto total de recursos) más tres alternativas:

| Ruta | Criterio (en orden de prioridad) |
|------|----------------------------------|
| **Recomendada** | menor coste total (Cat Food + 150 × tickets) → menos Cat Food → menos tiros |
| Máximo ahorro de Cat Food | menos Cat Food → menos tickets → menos tiros |
| Máximo ahorro de Rare Tickets | menos tickets → menos Cat Food → menos tiros |
| Menos tiros | menos tiros (avanza lo mínimo en la semilla) → menor coste total |

El último criterio de desempate en todas es hacer menos cambios de banner. Para el coste total,
1 Rare Ticket = 150 Cat Food, como en el juego. Con esa equivalencia, 11 tiros simples con ticket
(1650) cuestan más que un 11-draw (1500), así que la recomendada a veces conserva tickets. Si
prefieres gastar tickets antes que Cat Food, usa la alternativa «Máximo ahorro de Cat Food».

Los tickets se gastan en orden: cada tiro simple usa un Rare Ticket mientras te queden. Al
agotarse, el siguiente cuesta 50 Cat Food si tienes el descuento y los demás 150.

Si una alternativa coincide con otra ruta, o cuesta lo mismo, se indica. Si ninguna ruta cabe en tu
Cat Food actual, se muestra igualmente la mejor y cuánta Cat Food falta. Si no existe ninguna ruta
que consiga todos los objetivos, se devuelve la que consigue el máximo posible y se marca qué gatos
faltan.

## Reglas de tiempo

Un evento «S ~ E» está activo desde el cambio de eventos del día S hasta el del día E. Un evento que
acaba el día D y otro que empieza ese mismo día nunca están activos a la vez. La ruta solo avanza en
el tiempo: puedes alternar entre eventos que se solapan, pero una vez que tiras en un evento que
empieza más tarde, los que ya han terminado dejan de estar disponibles.

## Casillas de legendario y protecciones

- **Moradas**: casillas de legendario. En un banner con legendarios dan un legendario; en uno sin
  legendarios, un uber.
- **Lilas**: casillas que solo son de legendario en Royalfest o en eventos de doble probabilidad de
  legend. Solo cuentan si hay un evento así en Upcoming. Se detecta por el nombre del evento y,
  cuando hay datos, porque una casilla lila da un legendario en ese evento.

**Proteger** una casilla no impide pasar por ella: las rutas pueden tirar en casillas protegidas.
Lo que hace la protección es que un gato objetivo que salga ahí **no cuente** como conseguido,
salvo que sea el propio legendario. Así el plan busca ese gato en otra casilla y no gasta la
oportunidad de legendario.

Con o sin protección, cada ruta lista las casillas de legendario por las que pasa, en qué paso, qué
consigues ahí y qué legendario podrías conseguir en su lugar, solo según los banners de tus fechas
que de verdad dan legendario en esa casilla. La lista completa de casillas de legendario de los
tiros revisados está en «Casillas de legendario en tus próximos N tiros». Junto a cada legendario
hay un botón «Añadir a objetivos y recalcular» que lo añade a tus gatos y repite el cálculo, para
conseguirlo junto con los demás.

## Por qué no se consigue todo

Si la ruta recomendada no consigue todos los gatos, o no hay ninguna ruta posible, la sección
«Por qué no se puede conseguir todo» explica el motivo de cada gato. Indica las casillas y los
banners concretos de tu semilla, enlaza a godfat para comprobarlo y dice qué puedes cambiar.

| Motivo | Qué se indica |
|--------|---------------|
| No sale en el gacha | Es un gato Normal o Especial |
| No está en los banners de tus fechas | En qué otro banner próximo sale y a qué fecha ampliar «Hasta» (o si solo está en Platinum/Legend) |
| No sale en los tiros revisados | La fila en la que aparece por primera vez (busca hasta 1000) y cuántos tiros poner |
| Solo sale en casillas protegidas | Qué protección (moradas o lilas) y las casillas exactas donde sale |
| Las fechas lo impiden | Que para llegar hace falta un banner que empieza cuando el suyo ya ha terminado, y los rare duplicados que obligan a cambiar de pista |
| Ninguna combinación de tiros llega | Las casillas donde sale y los cambios de pista obligatorios |
| Choca con otro objetivo | Con qué gato choca y dónde sale cada uno: conseguir uno obliga a dejar atrás al otro |

Para averiguarlo se exploran todas las posiciones de la semilla alcanzables con tus restricciones,
y se repite sin protecciones, con cada protección por separado y sin límite de fechas. Si varios
gatos tienen la misma causa, se explica una sola vez.

Los errores de conexión también se explican: sin internet, godfat lento, falta el navegador interno,
URL incorrecta o fechas sin banners (en ese caso se listan los próximos banners).

## Tipos de banner y reglas de coste

El tipo de cada banner se detecta comprobando qué mecánica reproduce exactamente lo que dibuja godfat,
no por su nombre:

| Tipo | Acciones |
|------|----------|
| Normal (sin garantizado) | tiro simple; 11-draw normal (11 tiros) por 1500 Cat Food |
| Garantizado | tiro simple; 11-draw garantizado (10 tiros + uber) por 1500 Cat Food |
| Step-up 3+5+7 | solo el step-up completo: 14 tiros + uber por 2100 Cat Food (300 + 750 + 1050) |
| No reconocido | se excluye y se avisa, para no dar rutas erróneas |

- **Tiro simple**: consume 1 Rare Ticket si tienes; si no, 150 Cat Food
  (50 con el descuento Single-Draw, una vez, solo con 0 tickets).
- **Descuento 11-Draw** (750, una vez): vale para el 11-draw normal o el garantizado.
- El uber garantizado se elige con medio tiro, así que siempre cambia de pista.
- Los banners Platinum/Legend (se pagan con otros tickets) se excluyen.
- El step-up se modela como los tres pasos seguidos; no se modelan pasos sueltos.

## Lista de gatos (Miraheze)

El buscador incluye **todos** los gatos del juego (Normal, Especial, Rare, Super Rare, Uber Rare y
Legend Rare) de la [Battle Cats Wiki en Miraheze](https://battlecats.miraheze.org). Se obtienen con la API de
MediaWiki, igual que en el proyecto «App Battle cats»: `Category:Cat_Units`, las redirecciones
como nombres de las otras formas y sin los exclusivos de Japón.

- Se guarda una copia en `data/cats.json`, así la app arranca al instante y funciona sin conexión.
- Se actualiza sola en segundo plano si la copia tiene más de 12 h. Si Miraheze no responde, se
  mantiene la copia anterior.
- Cada gato se empareja con godfat por **ID**: el icono de la wiki se llama `<unidad>_<forma>.png`,
  y el ID de godfat es ese número + 1. Si un gato no tiene ese icono, se empareja por nombre exacto y
  después por el nombre de sus otras formas.
- godfat se lee siempre en inglés, aunque tu URL lleve otro `lang`.
- Cada gato se identifica por el título de su página en la wiki, que es único aunque dos gatos se
  llamen igual (hay dos «Cat Bros», uno Rare y otro Especial).

Si eliges un gato que no se puede conseguir, el análisis lo indica con el motivo:
- No sale en el gacha (gatos Normal o Especial).
- No está en ningún banner de las fechas elegidas.
- Está en algún banner, pero no sale en los tiros revisados.

## Cómo funciona

```
public/            Frontend (HTML + JS sin dependencias; picker.js es el buscador de gatos)
data/cats.json     Copia local de la lista de gatos de Miraheze
server.js          API Express: POST /api/routes (NDJSON con progreso), GET /api/cats
src/catalog.js     Lista de gatos de Miraheze, con copia local y actualización automática
src/scraper.js     Playwright: lista de eventos Upcoming + N tiros por banner
src/rng.js         xorshift32 y disposición de semillas en las pistas A/B
src/simulator.js   Mecánica de tiros: duplicados, re-roll, garantizados, casillas protegidas
src/optimizer.js   Dijkstra multi-objetivo, reglas de tiempo y formato de las rutas
src/diagnostics.js Por qué una ruta no consigue un gato (protecciones, fechas, choques…)
src/unavailable.js Gatos que no entran en el plan: busca en otros banners y más adelante
scripts/validate.js         Comprueba la mecánica local contra godfat en vivo
scripts/update-fixtures.js  Regenera los datos de test desde godfat
test/                       Suite de tests (node:test) con datos reales guardados
```

**Scraping.** Por cada banner se carga `?seed=…&event=…&count=N` (godfat muestra como máximo 300 filas
por página; para más se piden páginas sucesivas con la semilla de la fila 301, 601…) y se leen las celdas
`td.position.cat` (las celdas `score` se ignoran): resultado normal (`1A`), garantizado (`1AG`),
alternativo por duplicado (`1AR`) y alternativo garantizado (`1ARG`), además del pool del banner.

**Duplicados entre banners.** godfat solo dibuja el resultado alternativo cuando el duplicado viene
de la casilla anterior *del mismo banner*. Al alternar banners el duplicado puede venir de otro,
así que el re-roll se calcula localmente con la semilla:

- Pista A, posición N: rareza = `seq[2N-1]`, slot = `seq[2N]`; pista B: `seq[2N]`, `seq[2N+1]`.
- Re-roll: se quita el gato duplicado del pool rare y se elige `pool[xorshift(slot) % (tamaño-1)]`;
  se salta de `NA` a `(N+1)B` o de `NB` a `(N+2)A`.
- Garantizado: el uber sale de `uber[semillaRareza(Q) % tamaño]`, siendo Q la casilla tras los
  10 tiros normales.

Las reglas coinciden con la [ayuda de godfat](https://bc.godfat.org/help) («Consecutive duplicated rare
cats», «Hidden track switches between events», «Switching track is the effect of making a half roll»).
Al arrancar cada búsqueda se comparan estos cálculos con todo lo que godfat dibuja para cada banner.
Si en un banner no coinciden (pools con gatos repetidos, tipos de garantizado desconocidos), ese
cálculo se desactiva en lugar de adivinarlo, y se avisa en la interfaz.

**Optimización.** Cada estado es (posición, último gato, objetivos conseguidos, tickets
restantes, descuentos pendientes, momento). Las acciones son tiro simple o garantizado en cualquier
banner activo. Se ejecuta un Dijkstra por criterio, con dos podas exactas: el «último gato» solo se
distingue si puede duplicarse en la casilla siguiente, y un estado con más objetivos conseguidos y
coste menor o igual descarta al otro. Con 20 objetivos la búsqueda completa tarda unos segundos por ruta.

## Tests

```bash
npm test                  # suite offline (rng, simulador, optimizador, scraper, validación)
npm run test:live -- "<url>" 2026-10-08 2026-10-18   # compara con godfat en vivo
npm run update-fixtures -- 2026-10-16 2026-10-20     # regenera los datos de test
```

El test central rehace cada ruta tirada a tirada con el simulador y comprueba posiciones, gatos,
costes, orden de fechas, casillas protegidas y objetivos.

## Limitaciones

- Solo se miran los N tiros elegidos por pista (200 por defecto).
- En los step-up solo se usa el step-up completo (3+5+7). Los tests usan un banner que godfat simula
  como step-up, porque ahora mismo no hay ninguno real.
- godfat no publica la hora exacta de los eventos: se asume un único cambio diario.
- Los resultados del scraping se cachean 30 minutos por semilla, fechas y número de tiros.
