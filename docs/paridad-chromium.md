# Paridad con Chromium: el modelo de composición

El emisor Typst (`src/typst.js`) no traduce la hoja `.ulss` de manera
aproximada: reproduce el modelo de composición con el que Chromium imprime
el HTML del plugin, medido contra PDFs reales (`Producer: Skia/PDF`).
Con ello, el PDF compuesto por Typst es indistinguible del que salía del
diálogo de impresión: en los dos documentos de calibración (4 y 10
páginas, 442 líneas) la desviación máxima de cada línea base es de
**0,02 pt** — el cuanto de LayoutUnit — y la diferencia rasterizada queda
en flecos de antialiasing.

Todo lo que sigue está **medido**, no copiado de ninguna especificación.
Las constantes viven en `src/typst.js`.

## Página

- Skia imprime a 300 ppp y **trunca** el tamaño de página a unidades
  enteras de dispositivo: A4 (595×842 pt) → `floor(pt·300/72)/300·72` =
  **594,96 × 841,92 pt**.
- El contenido se compone en **píxeles CSS** (1 pt = 4/3 px) y se imprime
  encogido por un factor constante medido
  `S = 3,1237822/3,125 = 0,999610304`.
- Márgenes: el origen del área de contenido se redondea a píxel entero
  (izquierda `ceil`, arriba `round`); el bloque contenedor inicial mide
  `floor(página_px) − floor(margen_izq_px) − floor(margen_der_px)` de
  ancho (y lo análogo de alto).

## Longitudes y cuerpos

- Toda longitud CSS vive en **LayoutUnit**: 1/64 px, truncada.
- El cuerpo de fuente se trunca a **centésimas de píxel** (caché de
  fuentes de Blink) y, para los avances de los glifos, a **1/64 px**
  (FreeType, `FT_Set_Char_Size`): 11 pt → 14,66 px → 14,65625 px.
- Los avances de glifo son exactamente `unidades·cuerpo₆₄/upm`, sin
  redondear por glifo.

## Caja de línea

- Ascendente y descendente de la fuente (tabla `hhea`; `OS/2` si está
  activo `USE_TYPO_METRICS`) se escalan al cuerpo y se **redondean a
  entero** (`SkScalarRoundToScalar`).
- La altura de línea reparte el sobrante en dos mitades y la de arriba se
  trunca: `mitad = floor((LH − (asc+desc))/2)`; la línea base queda a
  `asc + mitad` del borde superior de la caja.
- **Las líneas base se pintan redondeadas a píxel entero.** El flujo
  vertical acumula fracciones (rellenos de 1 mm = 3,78125 px…), pero cada
  línea base se redondea al pintar. El emisor lo reproduce en dos
  pasadas: la primera compone con las medidas fraccionarias, se leen las
  posiciones con `query()` y la segunda retoca el relleno de cada bloque
  para clavar la línea base en el entero, arrastrando el error dentro de
  cada página.

En Typst esto se consigue fijando `top-edge`/`bottom-edge` del texto a
longitudes exactas y `leading: 0`.

## Rellenos verticales y fragmentación

- `padding-top` viaja **con la primera línea** (si el párrafo salta de
  página, no se repite): se emite como una caja invisible de ancho cero
  que hace más alta la primera línea.
- `padding-bottom` es un **bloque vacío de altura fija** tras el párrafo:
  si no cabe al final de la página, Blink pasa el **resto** a la página
  siguiente, y un `block(height: …, breakable: true)` de Typst hace
  exactamente lo mismo.
- Viudas y huérfanas: 2 y 2 (CSS `orphans: 2; widows: 2`), que coincide
  con la prevención por defecto de Typst.
- `keep-with-following` → `break-after: avoid` → `block(sticky: true)`.

## Justificado

- Chromium reparte el hueco sobrante **a partes iguales entre los
  espacios** (incluidos los espacios duros U+00A0). La línea final y las
  terminadas en salto duro no se justifican.
- Typst deja colgar la puntuación final de línea en los textos
  justificados («punctuation overhang»); Chromium no. Se desactiva con
  `set text(overhang: false)`.
- El partido de líneas es voraz (`linebreaks: "simple"`), como el de
  Chromium con `hyphens: manual`.

## `overflow-wrap: break-word`

Un tramo sin puntos de corte más ancho que la caja (típico: frases unidas
con espacios duros, o marcas de lista como «10.» en una caja de 1,3 em)
solo se parte **cuando arranca la línea**; si no, baja entero. El emisor
detecta esos tramos midiendo los avances reales (`src/metricas.js`, tablas
`cmap`+`hmtx`) y compone esas líneas a mano, con el mismo algoritmo y el
justificado repartido entre espacios normales y duros.

## Número de página

La caja de margen `@bottom-center` se compone en píxeles de página (sin el
factor S), con la tipografía del documento a 16 px, línea "normal"
centrada verticalmente en el margen inferior y línea base redondeada a
píxel. Se emite como `place()` en el `foreground` de la página.

## Verificación

`scripts/comparar.py referencia.pdf candidato.pdf [--png carpeta]`
compara los dos PDF línea a línea (línea base, x inicial, x final, texto)
y por píxeles, y genera superposiciones (referencia en un canal de color,
candidato en otro). Es la herramienta con la que se calibró todo lo
anterior.
