# 5. Usarlo en iPhone y iPad

El plugin compone el PDF dentro de la propia aplicación, así que en iOS
funciona **igual que en el ordenador**, sin conexión y sin que ningún
texto salga de tu dispositivo.

---

## Puesta a punto (una sola vez)

### 1. Instalar el plugin

Sigue la guía **[1. Instalar con BRAT](01-instalar-con-brat.md)**. En
resumen: *Ajustes → Plugins de la comunidad → Examinar → BRAT →
Instalar → Activar*; después *Ajustes → BRAT → Add Beta plugin* y pegar
`https://github.com/joseluissaorin/ulysses-export`.

### 2. Descargar el motor, con wifi

Paleta de comandos (desliza hacia abajo desde el centro de la pantalla) →
**«Preparar para usar sin conexión (motor y tipografías)»**.

Baja 21 MB del motor y 4 MB de tipografías de reserva. Espera al aviso de
«Listo». **Deja Obsidian en primer plano** mientras tanto: si sales de la
app, iOS puede pausar la descarga.

### 3. Llevar tus estilos (y tipografías) al iPhone

El plugin busca los `.ulss` por todo el vault, así que basta con que
lleguen a cualquier carpeta de tu bóveda. Dos caminos:

**a) Con sincronización.** Si el vault está sincronizado, ponlos desde el
ordenador en una carpeta normal (por ejemplo `Estilos Ulysses/` y
`Tipografías/`) y espera a que bajen.

> ⚠️ **Con Obsidian Sync, el paso que todo el mundo se salta.** Los
> `.ulss` y las tipografías no son notas, ni imágenes, ni PDF: entran en
> **«todos los otros tipos»**, una categoría **desactivada de fábrica**. Y
> ese ajuste es **de cada dispositivo**. Tienes que activarlo **en el
> iPhone también**, o dirá «sincronizado» y las carpetas te llegarán
> vacías:
>
> **Ajustes → Sync → Área de sincronización → «Sincronizar todos los
> otros tipos»**

**b) A mano, con la app Archivos.** Obsidian expone sus bóvedas en
Archivos:

1. Pasa los archivos al iPhone (AirDrop desde el Mac, iCloud Drive,
   descarga desde Drive…).
2. Abre **Archivos → En mi iPhone → Obsidian → *tu bóveda***.
3. Crea ahí una carpeta (por ejemplo `Estilos Ulysses`) y mueve dentro los
   `.ulss`. Lo mismo con las tipografías.
4. En Obsidian, paleta de comandos → **«Recargar las hojas de estilo»**.
   Debe decirte cuántas ha encontrado.

Si no llevas tus tipografías, el PDF se compone igualmente con las de
reserva (Tinos, Arimo, Cousine) y el plugin te avisa de la sustitución.

---

## Exportar, paso a paso

1. Abre la nota.
2. Toca el menú **⋮** arriba a la derecha *(o abre la paleta de comandos
   deslizando hacia abajo)*.
3. Elige **«Exportar con un estilo de Ulysses…»**.
4. En el diálogo, selecciona el **Estilo** y comprueba **Guardar en**.
5. Pulsa **PDF**.

Verás un aviso de «PDF guardado en Exportaciones/…».

> En el móvil no aparece el botón **Imprimir…**: dependía del diálogo de
> impresión del escritorio y ya no hace falta, porque el PDF que genera el
> plugin es el mismo.

## Abrir y compartir el PDF

**Desde Obsidian:** toca el archivo en el explorador de la izquierda y se
abre en el visor interno.

**Para mandarlo por WhatsApp, correo, etc.:**

1. Abre **Archivos → En mi iPhone → Obsidian → *tu bóveda* → Exportaciones**.
2. Mantén pulsado el PDF → **Compartir**.

También puedes usar *Guardar en Archivos* o **Libros** para archivarlo.

---

## Consejos propios de iOS

- **Teclado y paleta de comandos:** con teclado físico, `Cmd+P` abre la
  paleta igual que en el escritorio.
- **iPad:** todo lo anterior vale igual. En pantalla grande, el editor de
  estilos con su previsualización se usa cómodamente.
- **Batería y tiempo:** la primera exportación de cada sesión tarda unos
  segundos (arrancar el motor). Las siguientes son casi instantáneas.
- **Espacio:** el motor y las tipografías ocupan ~25 MB dentro de la
  carpeta del plugin. Solo se descargan una vez.

---

## Problemas frecuentes

**«Recargar las hojas de estilo» dice 0**
Los `.ulss` no han llegado al teléfono. Míralo en el explorador de
archivos de Obsidian: si la carpeta está vacía, es el ajuste de Sync de
más arriba (hay que activarlo **en el iPhone**). Como atajo, pásalos a
mano con la app Archivos.

**El PDF sale con una letra que no es la del estilo**
Faltan las tipografías reales en el vault; se han usado las de reserva. Es
solo cuestión de copiar los `.ttc`/`.ttf` a una carpeta de la bóveda.

**El PDF sale en blanco**
No había ninguna tipografía disponible. Ejecuta *«Preparar para usar sin
conexión»* con wifi.

**La descarga del motor se queda a medias**
Vuelve a lanzar el comando con Obsidian en primer plano y buena conexión;
retoma sin problema.

Ten en cuenta que la app Archivos de iOS **no muestra las carpetas que
empiezan por punto**, así que no puedes copiar `typst.wasm` a mano dentro
de `.obsidian/`. Si la descarga se resiste, las salidas son: hacerla desde
otra red, o —si sincronizas la bóveda desde un ordenador— activar en
Obsidian Sync la sincronización de **complementos de la comunidad**, con
lo que el plugin llegaría al iPhone con el motor ya dentro.

**Obsidian se cierra al exportar un documento muy largo**
El motor necesita memoria. En un documento de cientos de páginas con
muchas imágenes, un iPhone antiguo puede quedarse corto: exporta por
partes.

**He actualizado el plugin y sigue igual**
Cierra Obsidian del todo (deslizando la app hacia arriba) y vuelve a
abrirlo, o apaga y enciende el plugin en *Plugins de la comunidad*.

---

Anterior: **[4. Usarlo en el escritorio](04-uso-escritorio.md)** ·
Siguiente: **[6. Usarlo en Android](06-uso-android.md)**
