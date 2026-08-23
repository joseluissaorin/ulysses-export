# Ulysses Export en el móvil (iOS y Android)

El PDF lo compone el propio plugin con Typst compilado a WebAssembly, así
que en el móvil funciona **igual que en el escritorio**: mismo motor,
mismas hojas `.ulss`, mismo resultado. No hace falta ningún servicio
externo ni conexión (salvo la primera vez, para traerse el motor).

## Instalar

### Opción A — con BRAT (la más cómoda)

1. Instala el plugin **Obsidian42 – BRAT** desde los plugins de la
   comunidad.
2. En sus ajustes: *Add Beta plugin* → pega la dirección del repositorio
   (`https://github.com/USUARIO/ulysses-export`).
3. Activa **Ulysses Export** en Ajustes → Plugins de la comunidad.

BRAT también te avisará de las actualizaciones.

### Opción B — a mano

1. Descarga de la última *release* los archivos `main.js`,
   `manifest.json` y `styles.css`.
2. Colócalos en `TU_VAULT/.obsidian/plugins/ulysses-export/` (esa carpeta
   la puedes crear desde el gestor de archivos del teléfono, o desde el
   ordenador si sincronizas el vault).
3. Reinicia Obsidian y activa el plugin.

### Opción C — sincronizando desde el ordenador

Si ya lo usas en el escritorio y sincronizas el vault (Obsidian Sync,
iCloud, Dropbox…), el plugin viaja solo. Ojo: Obsidian Sync tiene que
tener activada la sincronización de **ajustes y plugins**.

## La primera vez

La primera exportación a PDF descarga dos cosas y las guarda para
siempre en la carpeta del plugin:

| Qué | Tamaño | Para qué |
|---|---|---|
| `typst.wasm` | ~21 MB | El motor de composición |
| 12 archivos en `fuentes/` | ~4 MB | Tipografías de reserva (Tinos, Arimo, Cousine) |

Hazlo con wifi. Puedes adelantarlo con el comando **«Preparar para usar
sin conexión (motor y tipografías)»**: descarga ambas cosas de una vez y
después el plugin ya no necesita internet nunca más.

La descarga del motor se comprueba con su huella SHA-256 antes de usarlo.

## Tipografías: lo importante en el móvil

En el escritorio el plugin usa las tipografías instaladas en el sistema.
**En el móvil eso no es posible**: ni iOS ni Android dejan que una app
lea los archivos de las tipografías del sistema. Por eso:

- El plugin se descarga un juego de reserva (**Tinos**, **Arimo** y
  **Cousine**), que son métricamente compatibles con Times New Roman,
  Arial y Courier New. Con ellas el PDF sale bien compuesto, aunque la
  letra no sea la que pide el estilo.
- Para que el PDF del móvil salga **idéntico al del escritorio**, copia
  al vault los archivos de tus tipografías (`.ttf`, `.otf`, `.ttc`) en
  una carpeta —por defecto `Tipografías`, configurable en los ajustes—.
  Por ejemplo, para los estilos Novela y Universidad harían falta
  `Baskerville.ttc` y `Optima.ttc`.

En macOS esas dos están en `/System/Library/Fonts/Supplemental/`. Cópialas
a la carpeta `Tipografías` del vault y sincroniza: a partir de ahí el
móvil compone exactamente igual que el ordenador.

Cuando el plugin tiene que sustituir una familia por otra, te lo dice con
un aviso al exportar.

## Usar

1. Abre la nota.
2. Menú **⋮** → *Exportar con un estilo de Ulysses…* (o desde la paleta
   de comandos).
3. Elige el estilo y pulsa **PDF**.

El PDF se guarda en la carpeta de salida del vault (por defecto
`Exportaciones`), desde donde puedes compartirlo con el botón de compartir
del sistema.

En el móvil no aparece el botón «Imprimir…»: esa vía dependía del diálogo
de impresión del escritorio y ya no hace falta, porque el PDF que genera
el plugin es el mismo.

## Rendimiento y límites

- Un cuento de cuatro páginas tarda menos de un segundo en un ordenador
  corriente; en un teléfono moderno la composición es del mismo orden,
  más el tiempo de arrancar el motor la primera vez de cada sesión
  (unos segundos, porque hay que compilar 21 MB de WebAssembly).
- El motor ocupa memoria mientras trabaja. En teléfonos antiguos o con
  poca RAM, un documento muy largo (cientos de páginas con imágenes)
  puede quedarse sin memoria; en ese caso, exporta por partes.
- Todo ocurre en el teléfono: ningún texto sale de tu dispositivo.
