# 1. Instalar el plugin con BRAT

BRAT (*Beta Reviewers Auto-update Tool*) es un plugin de Obsidian que
instala y mantiene actualizados otros plugins directamente desde GitHub,
sin esperar a que estén en el catálogo oficial. Funciona igual en
escritorio, iPhone/iPad y Android.

> **La dirección que vas a necesitar:**
> `https://github.com/joseluissaorin/ulysses-export`

---

## Paso 1: instalar BRAT

1. Abre Obsidian.
2. Ve a **Ajustes** (la rueda dentada; en el móvil, el icono de la
   izquierda arriba y después la rueda).
3. En la columna izquierda, entra en **Plugins de la comunidad**
   (*Community plugins*).
4. Si es la primera vez, verás un aviso de que están desactivados: pulsa
   **Activar plugins de la comunidad**.
5. Pulsa **Examinar** (*Browse*).
6. Escribe **BRAT** en el buscador. El plugin se llama
   **Obsidian42 - BRAT**, de *TfTHacker*.
7. Pulsa **Instalar** y, cuando termine, **Activar**.

## Paso 2: añadir Ulysses Export

1. Sigue en **Ajustes**. En la columna izquierda, baja hasta la sección
   **Plugins de la comunidad** y toca **BRAT**.
2. Pulsa el botón **Add Beta plugin**.
3. En el cuadro que aparece, pega:

   ```
   https://github.com/joseluissaorin/ulysses-export
   ```

4. Deja marcada la opción de usar la **última versión** (*latest version*).
5. Pulsa **Add plugin**.

BRAT descargará el plugin y lo activará. Verás un aviso de confirmación.

## Paso 3: comprobar que está activo

1. **Ajustes → Plugins de la comunidad**.
2. En la lista de plugins instalados debe aparecer **Ulysses Export** con
   el interruptor **encendido**. Si estuviera apagado, enciéndelo.
3. Junto al nombre verás el número de versión (por ejemplo, `2.0.2`).

## Paso 4 (solo la primera vez): descargar el motor de PDF

El plugin compone los PDF con Typst, un motor que pesa unos 21 MB y no
viaja dentro del plugin. Además usa unas tipografías de reserva (4 MB).
Con **wifi**:

1. Abre la **paleta de comandos**:
   - Escritorio: `Ctrl+P` (Windows/Linux) o `Cmd+P` (Mac).
   - Móvil: desliza hacia abajo desde el centro de la pantalla, o toca el
     icono de comandos del teclado.
2. Escribe **Preparar** y elige:
   **«Preparar para usar sin conexión (motor y tipografías)»**
3. Espera. Al terminar aparece un aviso tipo *«Listo: motor de PDF
   descargado; 12 tipografías de reserva descargadas»*.

A partir de ahí el plugin **no necesita conexión nunca más**: todo se
compone en tu dispositivo.

> Si te saltas este paso no pasa nada: la primera vez que exportes un PDF
> se descargará solo. Pero es mejor hacerlo con wifi y con calma.

---

## Actualizar el plugin

Cuando haya una versión nueva:

1. Paleta de comandos → **«BRAT: Check for updates to all beta plugins»**.
   (También está el botón *Check for updates* dentro de los ajustes de BRAT.)
2. Cuando avise de que ha actualizado, **recarga el plugin**: ve a
   *Ajustes → Plugins de la comunidad*, apaga y vuelve a encender
   **Ulysses Export**. Si no lo haces, Obsidian sigue ejecutando en
   memoria la versión anterior.

En el móvil, cerrar Obsidian del todo y volver a abrirlo hace lo mismo.

---

## Instalación manual (sin BRAT)

Si prefieres no usar BRAT:

1. Ve a la [última *release*](https://github.com/joseluissaorin/ulysses-export/releases/latest).
2. Descarga `main.js`, `manifest.json` y `styles.css`.
   (Opcionalmente también `typst.wasm`, 21 MB, para ahorrarte la descarga
   del paso 4.)
3. Crea la carpeta `TU_VAULT/.obsidian/plugins/ulysses-export/` y copia
   ahí los archivos.
4. Reinicia Obsidian y activa el plugin en *Ajustes → Plugins de la
   comunidad*.

La pega: tendrás que repetirlo a mano en cada actualización, y en el móvil
llegar a la carpeta `.obsidian` es incómodo. Por eso se recomienda BRAT.

---

## Problemas frecuentes

**«No encuentro BRAT en Examinar»**
Asegúrate de haber activado los plugins de la comunidad y de tener
conexión. El nombre exacto es *Obsidian42 - BRAT*.

**«BRAT dice que no encuentra el repositorio»**
Revisa que has pegado la dirección completa, sin espacios ni barra final:
`https://github.com/joseluissaorin/ulysses-export`

**«He actualizado pero sigue comportándose igual»**
No has recargado el plugin. Apágalo y enciéndelo en *Plugins de la
comunidad* (o cierra y abre Obsidian).

**«La descarga del motor falla»**
Necesita conexión la primera vez. Si estás detrás de un cortafuegos que
bloquea `cdn.jsdelivr.net`, descarga `typst.wasm` de la *release* desde un
ordenador y cópialo a
`TU_VAULT/.obsidian/plugins/ulysses-export/typst.wasm`.

---

Siguiente: **[2. Añadir estilos y tipografías](02-estilos-y-tipografias.md)**
