# Ulysses Export para Obsidian

Exporta notas de Obsidian a **PDF, DOCX y HTML** usando **hojas de estilo
`.ulss` reales de [Ulysses](https://ulysses.app)** — las mismas que usas en el
Mac o las que descargues de la [galería de estilos](https://styles.ulysses.app).

La pieza central es un **compositor de PDF propio**: el PDF no sale de un
diálogo de impresión ni de un navegador, lo compone el propio plugin con
[Typst](https://typst.app) compilado a WebAssembly. Por eso funciona
**exactamente igual en escritorio (Windows, macOS, Linux) y en el móvil
(iOS, Android)**.

## Qué hace

- **PDF** compuesto dentro del plugin, con notas al pie, número de página,
  viudas y huérfanas, justificado, guiones de diálogo, listas anidadas,
  versos, tablas e imágenes.
- **DOCX** con estilos con nombre (reestilizable en Word), notas al pie
  nativas, numeración nativa y la misma geometría que el PDF.
- **HTML** autónomo con el CSS derivado de la hoja.
- Un **editor de hojas `.ulss`** con previsualización en vivo, para crear o
  retocar estilos sin salir de Obsidian.
- Extensiones prácticas sobre lo que hace Ulysses: sangría francesa
  automática en la bibliografía, modo verso para poemas y diálogo con raya
  a la española (`— ¿No vienes?`).

## El renderizador de PDF

El PDF se compone con el compilador de Typst en WebAssembly (~21 MB, se
descarga una única vez y se guarda en la carpeta del plugin). No hay
ninguna dependencia de Electron ni de servicios externos: todo ocurre en tu
máquina, también sin conexión.

El emisor no traduce la hoja «a ojo»: reproduce el **modelo de composición
de Chromium** medido contra PDFs reales, de modo que el resultado es
indistinguible del que producía la vía de impresión del navegador — línea
por línea y píxel por píxel (desviación máxima medida: 0,02 pt en
documentos de más de 400 líneas). Los detalles del modelo (unidades de
1/64 px, redondeo de líneas base, reparto del justificado, fragmentación
de página) están documentados en [`docs/paridad-chromium.md`](docs/paridad-chromium.md).

### Tipografías

- **Escritorio**: se usan las tipografías instaladas en el sistema. La
  primera vez se construye un índice (solo nombres, es rápido) que queda
  cacheado.
- **Móvil**: ni iOS ni Android dejan leer las tipografías del sistema, así
  que el plugin se descarga un juego de reserva (Tinos, Arimo y Cousine,
  métricamente compatibles con Times New Roman, Arial y Courier New). Para
  que el PDF salga idéntico al del escritorio, copia tus fuentes
  (`.ttf`, `.otf`, `.ttc`) a una carpeta del vault (por defecto
  `Tipografías`).
- Si una familia de la hoja no está disponible, se cae a la misma pila de
  alternativas que usa la exportación HTML y se te avisa.

## En el móvil

Funciona igual que en el escritorio, con el mismo motor y el mismo
resultado. La primera exportación descarga el motor (~21 MB, verificado
con su huella SHA-256) y las tipografías de reserva (~4 MB); el comando
**«Preparar para usar sin conexión»** los baja de una vez para no
depender de la red después.

Instrucciones completas —instalación con BRAT o a mano, tipografías,
rendimiento y límites— en **[`docs/movil.md`](docs/movil.md)**.

## Instalación

Manual, mientras no esté en el catálogo de plugins de la comunidad:

1. Descarga `main.js`, `manifest.json`, `styles.css` (y opcionalmente
   `typst.wasm`) de la [última release](https://github.com/joseluissaorin/ulysses-export/releases/latest).
2. Cópialos a `TU_VAULT/.obsidian/plugins/ulysses-export/`.
3. Activa el plugin en Ajustes → Plugins de la comunidad.

Si no copias `typst.wasm`, el plugin lo descarga solo la primera vez que
exportes un PDF.

## Uso

1. Copia tus hojas `.ulss` (o paquetes `.ulstyle`) a la carpeta `estilos`
   del plugin, o configura una carpeta del vault en los ajustes.
2. Con una nota abierta: paleta de comandos → **«Exportar con un estilo de
   Ulysses…»**.
3. Elige estilo y formato. Listo.

### Ejemplos

En [`ejemplos/`](ejemplos/) hay una nota de muestra exportada con dos
estilos distintos, con el `.md` de partida y los PDF resultantes:

| Nota | Estilo | Resultado |
|---|---|---|
| [`muestra.md`](ejemplos/muestra.md) | Novela (Baskerville, sangrías, `*****`) | [`muestra-novela.pdf`](ejemplos/muestra-novela.pdf) |
| [`muestra.md`](ejemplos/muestra.md) | Universidad (Optima, justificado, notas al pie) | [`muestra-universidad.pdf`](ejemplos/muestra-universidad.pdf) |

## Desarrollo

```bash
npm install
npm run build            # empaqueta a dist/
npm test                 # pruebas unitarias
node scripts/exportar.mjs nota.md hoja.ulss salida.pdf   # exportar desde la terminal
python3 scripts/comparar.py referencia.pdf salida.pdf    # comparar dos PDF línea a línea
```

El código está organizado por módulos en `src/`:

| Módulo | Qué hace |
|---|---|
| `ulss.js` | Parser del formato `.ulss` (variables, mixins, herencia) |
| `markdown.js` | Markdown → árbol de bloques (con líneas y sangrías) |
| `docx.js` | Emisor OOXML |
| `typst.js` | **Emisor Typst con el modelo de caja de Chromium** |
| `metricas.js` | Lectura de fuentes (nombres, métricas, avances) |
| `motor.js` | Carga del WASM, índice de tipografías, compilación en dos pasadas |
| `ensamblado.js` | Ensamblado común (página, CSS, listas, bibliografía) |
| `editor.js`, `vista.js`, `dialogos.js` | Editor de estilos y UI |

## Licencia

[MIT](LICENSE). El compilador de Typst es de
[typst/typst](https://github.com/typst/typst) (Apache-2.0), empaquetado a
WebAssembly por [typst.ts](https://github.com/Myriad-Dreamin/typst.ts)
(Apache-2.0). Véase [`THIRD-PARTY.md`](THIRD-PARTY.md).

Las hojas `.ulss` de ejemplo proceden de la galería de estilos de Ulysses y
conservan la autoría de sus creadores; se incluyen solo como muestra.
