# TBC Seed Router

Planificador de tiradas para **The Battle Cats**. A partir de tu semilla calcula la forma más barata
de conseguir los gatos que quieres, combinando los banners de las próximas fechas: tiros simples,
11-draws, garantizados y cambios de pista por rare duplicado.

**Úsala aquí: https://tonajzp.github.io/TBC-Seed-Router/**

Funciona en el navegador, también en el móvil. Es gratuita, no tiene anuncios y no necesita cuenta.
Todo se calcula en tu dispositivo: lo que escribes no se envía a ningún sitio.

Herramienta de fans no oficial, sin relación con PONOS. Se apoya en los datos abiertos de
[Battle Cats Rolls](https://bc.godfat.org/) (godfat); ver [Créditos y licencia](#créditos-y-licencia).

---

## Cómo usarla, paso a paso

### 1. Consigue la URL de tu semilla

Si ya usas [bc.godfat.org](https://bc.godfat.org/), copia la dirección de tu semilla tal como la
tienes abierta, por ejemplo `https://bc.godfat.org/?seed=123456789&last=50`. Si la dirección
incluye `last=…` (el último gato que sacaste), se tiene en cuenta.

También vale escribir solo el número de semilla.

> ¿No sabes tu semilla? Se averigua en bc.godfat.org con el buscador de semillas («Seed seeker»)
> introduciendo tus últimas tiradas. Sigue la [ayuda de godfat](https://bc.godfat.org/help).

### 2. Elige los gatos que quieres

Escribe parte del nombre en «Gatos que quieres conseguir» y elige con el ratón (o con las flechas y
Enter). Busca también por el nombre de las otras formas del gato. Puedes pegar una lista separada
por comas. No hay límite.

### 3. Elige las fechas

Solo se usan los banners que estén activos entre «Desde» y «Hasta». «Desde» no puede ser anterior a
hoy (según la fecha de tu dispositivo). Los banners que terminan hoy no se usan: el juego cambia los
banners por la mañana (a las 11:00 en España) y los datos no traen la hora, así que puede que ya hayan
terminado.

### 4. Cuántos tiros revisar

Hasta qué fila de tu semilla se busca (200 por defecto, máximo 1000). Más filas solo alargan un poco
el cálculo.

### 5. Inventario, descuentos y protecciones

Pon tus Rare Tickets y tu Cat Food, marca los descuentos que tengas activos y elige si quieres
proteger las casillas de legendario (ver más abajo).

### 6. Pulsa «Calcular rutas»

Verás la **ruta recomendada** paso a paso y tres alternativas. Cada paso indica el día, el banner
(con sus fechas, y si cambia respecto al paso anterior) y las casillas. El nombre del banner abre esa
misma tabla en godfat, en la casilla donde empieza el paso, para que lo compruebes antes de gastar
nada. Si el paso está más allá de las 300 filas que muestra godfat, el enlace empieza la tabla en esa
casilla, que allí aparece como 1A.

| Ruta | Criterio (por orden de prioridad) |
|------|-----------------------------------|
| **Recomendada** | menor coste total (Cat Food + 150 × tickets) → menos Cat Food → menos tiros |
| Máximo ahorro de Cat Food | menos Cat Food → menos tickets → menos tiros |
| Máximo ahorro de Rare Tickets | menos tickets → menos Cat Food → menos tiros |
| Menos tiros | menos tiros → menor coste total |

En caso de empate, gana la ruta con menos cambios de banner y, después, la que se puede hacer antes.
Para el coste total, 1 Rare Ticket =
150 Cat Food, como en el juego. Si ninguna ruta cabe en tu Cat Food, se muestra igualmente la mejor
y cuánto falta. Si no se pueden conseguir todos los gatos, se da la ruta que consigue más y se
explica por qué faltan los demás.

---

## Qué tiene en cuenta

### Tiempo

Un banner «S ~ E» está activo desde el cambio de eventos del día S hasta el del día E (el cambio es por
la mañana: a las 11:00 en España). La ruta solo
avanza en el tiempo: puedes alternar entre banners que coinciden, pero en cuanto tiras en uno que
empieza más tarde, los que ya han terminado dejan de estar disponibles.

### Tipos de banner y costes

| Tipo | Acciones |
|------|----------|
| Normal | tiro simple; 11-draw (11 tiros) por 1500 Cat Food |
| Garantizado | tiro simple; 11-draw garantizado (10 tiros + uber) por 1500 Cat Food |
| Step-up 3+5+7 | solo el step-up completo: 14 tiros + uber por 2100 Cat Food |
| Platinum / Legend | se excluyen: se pagan con otros tickets |

- **Tiro simple**: usa un Rare Ticket mientras te queden; después, 150 Cat Food (50 con el descuento
  de primer tiro, una vez).
- **Descuento 11-Draw** (750 Cat Food, una vez): vale para el 11-draw normal o el garantizado.
- El uber garantizado se elige con media tirada, así que siempre cambia de pista.

### Casillas de legendario

- **Moradas**: dan legendario en los banners que tienen legendarios (en los demás, un uber).
- **Lilas**: solo dan legendario en banners con más probabilidad de legend (Royalfest, doble
  legend…). Se detectan por las probabilidades de cada banner.

**Proteger** una casilla no impide pasar por ella: un gato objetivo que salga ahí no cuenta (salvo
que sea el propio legendario), y el plan lo busca en otra casilla para no gastar la oportunidad de
legendario. Cada ruta indica por qué casillas de legendario pasa y qué legendario podrías sacar en
su lugar, con un botón para añadirlo a tus objetivos.

### Por qué no se consigue todo

Si falta algún gato, se explica el motivo con las casillas y banners concretos de tu semilla:

| Motivo | Qué se indica |
|--------|---------------|
| No sale en el gacha | Es un gato Normal o Especial |
| No está en los banners de tus fechas | En qué otro banner próximo sale y a qué fecha ampliar «Hasta» |
| No sale en los tiros revisados | La primera fila donde aparece (busca hasta 1000) y cuántos tiros poner |
| Solo sale en casillas protegidas | Qué protección lo impide y en qué casillas sale |
| Las fechas lo impiden | Qué banner hace falta y por qué ya no está activo |
| Ninguna combinación de tiros llega | Dónde sale y qué cambios de pista lo impiden |
| Choca con otro objetivo | Con qué gato choca: conseguir uno obliga a dejar atrás al otro |

---

## De dónde salen los datos y cómo se vigilan

- **Banners, gatos y probabilidades**: del archivo abierto `build/bc-en.yaml` del
  [repositorio de godfat](https://gitlab.com/godfat/battle-cats-rolls), el mismo con el que se genera
  bc.godfat.org. La app no lee la web de godfat: calcula las tablas con su mismo algoritmo.
- **Iconos**: de la [Battle Cats Wiki](https://battlecats.miraheze.org). Se descargan una vez al
  publicar la web, no en cada visita, y se reutilizan los que ya están publicados: a la wiki solo se
  le piden los de gatos nuevos.

Una tarea automática de GitHub hace esto **cada día**:

1. Ejecuta todos los tests.
2. Descarga la última versión de los datos de godfat y comprueba cada campo. Si aparece algo que la
   app no conoce (un campo nuevo, una probabilidad imposible, un gato que falta…), lo avisa en vez
   de suponerlo.
3. **Compara la app con bc.godfat.org** con una semilla aleatoria: la lista de banners y sus fechas
   y, en cada banner, los 300 primeros tiros de las dos pistas. Mira qué gato sale en cada casilla,
   los colores de legendario, las repeticiones de rare y los garantizados, y adónde lleva cada uno.
   Con los banners habituales son más de 10.000 casillas al día.
4. Publica la web con los datos nuevos.
5. Si algo falla, no coincide o falta el icono de algún gato de los banners, **abre una incidencia en
   el repositorio** (GitHub avisa por email al dueño). Si afecta a los cálculos, la web muestra
   además un aviso a los usuarios hasta que se resuelva. Cuando todo vuelve a estar en orden, la
   incidencia se cierra sola.

Si un día no se puede publicar, la web sigue funcionando con los datos del día anterior y avisa si
tienen más de 3 días.

---

## Usarla en tu ordenador (opcional)

No hace falta: la web publicada es la forma normal de usarla. Esto sirve para usarla en local o
para modificarla.

**Windows, sin usar la terminal:**

1. Instala [Node.js](https://nodejs.org) (versión «LTS»; siguiente, siguiente, finalizar).
2. En esta página, pulsa el botón verde **Code → Download ZIP** y descomprímelo.
3. Haz doble clic en **`Iniciar TBC Seed Router.bat`**. La primera vez instala lo necesario y
   descarga los datos (unos minutos, sobre todo por los iconos).
4. Se abre el navegador en http://localhost:3000. Deja la ventana negra abierta mientras la uses.

**Con la terminal** (Windows, macOS o Linux, Node.js 22 o superior):

```bash
npm install
npm start          # actualiza los datos si tienen más de 12 h y abre la app
```

Sin internet usa los últimos datos descargados.

---

## Para desarrolladores

```
public/                 La web (estática): todo lo que se publica
  index.html, app.js    Interfaz
  picker.js             Buscador de gatos
  credits.html          Créditos, licencias y privacidad
  core/                 El cálculo, sin dependencias (navegador y Node)
    gacha.js            Tablas de cada banner para una semilla (algoritmo de godfat)
    simulator.js        Tiradas: duplicados entre banners, garantizados, casillas protegidas
    optimizer.js        Dijkstra multiobjetivo, reglas de tiempo y rutas
    diagnostics.js      Por qué una ruta no consigue un gato
    unavailable.js      Gatos que no entran en el plan
    planner.js          Análisis completo a partir del formulario
  data/, icons/         Generados por scripts/build.js (no están en el repositorio)
scripts/
  build.js              Descarga y valida los datos de godfat, iconos de la wiki
  verify-godfat.js      Compara la app con bc.godfat.org
  notify.js             Incidencias automáticas en GitHub
  start.js, serve.js    Uso en local
  lib/                  Lectura de los datos y de las páginas de godfat, iconos, comparación
test/                   Tests (node:test). Las fixtures son tablas reales de bc.godfat.org
.github/workflows/web.yml   La tarea diaria
```

| Comando | Qué hace |
|---------|----------|
| `npm test` | Todos los tests, sin conexión |
| `npm run build` | Descarga los datos de godfat y los iconos → `public/data`, `public/icons` |
| `npm run verify` | Compara la app con bc.godfat.org ahora mismo (`--seed N` para fijar la semilla) |
| `npm run serve` | Sirve `public/` en http://localhost:3000 |

Los tests comparan cada casilla calculada con las tablas reales de godfat guardadas en `test/fixtures`
(normales, repeticiones de rare, garantizados de 7, 11 y 15 tiros) y comprueban que la vigilancia
detecta cualquier error introducido a propósito. El test del optimizador rehace cada ruta tirada a
tirada y comprueba posiciones, gatos, costes, fechas y objetivos.

**Mecánica** (la de godfat):
- Pista A, fila N: rareza con `seq[2N-1] % 10000`, gato con `seq[2N] % gatos de esa rareza`; pista B:
  `seq[2N]` y `seq[2N+1]`.
- Rare duplicado: se quita ese hueco y se vuelve a elegir con la siguiente semilla, tantas veces como
  el gato esté repetido en el banner. La siguiente tirada salta una semilla por cada intento.
- Garantizado: el uber sale de la semilla de rareza de la casilla tras los tiros normales.

**Publicación:** el repositorio debe ser público y, en *Settings → Pages*, la fuente debe ser
*GitHub Actions*. La tarea `web.yml` hace el resto cada día y en cada push a `main`.

---

## Créditos y licencia

**TBC Seed Router**, creado por [TonaJzp](https://github.com/TonaJzp). Código abierto con licencia
[AGPL-3.0](LICENSE) y una condición adicional: cualquier copia o versión modificada, también si se
publica como web, debe mantener visible «Basado en TBC Seed Router, creado por TonaJzp» con el
enlace a este repositorio, y no puede presentarse como el proyecto original. Detalles en
[NOTICE.md](NOTICE.md).

- **Battle Cats Rolls**, de Lin Jen-Shin (godfat), licencia Apache 2.0: datos de los banners y el
  algoritmo de tiradas, adaptado a JavaScript ([LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt)).
- **Battle Cats Wiki** (Miraheze): iconos de los gatos.
- **The Battle Cats** y sus imágenes © PONOS Corporation. Proyecto no afiliado ni aprobado por PONOS.

Errores y sugerencias: [incidencias del repositorio](https://github.com/TonaJzp/TBC-Seed-Router/issues).

---

### English

TBC Seed Router is an unofficial, free route planner for The Battle Cats gacha: given your seed, it
finds the cheapest sequence of rolls across upcoming banners to get the cats you want. It runs
entirely in the browser at https://tonajzp.github.io/TBC-Seed-Router/, using the open data and roll
algorithm of [Battle Cats Rolls](https://gitlab.com/godfat/battle-cats-rolls) (godfat, Apache 2.0),
checked daily against bc.godfat.org. Licensed under AGPL-3.0 with an attribution requirement (see
[NOTICE.md](NOTICE.md)). Not affiliated with PONOS.
