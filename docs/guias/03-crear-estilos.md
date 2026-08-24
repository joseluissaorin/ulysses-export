# 3. Crear y editar estilos

Un estilo es un archivo de texto con extensión `.ulss`. Puedes escribirlo
a mano o usar el **editor con previsualización** que trae el plugin.

---

## El editor visual

### Abrirlo

Paleta de comandos → **«Crear o editar un estilo de exportación…»**

(También desde el diálogo de exportar: el botón del lápiz junto al
selector de estilo abre ese mismo estilo en el editor.)

Se abre como una pestaña más de Obsidian, partida en dos:

- **Izquierda:** los controles, organizados en pestañas.
- **Derecha:** la página compuesta de verdad, que se repinta con cada
  cambio. No editas a ciegas: mueves el interlineado y lo ves moverse.

### La barra de arriba

| Control | Qué hace |
|---|---|
| Selector | Cambia de estilo, o **«— Crear uno nuevo —»** |
| `· sin guardar` | Aparece cuando hay cambios sin guardar |
| **Deshacer** | Vuelve atrás paso a paso |
| **Ver cambios** | Muestra exactamente qué líneas del `.ulss` han cambiado |
| **Guardar como…** | Guarda una copia con otro nombre |
| **Guardar** | Guarda encima (deja antes una copia `.bak`) |

### Las pestañas

| Pestaña | Qué contiene |
|---|---|
| **Básico** | Tipografía, cuerpo, interlineado, alineación, márgenes de página y sangría de primera línea |
| **Titulares** | Los seis niveles: tamaño, peso, cursiva, color, espacio antes y después, alineación |
| **Bloques** | Cita en bloque, bloque de código, listas (marca y sangría), divisor y tablas |
| **Texto** | Negrita, cursiva, tachado, resaltado, enlaces, código en línea, citas |
| **Página y notas** | Tamaño y márgenes, número de página, notas al pie, ajustes del párrafo |
| **Extensiones** | Lo que el plugin añade sobre Ulysses: bibliografía, verso, tabulador, numeración |
| **Avanzado** | Todas las propiedades en bruto y el `.ulss` como texto editable |
| **Biblioteca** | Estilos disponibles, para copiar ajustes de unos a otros |

Arriba hay también un **buscador**: escribe «interlineado» o «margen» y te
lleva a los controles que coincidan, estén en la pestaña que estén.

Y dos atajos útiles: **Cuerpo +1 pt / −1 pt** (escala todo el documento) y
**Cambiar todas las tipografías…** (sustituye una familia por otra en toda
la hoja de una vez).

### La previsualización

Por defecto usa un texto de muestra. Con **«Usar mi nota»** compone la
nota que tengas abierta, que es la mejor forma de ver el estilo con tu
material real. **«Guías»** dibuja el borde del área de texto.

> El editor reescribe el `.ulss` **propiedad a propiedad**: respeta tus
> comentarios, el orden y todo lo que no toques. Y antes de sobrescribir
> guarda una copia `.bak` al lado.

---

## Escribir un `.ulss` a mano

El formato es un lenguaje parecido a CSS. Lo esencial:

```ulss
// Los comentarios empiezan por dos barras

// Variables: se declaran con $ y se usan por su nombre
$gris = #777777

// Mixins: bloques reutilizables, se declaran con @
@code {
    font-weight: normal
    font-slant:  normal
}

// Un bloque de propiedades para un selector
defaults {
    font-family:     "Baskerville"
    font-size:       11pt
    line-height:     21pt
    text-alignment:  justified
    hyphenation:     no
}

// Herencia de un mixin, con dos puntos
inline-code : @code {
    font-color: $gris
}
```

Las propiedades se separan por salto de línea o por `;`. Las unidades
admitidas son `pt`, `mm`, `cm`, `in`, `em` y `%`.

### Selectores principales

| Selector | A qué afecta |
|---|---|
| `document-settings` | Tamaño de página, márgenes, dos caras, saltos de sección, notas |
| `defaults` | Tipografía y medidas base de todo el documento |
| `paragraph` | Los párrafos de prosa |
| `paragraph :first` | Solo el primer párrafo del documento |
| `paragraph + paragraph` | Un párrafo que va detrás de otro |
| `heading-all + paragraph` | El párrafo que sigue a cualquier titular |
| `heading-all`, `heading-1` … `heading-6` | Titulares |
| `block-quote`, `block-quote paragraph` | Citas en bloque |
| `block-code`, `block-code paragraph` | Bloques de código |
| `block-comment` | Comentarios `%% … %%` de Obsidian |
| `list-all`, `list-ordered`, `list-unordered` | Listas (anida repitiendo: `list-ordered list-ordered`) |
| `paragraph-divider` | El separador `***` |
| `paragraph-figure`, `figure-caption` | Imágenes y sus pies |
| `table`, `table-cell`, `table-cell :header` | Tablas |
| `area-header`, `area-footer` | Cabecera y pie de página |
| `area-footnotes` | Zona de notas al pie |
| `inline-strong`, `inline-emphasis`, `inline-delete`, `inline-mark`, `inline-code`, `inline-link`, `inline-citation`, `inline-footnote` | Estilos de texto |

### Propiedades más usadas

**Tipografía y texto**

| Propiedad | Valores |
|---|---|
| `font-family` | `"Baskerville"` (entre comillas) |
| `font-size` | `11pt`, `120%` |
| `line-height` | `21pt`, `120%` — en Ulysses es absoluto |
| `font-weight` | `normal`, `bold`, `semibold` |
| `font-slant` | `normal`, `italic` |
| `font-color` | `#333333` o una variable |
| `background-color` | `#FEFECC` |
| `underline`, `strikethrough` | `single`, `none` |
| `text-alignment` | `left`, `right`, `center`, `justified` |
| `visibility` | `visible`, `hidden` (para ocultar comentarios, etiquetas…) |

**Espaciado y párrafo**

| Propiedad | Para qué |
|---|---|
| `margin-top`, `margin-bottom` | Espacio antes y después |
| `margin-left`, `margin-right` | Sangrías laterales |
| `first-line-indent` | Sangría de primera línea (negativa = francesa) |
| `keep-with-following` | `yes` — no separar del párrafo siguiente |
| `orphans-and-widows` | `prevented` |
| `page-break` | `before`, `after`, `none` |
| `hyphenation` | `yes`, `no` (ver nota más abajo) |
| `default-tab-interval` | Ancho del tabulador |

**Página (dentro de `document-settings`)**

| Propiedad | Para qué |
|---|---|
| `page-width`, `page-height` | Tamaño propio (si no, manda el ajuste del plugin) |
| `page-inset-top/bottom/inner/outer` | Márgenes |
| `two-sided` | `yes` para páginas pares e impares |
| `section-break` | `heading-1`, `heading-2`… empieza página nueva en ese nivel |
| `column-count`, `column-spacing-width` | Texto a varias columnas |
| `footnote-placement` | `end-of-page`, `end-of-document` |
| `footnote-style` | `decimal`, `roman`, `alpha`, `symbol` |
| `footnote-enumeration` | `continuous`, `per-section` |

**Listas**

| Propiedad | Para qué |
|---|---|
| `enumeration-format` | La marca: `"%d."`, `"%*.%d"`, `"—"`, `"-"`, `"%p."` |
| `enumeration-style` | `decimal`, `lowercase-alpha`, `uppercase-roman`… |
| `text-inset` | Distancia de la marca al texto |
| `margin-left` | Sangría de la lista (se acumula al anidar) |

En `enumeration-format`: `%d` (o `%p`) es el número de este nivel y `%*`
es el texto del nivel padre. Así, `"%*.%d"` da `1.1`, `1.2`…

**Cabecera y pie**

| Propiedad | Para qué |
|---|---|
| `content` | `page-number`, `none`, o un texto entre comillas |
| `text-alignment` | `left`, `center`, `right` |
| `top-spacing`, `bottom-spacing` | Distancia al borde |

---

## Un estilo mínimo completo

Copia esto en un archivo `Mi estilo.ulss` dentro de tu vault:

```ulss
//
// Mi estilo — punto de partida
//

document-settings {
    page-inset-top:    25mm;  page-inset-inner: 25mm
    page-inset-bottom: 25mm;  page-inset-outer: 25mm
    two-sided:         no
    footnote-placement: end-of-page
    footnote-style:     decimal
}

defaults {
    font-family:    "Times New Roman"
    font-size:      12pt
    line-height:    18pt
    text-alignment: justified
    hyphenation:    no
}

paragraph {
    first-line-indent: 12.5mm
    margin-top:        1mm
    margin-bottom:     1mm
}

paragraph :first {
    first-line-indent: 0pt
}

heading-all {
    font-weight:         bold
    keep-with-following: yes
    margin-bottom:       2mm
}

heading-1 { font-size: 18pt; line-height: 24pt; text-alignment: center }
heading-2 { font-size: 16pt; line-height: 22pt; margin-top: 4mm }
heading-3 { font-size: 14pt; line-height: 20pt; margin-top: 3mm }

block-quote {
    margin-left:  15mm
    margin-right: 15mm
    margin-top:   5mm
    font-slant:   italic
}

list-all       { margin-left: 5mm }
list-ordered   { enumeration-format: "%d."; text-inset: 1.3em }
list-unordered { enumeration-format: "—";   text-inset: 1.3em }

area-footer {
    content:        page-number
    text-alignment: center
    bottom-spacing: 10mm
    font-size:      10pt
}

area-footnotes {
    font-size:   10pt
    line-height: 14pt
}

inline-strong   { font-weight: bold }
inline-emphasis { font-slant:  italic }
inline-link     { underline:   single }
inline-comment  { visibility:  hidden }
```

Ejecuta **«Recargar las hojas de estilo»** y ya lo tienes en la lista.

---

## Detalles que conviene saber

**El guionado no se aplica.** Aunque la hoja diga `hyphenation: yes`, el
plugin no parte palabras con guion. Es deliberado: el renderizador
anterior (el navegador dentro de Obsidian) tampoco lo hacía —no lleva
diccionarios—, y guionizar aquí rompería la equivalencia entre ambos.

**Los `em` de los márgenes.** Ulysses los interpreta a razón de 0,6 × el
cuerpo del texto, salvo en `text-inset`, donde vale 1 × cuerpo. El plugin
reproduce esa rareza para que las listas queden donde deben.

**Extensiones propias del plugin** (no existen en Ulysses):

- `paragraph-bibliography` — sangría francesa para las referencias. Si no
  lo declaras, se aplican 1,25 cm bajo los títulos que indiques en
  *Ajustes → Títulos de bibliografía*.
- `figure-caption` — el pie de las imágenes.

**Qué pasa con lo que no se entiende.** Las propiedades desconocidas se
ignoran sin romper nada. Si un valor está mal escrito, el editor lo dice
al aplicar.

---

Anterior: **[2. Estilos y tipografías](02-estilos-y-tipografias.md)** ·
Siguiente: **[4. Usarlo en el escritorio](04-uso-escritorio.md)**
