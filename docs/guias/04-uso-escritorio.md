# 4. Usarlo en el escritorio (Windows, macOS, Linux)

---

## Exportar una nota

1. **Abre la nota** que quieras exportar.
2. Abre el **diálogo de exportación**, por cualquiera de estas vías:
   - Paleta de comandos (`Ctrl+P` / `Cmd+P`) →
     **«Exportar con un estilo de Ulysses…»**
   - Menú **⋮** de la pestaña de la nota → misma opción.
3. En el diálogo:

   | Campo | Qué es |
   |---|---|
   | **Estilo** | La hoja `.ulss` con la que se compone. El lápiz de al lado abre el editor. |
   | **Mostrar todos los estilos** | Solo para esta vez; enseña también los que tengas ocultos. |
   | **Tamaño de página** | A4, Carta u Oficio. **Se ignora si el estilo declara el suyo** (Keynote 16:9, por ejemplo). |
   | **Guardar en** | Carpeta del vault donde va el archivo. |

4. Pulsa el botón del formato que quieras:

   | Botón | Qué produce |
   |---|---|
   | **PDF** | El PDF compuesto por el plugin. Es el botón principal. |
   | **DOCX** | Documento de Word con estilos con nombre, notas al pie y numeración nativas. |
   | **HTML** | Un archivo autónomo con el CSS derivado de la hoja. |
   | **Imprimir…** | Abre el diálogo de impresión del sistema (solo escritorio). |

El archivo aparece en la carpeta de salida (por defecto `Exportaciones`).
Si ya existe uno con ese nombre, se añade un número: `Mango 2.pdf`.

> **PDF frente a Imprimir…**: el botón *PDF* compone el documento dentro
> del plugin y es el que funciona igual en el móvil. *Imprimir…* usa el
> motor del sistema; se mantiene por comodidad (para mandar a una
> impresora de verdad), y produce un resultado equivalente.

---

## Los ajustes

**Ajustes → Ulysses Export.**

### Estilos y salida

| Ajuste | Para qué |
|---|---|
| **Estilo por defecto** | El que aparece seleccionado al abrir el diálogo. |
| **Tamaño de página** | A4 / Carta / Oficio, cuando el estilo no manda. |
| **Estilos que se ofrecen al exportar** | Lista, uno por línea. Deja vacío para verlos todos. |
| **Mostrar todos los estilos** | Ignora la lista anterior. |
| **Carpeta de salida** | Dónde se guardan los archivos exportados. |
| **Carpeta de estilos adicional** | Solo si quieres declarar una carpeta concreta; desde la 2.0.2 no hace falta, se buscan por todo el vault. |
| **Carpeta de tipografías** | Ídem para las tipografías. |

### Cómo se interpreta el texto

| Ajuste | Para qué |
|---|---|
| **Líneas dentro de un párrafo** | Qué hacer cuando escribes varias líneas seguidas sin dejar una en blanco. Ver abajo. |
| **Ancho del tabulador** | En «em». 0 = usar el que diga la hoja. |
| **Sangría francesa del verso** | Cuánto se sangra la continuación de un verso largo (por defecto 2 em). |
| **Títulos de bibliografía** | Los titulares que activan la sangría francesa de referencias. |
| **Incluir comentarios** | Saca también los bloques `%% … %%` de Obsidian. |

#### «Líneas dentro de un párrafo», en detalle

Es el ajuste que más cambia el resultado en textos literarios:

- **Automático** *(recomendado)*: si las líneas llevan sangría o son
  cortas, las trata como **verso**; si no, como párrafo con saltos.
- **Siempre verso**: cada línea es un párrafo propio, con su sangría. Para
  poesía.
- **Salto de línea**: un solo párrafo con saltos duros dentro.
- **Unir en un solo párrafo**: markdown clásico; las líneas se juntan.
  Es lo que hace Ulysses, y por eso pierde las estrofas.

---

## Qué entiende de tus notas

| En la nota | En el PDF |
|---|---|
| `# Título` … `###### Título` | Titulares de nivel 1 a 6 |
| Texto separado por línea en blanco | Párrafos |
| `**negrita**`, `*cursiva*`, `~~tachado~~`, `==resaltado==` | Estilos de texto |
| `` `código` `` y bloques ` ``` ` | Código en línea y en bloque |
| `> cita` | Cita en bloque |
| `- viñeta` / `1. numerada` | Listas, con anidado |
| `\| tabla \|` | Tablas, con alineación por columna |
| `![[imagen.png]]` o `![alt](ruta)` | Imágenes (con su pie si hay `alt`) |
| `texto[^1]` y `[^1]: nota` | Notas al pie |
| `***` | El divisor que defina el estilo (línea, `*****`, salto de página…) |
| `[[Enlace interno]]` | Su texto (o el alias) |
| `%% comentario %%` | Oculto, salvo que el estilo o los ajustes digan lo contrario |
| `— Diálogo` | Diálogo a la española: raya al margen y vuelta alineada |
| Líneas con tabulaciones | Verso, respetando la sangría de cada línea |

El *frontmatter* (`---` al principio) se ignora.

---

## Flujo de trabajo recomendado

1. Escribe en Obsidian con normalidad.
2. Ten dos o tres estilos preparados y limita la lista con **«Estilos que
   se ofrecen al exportar»**: el diálogo queda más rápido.
3. Cuando quieras afinar un estilo, ábrelo con el lápiz del diálogo y usa
   **«Usar mi nota»** en la previsualización: verás tu texto real.
4. Exporta a **PDF** para leer o mandar; a **DOCX** si tienes que
   entregarlo en Word y que alguien lo retoque.

---

## Rendimiento

- Un cuento de cuatro páginas: menos de un segundo.
- La primera exportación de cada sesión tarda unos segundos más: hay que
  arrancar el motor (21 MB de WebAssembly) y, si es la primera vez del
  todo, indexar las tipografías del sistema. Después queda en caché.

---

## Problemas frecuentes

**No aparece ningún estilo en el diálogo**
No hay `.ulss` en el vault ni en la carpeta del plugin. Ver
**[2. Estilos y tipografías](02-estilos-y-tipografias.md)**.

**El PDF sale con otra letra**
La tipografía que pide el estilo no está instalada; el aviso al exportar
dice cuál se ha usado en su lugar.

**El estilo declara Carta y yo quiero A4**
Manda el estilo. Cambia `page-width`/`page-height` en su
`document-settings`, o quítalos para que respete el ajuste del plugin.

**Los versos salen unidos**
Cambia *Líneas dentro de un párrafo* a **Siempre verso**.

**Quiero ver los comentarios `%%`**
Actívalo en *Incluir comentarios*, o pon `visibility: visible` en
`block-comment` dentro del estilo.

---

Anterior: **[3. Crear estilos](03-crear-estilos.md)** ·
Siguiente: **[5. Usarlo en iPhone y iPad](05-uso-ios.md)**
