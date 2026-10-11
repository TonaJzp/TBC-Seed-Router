# TBC Seed Router

Planificador de tiradas para **The Battle Cats**. A partir de tu semilla calcula la forma más barata
de conseguir los gatos que quieres, combinando los banners de las próximas fechas: tiros simples,
11-draws, garantizados y cambios de pista por rare duplicado.

**Úsala aquí: https://tonajzp.github.io/TBC-Seed-Router/**

Funciona en el navegador, también en el móvil. Es gratuita, no tiene anuncios y no necesita cuenta.
Todo se calcula en tu dispositivo: lo que escribes no se envía a ningún sitio.

**¿Te resulta útil?** Con una donación me ayudas a mantenerla al día y a seguir creando herramientas
gratuitas para la comunidad: [apoyar el proyecto en Ko-fi](https://ko-fi.com/tonajzp) (con tarjeta o
PayPal).

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
hoy (según la fecha de tu dispositivo). La ruta empieza en el momento en que calculas: un banner que
termina hoy se usa hasta su hora de cierre (normalmente las 11:00) y a partir de entonces ya no.

### 4. Cuántos tiros revisar

Hasta qué fila de tu semilla se busca (200 por defecto, máximo 1000). Más filas solo alargan un poco
el cálculo.

### 5. Inventario, descuentos y protecciones

Pon tus Rare Tickets y tu Cat Food, marca los descuentos que tengas activos y elige si quieres
proteger las casillas de legendario (ver más abajo).

### 6. Pulsa «Calcular rutas»

Verás la **ruta recomendada** paso a paso y tres alternativas. Cada paso indica el día (y la hora
si importa: «antes de las 11:00» si el banner cierra ese día, «desde las 11:00» si abre), el banner
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

Cada banner abre y cierra a una hora concreta (casi siempre las 11:00) que el juego aplica en la hora
local de tu dispositivo, y la web la usa igual. Las horas salen de los archivos de eventos del juego
que publica godfat; si faltara alguna, la tarea diaria lo avisa. Un banner «S ~ E» está activo desde
su hora del día S hasta su hora del día E. La ruta solo
avanza en el tiempo: puedes alternar entre banners que coinciden, pero en cuanto tiras en uno que
empieza más tarde, los que ya han terminado dejan de estar disponibles.

### Tipos de banner y costes

| Tipo | Acciones |
|------|----------|
| Normal | tiro simple; 11-draw (11 tiros) por 1500 Cat Food |
| Garantizado | tiro simple; 11-draw garantizado (10 tiros + uber) por 1500 Cat Food |
| Step-up 3+5+7 | solo el step-up completo: 14 tiros + uber por 2100 Cat Food |
| Platinum / Legend | no se usan: se pagan con sus propios tickets (Platinum Ticket y Legend Ticket), no con Rare Tickets ni Cat Food |

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
legendario. Cada ruta indica por qué casillas de legendario pasa, qué sacas en cada una y todos los
legendarios que podrías sacar ahí con los banners activos en ese momento de la ruta, cada uno con un
botón para añadirlo a tus objetivos y recalcular.

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
  bc.godfat.org. La app no lee la web de godfat: calcula las tablas con su mismo algoritmo. La hora a la
  que abre y cierra cada banner sale del archivo de eventos del juego que godfat guarda en el mismo
  repositorio (`data/en/events`), de la misma versión.
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

## Créditos y licencia

**TBC Seed Router**, creado por [TonaJzp](https://github.com/TonaJzp). © 2026 TonaJzp, todos los
derechos reservados. El código está a la vista para que se pueda leer y comprobar cómo funciona, pero
no se puede copiar, publicar ni alojar en otro sitio, ni usar para sacar ingresos, sin permiso del
autor. Detalles en [LICENSE](LICENSE) y [NOTICE.md](NOTICE.md).

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
checked daily against bc.godfat.org. © 2026 TonaJzp, all rights reserved: the source is public to
read, but copying, hosting or monetising it needs permission (see [LICENSE](LICENSE)). Not affiliated
with PONOS. If you find it useful, a donation helps keep it up to date and fund more free tools for the
community: [support the project on Ko-fi](https://ko-fi.com/tonajzp) (card or PayPal).
