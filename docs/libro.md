# Novelas y libros

Desde la 2.1 el plugin compone también lo que una hoja `.ulss` no puede
describir y un libro necesita: imágenes a página completa, capítulos que
abren en página impar, poemas que no se parten mal, conversaciones de chat
o de teatro, epígrafes y la raya de diálogo bien puesta.

Todo sale igual en el **PDF**, en el **DOCX** y en el **HTML**, y funciona
igual en el móvil, porque es el mismo motor. Nada de esto toca tu nota:
son decisiones de composición que se toman al exportar.

---

## Láminas a sangre

Una **lámina** es una imagen que ocupa una página entera, sin márgenes (a
sangre), como la ilustración de un libro. El plugin la reconoce solo:

- tiene la **proporción de la página**, con un 2 % de margen de error, en
  vertical o en apaisado. Toda la serie A comparte la proporción √2, así
  que un A4 sirve igual para un libro en A4 que en A5;
- y tiene **resolución suficiente**: al menos 100 ppp a tamaño de página
  (en A4, 1169 píxeles por el lado largo). Un SVG vale por su proporción.

Un caligrama de 3508 × 2481 píxeles, por ejemplo, es un A4 apaisado a
300 ppp: se convierte en lámina.

**Dónde va.** Exactamente donde la pusiste. El texto anterior cierra su
página, la lámina ocupa la siguiente y el texto continúa en la otra.
Funciona aunque la imagen esté pegada al final de una frase
(`…entre un golpe y el siguiente.![[faro.png]]`): el párrafo se parte ahí. Si hubiera texto
detrás, sigue en la página siguiente como el mismo párrafo, sin sangría.

**Sin folio.** La página cuenta en la numeración, pero el número no se
imprime encima del dibujo.

**Láminas apaisadas en un libro vertical.** Hay dos maneras, y se elige en
el diálogo de exportar:

| Opción | Qué hace | Para qué |
|---|---|---|
| **Girada en página vertical** *(por defecto)* | La gira 90° dentro de la página, con la parte de arriba del dibujo hacia la izquierda, como se hace en imprenta | Imprimir y encuadernar |
| **Página apaisada** | Esa página del PDF pasa a ser horizontal | Leer en pantalla (al imprimir, la impresora la gira sola) |
| **Ninguna** | No hay láminas: todas las imágenes van dentro del texto | |

**Control a mano**, con lo que Obsidian admite tras la barra:

| En la nota | Qué hace |
|---|---|
| `![[caligrama.png\|página]]` | La fuerza como lámina aunque no tenga la proporción (entonces va entera, sin recortar) |
| `![[foto.png\|texto]]` | Nunca como lámina |
| `![[caligrama.png\|girada]]`, `\|apaisada` | Orientación para esa imagen, sea cual sea la opción general |
| `![[mapa.png\|300]]`, `\|300x200` | Ancho (o ancho y alto máximos) en píxeles, como en Obsidian |
| `![[mapa.png\|Mapa de la casa\|300]]` | Lo que no es tamaño ni palabra clave es el pie de foto |

(Antes de la 2.1, un `|300` acababa impreso como pie de foto.)

**Consejo para caligramas.** Expórtalos con la proporción exacta de la
página (A4: 3508 × 2480 píxeles a 300 ppp) o en SVG con el texto pasado a
trazados, para que no dependa de las tipografías instaladas.

---

## Capítulos, páginas en blanco y doble cara

El plugin entiende ahora la página como la entiende Ulysses:

- **`section-break: heading-2`** hace que los titulares de nivel 2 **y
  todos los superiores** abran sección (página nueva). Antes solo se
  entendía `heading-1`. Con `paragraph-divider`, son los divisores los que
  abren sección.
- **`two-sided: yes`** compone para imprimir a doble cara: márgenes en
  espejo (el interior va hacia el lomo) y cada sección empieza en página
  impar, con una página en blanco delante si hace falta. Esa página en
  blanco no lleva folio.
- **`page-binding: right`** encuaderna por la derecha y lo invierte todo.
- **`:first-page`** de `area-footer` se aplica a la primera página de
  **cada sección**, no solo a la del documento. Si pones
  `area-footer :first-page { content: none }`, los capítulos abren sin
  número de página, como en los libros.

En el diálogo de exportar, **«Imprimir a doble cara»** viene con lo que
diga el estilo y se puede cambiar para esa exportación: apagado, no hay
márgenes en espejo ni páginas en blanco.

---

## Poesía

- **Cursivas que cruzan versos.** `_regresa⏎sin haberse⏎movido._` se
  compone en cursiva verso a verso, como en Obsidian.
  Antes cada verso se leía por separado y se veían los `_` y los `*`.
- **Secciones en verso.** Si la mayoría de los párrafos de un tramo (lo
  que va entre titulares o separadores) son verso, sus párrafos de una sola
  línea («Duermes.», una hora como `_23:28_`) también son
  versos: sin la sangría de la prosa. Salvo que desentonen: si los versos
  van sangrados y la línea no, o si es mucho más larga, es prosa entre
  estrofas.
- **Estrofas enteras.** Una estrofa de hasta cuatro versos no se parte
  nunca entre páginas; las más largas dejan al menos dos versos a cada lado
  del corte, y un verso suelto no se queda solo al pie si sigue más poema.

---

## Conversaciones

Un chat o una obra de teatro escritos así:

```markdown
_Marta ha iniciado sesión._

**Marta** sigues despierta?

**Inés** sí

**Marta** mira por la ventana
```

se componen como un **registro**: al margen, sin sangría de primera línea,
sin aire entre turnos, sin justificar y con sangría francesa para los
mensajes largos. Los avisos en cursiva y las líneas cortas que quedan entre
dos turnos (un mensaje escrito y borrado, `~~se ve el barco~~`) entran en
el mismo bloque.

La detección es prudente: hacen falta al menos tres líneas de chat en un
tramo, dos interlocutores o más, alguno repetido y mensajes cortos. Los
rótulos de unos apuntes (`**Definición:** …`) no cuentan; los nombres de
teatro en mayúsculas (`**DON JUAN:** …`) sí. Probada sobre diez mil notas
reales, solo salta en novelas y en obras de teatro.

Para cambiar su aspecto, define `paragraph-chat` en la hoja (ver
[Crear estilos](guias/03-crear-estilos.md)): por ejemplo, otra tipografía
para lo que pasa en la pantalla.

---

## Epígrafes

La cita corta (hasta tres párrafos y 400 caracteres) que va justo debajo
de un titular se compone como **epígrafe**: a la derecha, en el 60 % final
de la caja, un 10 % más pequeña y sin sangría, con la cursiva y el color
de la cita del estilo.

Viene **desactivado**, porque en unos apuntes una cita bajo un titular no
siempre es un epígrafe. Se activa en el diálogo de exportar, en los
ajustes o en la propia nota con `ulysses-epigrafes: true`. Su aspecto se
cambia con `block-epigraph` en la hoja.

---

## La raya de diálogo

Según el [DPD](https://www.rae.es/dpd/raya), la raya que abre un diálogo
va **pegada** al parlamento: «—¿No vienes?», no «— ¿No vienes?». El plugin
la pega al exportar, y de paso cambia por raya el guion corto (–) o la
barra (―) si abren la línea. No la toca cuando lo que sigue empieza en
minúscula («— expresiva,»), porque entonces es una enumeración, y ahí la
raya va separada.

Se puede desactivar en el diálogo o en los ajustes.

---

## Opciones al exportar y propiedades de la nota

Todo lo anterior se decide en tres sitios, y cada uno manda sobre el
anterior:

1. **Ajustes → Ulysses Export → Libro**: los valores por defecto.
2. **Las propiedades de la nota** (el bloque `---` del principio):

   ```yaml
   ---
   ulysses-estilo: Novela
   ulysses-epigrafes: true
   ulysses-laminas: girada
   ---
   ```

3. **El diálogo de exportar**, sección *Composición de libro*: lo elegido
   ahí vale para esa exportación.

| Propiedad | Valores |
|---|---|
| `ulysses-estilo` | El nombre del estilo que el diálogo propone para esa nota |
| `ulysses-laminas` | `girada` (o `imprenta`), `apaisada` (o `pantalla`), `no` |
| `ulysses-doble-cara` | `true`, `false` o `estilo` |
| `ulysses-epigrafes` | `true`, `false` |
| `ulysses-conversaciones` | `true`, `false` |
| `ulysses-raya-pegada` | `true`, `false` |
| `ulysses-tamano-pagina` | `a4`, `letter` (o `carta`), `legal` (o `oficio`) |
| `ulysses-modo-lineas` | `auto`, `verso`, `salto`, `parrafo` |
| `ulysses-sangria-verso` | Un número, en cuadratines |
| `ulysses-comentarios` | `true`, `false` |
| `ulysses-numero-inicial`, `ulysses-desde-pagina` | Números |

Las claves admiten tildes y mayúsculas (`ulysses-epígrafes` vale igual).

La terminal entiende las mismas propiedades y, además, sus propias
opciones (`--laminas`, `--doble-cara`, `--epigrafes`,
`--conversaciones`, `--raya`, `--tamano`):

```bash
node scripts/exportar.mjs novela.md Novela.ulss novela.pdf --laminas apaisada
node scripts/exportar.mjs novela.md Novela.ulss novela.docx
```

---

## En el DOCX y en el HTML

- **DOCX.** La lámina va en su propia sección, sin márgenes ni pie,
  anclada a la página detrás del texto (girada 90° o en página apaisada).
  Los capítulos a doble cara son secciones de Word que empiezan en impar,
  y el documento lleva márgenes simétricos. Word lo pagina igual que el
  PDF.
- **HTML y «Imprimir…».** La lámina usa una página con nombre de CSS, sin
  márgenes. Chromium no inserta la página en blanco para que un capítulo
  abra en impar: en esa vía, el capítulo empieza en la página siguiente,
  sea par o impar.

---

## Imágenes que admite el PDF

PNG, JPEG, GIF y SVG. Una imagen WebP (u otro formato) no rompe la
exportación: se deja fuera y se avisa para que la conviertas.
