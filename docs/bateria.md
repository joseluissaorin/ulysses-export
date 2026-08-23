# Batería de equivalencia: renderizador antiguo (Chromium) contra Typst

## Qué se compara

La «manera antigua» del plugin componía el PDF imprimiendo el HTML de
`construirHtml` con el Chromium de Obsidian (`window.print()`). La batería
reproduce esa vía de forma automatizada y la enfrenta al renderizador
nuevo (Typst), documento a documento y estilo a estilo:

- **Referencia**: el HTML lo genera el propio plugin cargado en Obsidian
  (`exportarHtml`), y lo imprime el Chromium del propio Obsidian
  (`webContents.printToPDF` en una ventana oculta) con los parámetros
  calibrados contra impresiones reales del diálogo: escala 0,999610304 y
  papel del tamaño que declara el estilo. Único resto conocido frente al
  diálogo: el folio queda 1 px más abajo y el origen izquierdo puede
  diferir en 1 px según cómo cuantice el margen cada vía (se descuentan
  explícitamente en la comparación, avisándolo).
- **Candidato**: `exportarPdf` del plugin (Typst en WebAssembly), también
  ejecutado dentro de Obsidian.

Corpus: 8 documentos de tortura (`bateria/documentos/`) que ejercitan
titulares, párrafos con palabras y URL imposibles, diálogos con raya,
versos con tabuladores, listas anidadas de tres niveles y marcas anchas,
citas multiparágrafo, código con tabuladores, énfasis anidados, diez
notas al pie, tablas con celdas largas, separadores con salto de página y
trampas deliberadas de viudas y huérfanas. Por 17 hojas `.ulss` reales:
136 parejas de PDF.

Ejecución: `node scripts/bateria-obsidian.mjs` (con Obsidian lanzado con
`--remote-debugging-port=9222`) y después
`python3 scripts/bateria-comparar.py «carpeta de salida»`.

## Resultado (agosto de 2026)

Sobre ~4.400 líneas comparadas por posición exacta de línea base (con
emparejamiento por contenido):

| Categoría | Parejas |
|---|---|
| Idénticas al 100 % (tolerancia 0,06 pt) | 7 |
| Idénticas salvo desvíos menores de 1 px | 31 |
| Desvíos ≤ 2 px (tablas, filetes, subrayados de fila) | ~40 |
| Multicolumna (`column-count`) con diferencias interiores | 16 |
| Diferencias de reparto en el borde de página | ~30 |

Lo que esto significa en la práctica:

- **La prosa —el uso real del plugin— es indistinguible**: en los 17
  estilos, los documentos de texto corrido salen con las líneas base
  clavadas al píxel de Chromium (el desvío que queda es el cuanto de
  1/64 px y el redondeo por línea de los superíndices).
- **Tablas**: anchos de columna por contenido como el `table-layout:
  auto` de CSS; quedan a 1–2 px en tablas anchas con celdas que rompen
  (la aritmética interna exacta del reparto de Chromium no está
  replicada al 100 %).
- **Multicolumna**: se replica el equilibrado de columnas de Chromium
  (medido: ignora saltos forzados y balancea el artículo entero) y los
  casos de prosa cuadran; listas y diálogos dentro de columnas aún
  presentan diferencias de reparto.
- **Bordes de página**: cuando un bloque cae a menos de ~medio píxel del
  borde inferior, cada motor puede decidir distinto si lo mueve a la
  página siguiente (viudas/huérfanas/keep-with-following). El documento
  «07 Saltos y huérfanas» está diseñado para provocarlo. El efecto es un
  bloque que cambia de página, no una corrupción; en documentos reales
  es infrecuente.

## Hallazgos del camino (todos medidos, no supuestos)

La batería destapó y corrigió, entre otros: la hoja de estilos del
navegador en `blockquote`/`figure` (`margin: 1em 40px`), el modelo de
superíndices de Blink (`round₆₄(cuerpo/3) + 1 px` y redondeo del techo de
línea), los tabuladores del código con paradas de 8 espacios, el
`overflow-wrap` real (romper solo cuando el tramo arranca la línea), los
niveles de lista por tipo de ancestro como los selectores CSS, el
formato `%p` con `enumeration-style`, la sustitución de fuentes de
fontconfig (solo alias métricos; lo demás cae a la genérica → Times New
Roman), que el Chromium de Electron no guioniza nunca (sin diccionarios),
el bloque contenedor de `floor(hueco fraccionario) + 1` px, y que los
bordes de medio punto ocupan un píxel entero de flujo.
