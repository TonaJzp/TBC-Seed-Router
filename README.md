# TBC Seed Router

Planificador de tiradas para **The Battle Cats**. A partir de tu semilla calcula la forma más barata
de conseguir los gatos que quieres, combinando los banners de las próximas fechas: tiros simples,
11-draws, garantizados y cambios de pista por rare duplicado.

**Úsala aquí: https://tonajzp.github.io/TBC-Seed-Router/**

Funciona en el navegador, también en el móvil. Es gratuita, no tiene anuncios y no necesita cuenta.
Todo se calcula en tu dispositivo: lo que escribes no se envía a ningún sitio.

**¿Te resulta útil?** Con una donación me ayudas a mantenerla al día y a seguir creando herramientas
gratuitas para la comunidad ([más información](#apoya-el-proyecto)).

[![Apoyar el proyecto en Ko-fi](https://img.shields.io/badge/Ko--fi-Apoyar_el_proyecto-a3401c?logo=kofi&logoColor=white)](https://ko-fi.com/tonajzp)

Herramienta de fans no oficial, sin relación con PONOS. Se apoya en los datos abiertos de
[Battle Cats Rolls](https://bc.godfat.org/) (godfat); ver [Créditos y licencia](#créditos-y-licencia).

---

## Contenido

1. [Lo básico en dos minutos](#lo-básico-en-dos-minutos)
2. [Cómo usarla, paso a paso](#cómo-usarla-paso-a-paso)
3. [Cómo leer los resultados](#cómo-leer-los-resultados)
4. [Después de tirar](#después-de-tirar)
5. [Qué tiene en cuenta](#qué-tiene-en-cuenta)
6. [Preguntas frecuentes](#preguntas-frecuentes)
7. [De dónde salen los datos y cómo se vigilan](#de-dónde-salen-los-datos-y-cómo-se-vigilan)
8. [Privacidad y datos guardados](#privacidad-y-datos-guardados)
9. [Apoya el proyecto](#apoya-el-proyecto)
10. [Créditos y licencia](#créditos-y-licencia)

---

## Lo básico en dos minutos

En The Battle Cats, lo que sale en cada tirada del gacha no es aleatorio en el momento: está decidido
de antemano por tu **semilla** (*seed*). Si conoces tu semilla, sabes qué gato te va a salir en cada
tirada, en cualquier banner. [bc.godfat.org](https://bc.godfat.org/) te enseña esas tablas; esta
herramienta las usa para decidir **en qué banner y de qué forma tirar** para llegar a los gatos que
quieres gastando lo mínimo.

| Término | Qué significa |
|---------|---------------|
| **Semilla** | El número que decide todas tus tiradas futuras. Avanza con cada tirada que haces. |
| **Casilla (1A, 1B, 2A…)** | Cada tirada posible de tu semilla. El número es la fila (la tirada nº 1, 2, 3…) y la letra la pista. Es la misma numeración que en godfat. |
| **Pistas A y B** | Tu semilla tiene dos columnas de tiradas. Normalmente avanzas por la misma pista (1A → 2A → 3A…), salvo que algo te haga cambiar. |
| **Rare duplicado / cambio de pista** | Si te sale el mismo gato Rare que en la tirada anterior, el juego lo cambia por otro y tu siguiente tirada salta a la otra pista. La herramienta lo aprovecha para llegar a casillas que de otra forma no alcanzarías. |
| **Banner** | Cada evento del gacha (con sus fechas y sus gatos). La misma casilla da gatos distintos según el banner en el que tires. |
| **11-draw** | 11 tiradas seguidas por 1500 Cat Food. |
| **Garantizado** | 11-draw que asegura un Uber al final: 10 tiradas normales y luego el Uber. La tirada del Uber te pasa a la otra pista (ver [Tipos de banner y costes](#tipos-de-banner-y-costes)). |
| **Casilla de legendario** | Casilla que da un gato Legend Rare en los banners que los tienen. Son muy escasas, por eso la herramienta puede protegerlas (ver [Casillas de legendario](#casillas-de-legendario)). |

---

## Cómo usarla, paso a paso

### 1. Pega la URL de tu semilla

Si ya usas [bc.godfat.org](https://bc.godfat.org/), copia la dirección de tu semilla tal como la
tienes abierta, por ejemplo `https://bc.godfat.org/?seed=123456789&last=50`, y pégala en «URL de tu
semilla en godfat o número de semilla».

- Si la dirección incluye `last=…` (el último gato que sacaste), se tiene en cuenta: decide si tu
  próxima tirada cuenta como rare duplicado.
- Si marcas en godfat por dónde vas pulsando el número de una casilla, la dirección lleva `pos=…`
  (por ejemplo `pos=12B`) y la ruta empieza en esa casilla. Esa dirección no guarda cuál fue tu
  último gato, así que la herramienta te avisa si eso puede cambiar tu primera tirada. Lo más seguro
  es actualizar la semilla: en godfat, pulsa el nombre del último gato que sacaste y pega la
  dirección a la que te lleva.
- También vale escribir solo el número de semilla (sin `last`).
- Solo sirve para la versión en inglés (la global): las direcciones de otras versiones (`lang=jp`,
  `lang=tw` o `lang=kr`) se rechazan.

> ¿No sabes tu semilla? Se averigua en bc.godfat.org con el buscador de semillas («Seed seeker»)
> introduciendo tus últimas tiradas. Sigue la [ayuda de godfat](https://bc.godfat.org/help).

### 2. Elige los gatos que quieres

Escribe parte del nombre en «Gatos que quieres conseguir» y elígelo con el ratón (o con las flechas y
Enter).

- Busca también por el nombre de las otras formas del gato: «Ritual Saint Kasli» encuentra a Kasli
  the Scourge.
- Si dos gatos se llaman igual, a su lado aparece la rareza para distinguirlos.
- Puedes pegar una lista de nombres separados por comas o en líneas distintas: se añaden todos los que
  se reconozcan y se avisa de los que no.
- No hay límite de gatos. Puedes quitar uno con la × o todos con «Quitar todos».

### 3. Elige las fechas

Solo se usan los banners que estén activos entre «Desde» y «Hasta».

- «Desde» no puede ser anterior a hoy (según la fecha de tu dispositivo). Si eliges un día futuro, la
  ruta empieza ese día.
- La ruta empieza en el momento en que calculas: un banner que termina hoy se usa hasta su hora de
  cierre (normalmente las 11:00) y a partir de entonces ya no.
- Por defecto se proponen las próximas dos semanas. Un rango más amplio da más banners con los que
  combinar, y a menudo rutas más baratas.

### 4. Cuántos tiros revisar

Cuántas filas de tu semilla se revisan desde tu posición (200 por defecto, entre 20 y 1000). Si un
gato solo sale más adelante en tu semilla, sube este número; la propia herramienta te dice cuánto si
hace falta. Más filas solo alargan un poco el cálculo.

### 5. Inventario, descuentos y protecciones

- **Rare Tickets y Cat Food**: lo que tienes ahora. Si tu Cat Food no alcanza para ninguna ruta, se
  recomienda la que menos te pide y se indica cuánto te falta (ver [Cuál se recomienda](#cuál-se-recomienda)).
- **Descuentos disponibles**: marca solo los que tengas activos en tu cuenta (el primer 11-draw a
  750 Cat Food y el primer tiro simple a 30). El plan decide si le conviene usarlos.
  - **Incluirlo siempre en la ruta** (bajo el 11-draw a 750, marcada por defecto): el juego no acumula
    este descuento, así que si te da otro antes de que uses el que tienes, lo perderías. Con la casilla
    marcada, todas las rutas lo gastan, de la forma más barata para cada una (normalmente dentro de
    los tiros que harías igualmente). Si no se puede (por ejemplo, no te llega la Cat Food para pagarlo),
    la ruta sale igual y en «Descuentos» se explica por qué no se usa.
- **Protección de casillas de legendario**: marcadas por defecto. El «?» de cada opción explica qué
  hace (pasa el ratón por encima o tócalo). Ver [Casillas de legendario](#casillas-de-legendario).

### 6. Pulsa «Calcular rutas»

En unos segundos verás tres rutas, con la recomendada en primer lugar. Mientras calcula, la página sigue
respondiendo: verás qué ruta está buscando y los segundos que lleva, y puedes pulsar «Cancelar» (vuelve
lo que había antes). El análisis nunca se corta a medias: si tarda más de 15 segundos, la página te
sugiere reducir las fechas, los tiros o los gatos. Lo que escribes se guarda en tu
navegador para la próxima vez (ver [Privacidad y datos guardados](#privacidad-y-datos-guardados)).

---

## Cómo leer los resultados

Los resultados aparecen en este orden.

### Resumen del análisis

Arriba, tu semilla y tres cifras: cuántos tiros por pista se han revisado, cuántos banners entran en
tus fechas y el valor de un Rare Ticket (150 Cat Food) con el que se comparan las rutas. Si tu
dirección marca la posición (`pos=…`), también la casilla en la que empiezas. Debajo hay dos
filas que se despliegan al pulsarlas, cada una con su número de elementos:

- **Banners analizados**: cada banner con sus fechas y horas, y su tipo (simples y 11-draw,
  garantizado o step-up). Los que no se pueden usar aparecen como «Excluido» con el motivo, por
  ejemplo los que se pagan con tickets Platinum o Legend.
- **Casillas de legendario en tus próximos tiros**: todas las casillas moradas y lilas de tu semilla
  y qué legendario darían en cada banner de tus fechas. Cada uno tiene un botón **«Añadir a
  objetivos»** que lo añade a tu lista y recalcula.

Si marcaste la protección de las lilas, una última fila con el punto lila indica si se están
protegiendo (y por qué banner) o si se usan como casillas normales porque no hay ningún banner así.

### Avisos

Recuadros amarillos con información importante: si los datos están desactualizados o si la última
comprobación contra godfat encontró diferencias. En ese caso, comprueba cada paso en godfat antes de
gastar nada.

### Tabla de rutas

La tabla de rutas muestra tres, cada una con un criterio distinto. La recomendada lleva
la etiqueta «Recomendada», va primero y es la que se abre al calcular; pulsa otra fila para ver sus
pasos debajo.

| Ruta | Criterio (por orden de prioridad) |
|------|-----------------------------------|
| Menor coste total | menor coste total (Cat Food + 150 × tickets) → menos Cat Food → menos tiros |
| Máximo ahorro de Cat Food | menos Cat Food → menos tickets → menos tiros |
| Máximo ahorro de Rare Tickets | menos tickets → menos Cat Food → menos tiros |

En caso de empate, gana la ruta con menos cambios de banner y, después, la que se puede hacer antes.
Si dos criterios llevan a la misma ruta, se indica («Misma ruta que la recomendada», por ejemplo) en
lugar de repetirla, y si llevan a otra ruta con las mismas cifras, «Mismo coste que…».

| Columna | Qué indica |
|---------|------------|
| Primera columna | Qué prioriza la ruta y, debajo, una frase que lo explica (o «Misma ruta que la recomendada» si coincide con otra). |
| Objetivos | Cuántos de tus gatos consigue la ruta (en rojo si no son todos). |
| Rare Tickets / Cat Food | Lo que gasta de cada recurso. |
| Coste total | Cat Food + 150 por cada Rare Ticket, como en el juego. Es lo que compara «Menor coste total». |
| Tiros | Número total de tiradas. |
| 11-draws | Cuántos 11-draws o step-ups hace la ruta y, debajo, cuántos son garantizados (o step-up completos) y cuántos step-up se quedan en el paso 1 o 2. El resto son tiros simples. |
| ¿Te alcanza? | «Sí» si la Cat Food que tienes basta para hacer la ruta entera; si no, cuánta te falta. Los Rare Tickets nunca faltan: cada ruta solo usa los que tienes y paga el resto con Cat Food. |

#### Cuál se recomienda

- **Normalmente, «Menor coste total»**: la que menos recursos gasta en conjunto, contando cada Rare
  Ticket como 150 Cat Food, como en el juego.
- **Si tu Cat Food no alcanza para ninguna ruta, «Máximo ahorro de Cat Food»**: la que menos Cat Food
  te pide, porque gasta primero tus Rare Tickets. «Menor coste total» puede gastar menos en conjunto
  porque prefiere 11-draws (más baratos por tiro que un tiro simple), pero deja tickets sin usar y te
  pide más Cat Food de la que tienes. Por ejemplo, con 70 tickets y 500 Cat Food, «Menor coste total»
  podría usar 8 tickets y pedirte 11.500 Cat Food más, y «Máximo ahorro de Cat Food» usar los 70 y
  pedirte solo 3.100. En ese caso, el detalle de la ruta explica por qué se recomienda.

### Detalle de la ruta

- **Cifras**: coste total, Rare Tickets y Cat Food que gasta (y los que tienes), número de tiros y
  **posición final**: la casilla en la que quedará tu semilla al terminar la ruta.
- **Descuentos**: en qué paso se usa cada descuento que marcaste o, si no se usa, por qué.
- **Objetivos**: en qué paso consigues cada gato. Los que faltan salen en rojo y su motivo está en
  [«Por qué no se puede conseguir todo»](#por-qué-no-se-consigue-todo).
- **Casillas de legendario en esta ruta**: cada casilla de legendario por la que pasa la ruta, qué
  sacas en ella y qué otros legendarios podrías sacar ahí con los banners abiertos en ese momento:
  - **Misma ruta**: tira esa casilla en ese otro banner y te llevas el legendario sin cambiar nada
    más ni gastar más.
  - **Cambia la ruta**: conseguirlo obliga a cambiar el resto de la ruta. Pulsa «Añadir a objetivos»
    y se recalcula para conseguirlo junto a los demás.
  - Si la ruta gasta alguna casilla de legendario sin sacar el legendario, un aviso te lo dice.

### Pasos

La ruta, paso a paso, en el orden en que debes hacerlos.

| Columna | Qué indica |
|---------|------------|
| # | Número de paso. |
| Día | Desde qué día puedes hacerlo. «desde las 11:00» si el banner abre ese día; «antes de las 11:00» si cierra ese día, y entonces es tu último momento. Si el mismo banner continúa justo después, se indica hasta cuándo puedes seguir usándolo. |
| Banner | Dónde tirar, con sus fechas. Si cambia respecto al paso anterior, se marca «cambio de banner». **El nombre abre esa misma tabla en godfat**, en la casilla donde empieza el paso, para que compruebes los gatos antes de tirar. Si el paso está más allá de las 300 filas que muestra godfat, el enlace empieza la tabla en esa casilla, que allí aparece como 1A. También empieza ahí, con tu último gato, cuando godfat dibujaría la primera tirada del paso de otra forma: por ejemplo, un rare repetido que en tu ruta no se repite porque vienes de otro banner o de un garantizado. Si el banner **aún no ha empezado**, el paso lo indica y un aviso arriba lo explica: si antes llega una actualización que le añade gatos, cambian las casillas de la rareza de esos gatos (casi siempre ubers) y la ruta puede cambiar desde ese paso; vuelve a calcular cuando empiece. |
| Acción | Tiro simple (o varios seguidos), 11-draw, 11-draw garantizado o step-up (paso 1, pasos 1 y 2, o completo). «con descuento» si usa uno; «solo para gastar el descuento» si es un 11-draw que la ruta hace después de conseguir todos los objetivos, únicamente para no perder el descuento. |
| Posición | De qué casilla a qué casilla va el paso. «cruce por duplicado» si dentro del paso hay un cambio de pista por rare duplicado. |
| Pago | Rare Tickets y Cat Food (CF) que cuesta el paso. |
| Gatos | Todo lo que sacas en ese paso. |

Las filas resaltadas son los pasos en los que consigues un gato objetivo. Debajo de la tabla hay una
leyenda con lo que significa cada marca:

| Marca | Significado |
|-------|-------------|
| Borde gris, amarillo, naranja o morado | Rare, Super Rare, Uber Rare o Legend Rare. |
| Gato resaltado | Uno de tus objetivos. |
| ↺ | Rare duplicado: el juego lo cambió por otro y la siguiente tirada va por la otra pista. |
| ★ | Uber del garantizado. |
| Punto morado o lila | La tirada cae en una casilla de legendario. |
| Gato tachado | Es un objetivo, pero cae en una casilla protegida y por eso no cuenta ahí. |

### Por qué no se consigue todo

Si falta algún gato, se explica el motivo con las casillas y banners concretos de tu semilla, qué
puedes hacer y enlaces para comprobarlo en godfat:

| Motivo | Qué se indica |
|--------|---------------|
| No sale en el gacha | Es un gato Normal o Especial: no se consigue tirando. |
| No está en los banners de tus fechas | En qué otro banner próximo sale y a qué fecha ampliar «Hasta». |
| No sale en los tiros revisados | La primera fila donde aparece (busca hasta 1000) y cuántos tiros poner. |
| Solo sale en casillas protegidas | Qué protección lo impide y en qué casillas sale. |
| Las fechas lo impiden | Qué banner hace falta y por qué ya no está activo. |
| Ninguna combinación de tiros llega | Dónde sale y qué cambios de pista lo impiden. |
| Choca con otro objetivo | Con qué gato choca: conseguir uno obliga a dejar atrás al otro. |

---

## Después de tirar

1. **Haz los pasos en orden**, cada uno en su banner, y sin tirar nada más entre medias.
2. **Compruébalo en godfat antes de gastar**: el enlace de cada paso abre la tabla justo en esa
   casilla. Si lo que ves no coincide con el plan, para y revisa tu semilla.
3. **Cuando termines (o si haces cualquier otra tirada)**, tu semilla ha avanzado. Actualiza tu
   semilla en godfat y pega la nueva URL para la próxima vez. La «posición final» del plan te dice
   dónde deberías estar.
4. **Si cambian tus planes** (quieres otro gato, se anuncia un banner nuevo, no llegaste a tiempo a un
   paso), vuelve a calcular desde donde estés.

---

## Qué tiene en cuenta

### Tiempo

Cada banner abre y cierra a una hora concreta (casi siempre las 11:00) que el juego aplica en la hora
local de tu dispositivo, y la web la usa igual (debajo de las fechas verás tu zona horaria). Las horas
salen de los archivos de eventos del juego que publica godfat; si faltara alguna, la tarea diaria lo
avisa. Un banner «S ~ E» está activo desde su hora del día S hasta su hora del día E.

La ruta solo avanza en el tiempo: puedes alternar entre banners que coinciden, pero en cuanto tiras en
uno que empieza más tarde, los que ya han terminado dejan de estar disponibles.

### Tipos de banner y costes

| Tipo | Acciones |
|------|----------|
| Normal | tiro simple; 11-draw (11 tiros) por 1500 Cat Food |
| Garantizado | tiro simple; 11-draw garantizado (10 tiros + uber) por 1500 Cat Food |
| Step-up 3+5+7 | tiro simple; paso 1 (3 tiros) por 300 Cat Food; pasos 1 y 2 (8 tiros) por 1050; step-up completo (14 tiros + uber) por 2100 |
| Platinum / Legend | no se usan: se pagan con sus propios tickets (Platinum Ticket y Legend Ticket), no con Rare Tickets ni Cat Food |

- **Tiro simple**: usa un Rare Ticket mientras te queden; después, 150 Cat Food (30 con el descuento
  de primer tiro, una vez).
- **Descuento 11-Draw** (750 Cat Food, una vez): vale para el 11-draw normal o el garantizado.
- **Uber garantizado**: tras las 10 tiradas normales, el Uber se elige con la semilla de la casilla
  siguiente, y esa tirada te pasa a la otra pista: de una casilla A a la B de la misma fila (si
  empiezas en 15A, el Uber sale en 25A y sigues en 25B), o de una B a la A de la fila siguiente (si
  empiezas en 17B, el Uber sale en 27B y sigues en 28A). Es lo que godfat muestra como «-> 25B» o
  «<- 28A». Ojo: si entre esas 10 tiradas hay un rare duplicado, ese ya te cambió de pista, y el Uber
  te devuelve a la pista en la que empezaste. En el step-up funciona igual, tras sus 14 tiradas.
- **Step-up** (eventos Busters y algunas colaboraciones; sustituye al 11-draw): paso 1 = 3 tiros por
  300, paso 2 = 5 por 750, paso 3 = 7 por 1050 con uber garantizado en el 7.º. La ruta puede quedarse
  en el paso 1 o en el 2 (el paso 1 sale a 100 Cat Food por tiro). La oferta vuelve al paso 1 30
  minutos después de comprar el paso 1, o al acabar el paso 3: si la ruta repite el step-up, el paso
  dice desde qué hora. Los pasos van seguidos, sin tiros simples en medio, y no se pagan con Rare
  Tickets. Fuente: el cartel oficial del evento («Increasing Capsules»).
- Para comparar rutas, **1 Rare Ticket = 150 Cat Food**, que es lo que cuesta un tiro simple.

### Casillas de legendario

- **Moradas**: dan legendario en los banners que tienen legendarios (en los demás, un uber).
- **Lilas**: solo dan legendario en banners con más probabilidad de legend (Royalfest, doble
  legend…). Se detectan por las probabilidades de cada banner. Su protección solo se aplica si a partir
  de «Desde» hay un banner así anunciado, aunque sea después de «Hasta»; si no, se tratan como
  casillas normales y un aviso lo indica.
- Si un banner tiene más del 0,6 % de legend (por ejemplo, un 0,7 %), también da legendario en
  algunas casillas que godfat pinta como uber. Aquí esas casillas cuentan como lilas mientras ese
  banner se pueda usar, y una nota lo indica.

**Proteger** una casilla no impide pasar por ella: un gato objetivo que salga ahí no cuenta (salvo
que sea el propio legendario), y el plan lo busca en otra casilla para no gastar la oportunidad de
legendario. Si quieres usar esas casillas para cualquier gato, desmarca la protección.

---

## Preguntas frecuentes

**¿Para qué versión del juego sirve?**
Para la versión en inglés (la global), que es la que usan los datos de godfat con los que trabaja.
Si pegas una dirección de godfat de otra versión (`lang=jp`, `tw` o `kr`), te lo indica en vez de
calcular con banners que no son los tuyos.

**¿Toca mi cuenta o el juego?**
No. Solo calcula a partir de tu semilla. No se conecta al juego ni a tu cuenta, y no necesita ningún
dato tuyo aparte de la semilla.

**¿Es seguro al 100 %?**
Si tu semilla y el último gato (`last`) son correctos y haces los pasos tal cual, lo que sale es lo
que indica el plan: la app calcula las tablas con el mismo algoritmo que godfat y se comprueba contra
godfat cada día. Aun así, comprueba cada paso en godfat antes de gastar; para eso está el enlace.

**¿Por qué la ruta tira en un banner que no tiene el gato que quiero?**
Porque tirar ahí es la forma más barata de mover tu semilla hasta la casilla buena, o de provocar un
rare duplicado que te cambia de pista. Lo importante es la casilla a la que llegas, no el banner.

**¿Tengo que hacer cada paso el día exacto?**
No: el día indicado o después, mientras el banner siga activo y respetando el orden. Lo que no puedes
es hacer un paso cuando su banner ya ha cerrado.

**¿Qué pasa si hago una tirada que no está en el plan?**
Tu semilla avanza y el plan deja de valer desde ese punto. Cualquier tirada del gacha raro cuenta,
también las de Platinum o Legend Ticket. Actualiza tu semilla en godfat y vuelve a calcular.

**¿Por qué no aparece un banner?**
Puede estar fuera de tus fechas, haber terminado ya, pagarse con tickets Platinum o Legend (se
muestran como excluidos) o no estar anunciado todavía: solo aparecen los banners que el juego ya ha
publicado.

**¿Puedo pedir muchos gatos a la vez?**
Sí, no hay límite. Con muchos objetivos el cálculo tarda algo más y es más fácil que alguno choque
con otro; en ese caso se explica cuál.

**La app me avisa de que algo no coincide con godfat. ¿Qué hago?**
Comprueba cada paso en godfat antes de tirar. El aviso desaparece cuando el problema se corrige.

**He encontrado un error o tengo una sugerencia. ¿Dónde lo digo?**
Tienes dos opciones:

- Escribir a [tbcseedrouter@gmail.com](mailto:tbcseedrouter@gmail.com). El enlace «Reportar un
  error» del pie de la web abre el correo ya rellenado con los datos de tu formulario.
- Abrir una [incidencia en el repositorio](https://github.com/TonaJzp/TBC-Seed-Router/issues) (necesitas una cuenta de GitHub).

Si es un error de cálculo, explica qué ha pasado e incluye los datos con los que hiciste el análisis,
para poder repetirlo: la URL de tu semilla, los gatos elegidos, las fechas «Desde» y «Hasta», los
tiros revisados, tus Rare Tickets y Cat Food, los descuentos y protecciones que marcaste, y en qué
ruta y paso no coincide lo que salió. Una captura ayuda mucho.

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
tienen más de 3 días. Al pie de la página verás de qué fecha son los datos y cuándo se comprobaron
por última vez contra godfat.

---

## Privacidad y datos guardados

- Todo se calcula en tu navegador. Tu semilla, tus gatos, tus fechas y tu inventario no se envían a
  ningún sitio. No hay cookies ni publicidad.
- Estadísticas anónimas con [GoatCounter](https://www.goatcounter.com/), sin cookies: solo se cuenta
  cada visita y cada cálculo de rutas, nunca lo que escribes en el formulario. Si tu navegador
  envía Do Not Track o Global Privacy Control, no se cuenta nada.
- Tu navegador guarda el último formulario y el tema claro u oscuro (botón junto al título) para
  que no tengas que repetirlos. Puedes borrarlos con «Borrar datos guardados»,
  al pie de la página. Si tu navegador bloquea los datos del sitio, la web funciona igual,
  solo que no recuerda nada.
- Más detalles en la página [Créditos, licencias y privacidad](https://tonajzp.github.io/TBC-Seed-Router/credits.html).

---

## Apoya el proyecto

TBC Seed Router es gratis, sin anuncios y sin registro, y quiero seguir mejorándola. Una donación me
ayuda a seguir manteniéndola y a crear más herramientas gratuitas para la comunidad de The Battle Cats.
Puedes donar con tarjeta o PayPal, sin crear cuenta.

[![Apoyar el proyecto en Ko-fi](https://img.shields.io/badge/Ko--fi-Apoyar_el_proyecto-a3401c?logo=kofi&logoColor=white)](https://ko-fi.com/tonajzp)

Compartirla con otros jugadores también ayuda mucho.

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

Errores, sugerencias y contacto: [tbcseedrouter@gmail.com](mailto:tbcseedrouter@gmail.com) o las
[incidencias del repositorio](https://github.com/TonaJzp/TBC-Seed-Router/issues) (ver [cómo avisar de un error](#preguntas-frecuentes)).

---

### English

TBC Seed Router is an unofficial, free route planner for The Battle Cats gacha (English version):
given your seed, it finds the cheapest sequence of rolls across upcoming banners to get the cats you
want. It runs entirely in the browser at https://tonajzp.github.io/TBC-Seed-Router/, using the open
data and roll algorithm of [Battle Cats Rolls](https://gitlab.com/godfat/battle-cats-rolls) (godfat,
Apache 2.0), checked daily against bc.godfat.org. The interface is in Spanish. © 2026 TonaJzp, all
rights reserved: the source is public to read, but copying, hosting or monetising it needs permission
(see [LICENSE](LICENSE)). Not affiliated with PONOS. If you find it useful, a donation helps keep it up
to date and fund more free tools for the community:
[support the project on Ko-fi](https://ko-fi.com/tonajzp) (card or PayPal).
