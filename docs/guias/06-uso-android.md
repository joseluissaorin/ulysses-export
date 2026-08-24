# 6. Usarlo en Android

Igual que en iOS, el PDF se compone dentro de la aplicación: mismo motor,
mismas hojas de estilo, mismo resultado, sin conexión.

> **Nota honesta:** el plugin está probado a fondo en escritorio y en
> iPhone. En Android no hay dependencias distintas —es el mismo código y
> el mismo motor WebAssembly, y Obsidian ofrece las mismas API—, pero
> **no lo he podido verificar en un dispositivo real**. Si encuentras algo
> raro, [abre una incidencia](https://github.com/joseluissaorin/ulysses-export/issues)
> y se corrige.

---

## Puesta a punto (una sola vez)

### 1. Instalar el plugin

Sigue la guía **[1. Instalar con BRAT](01-instalar-con-brat.md)**:
*Ajustes → Plugins de la comunidad → Examinar → BRAT → Instalar →
Activar*; luego *Ajustes → BRAT → Add Beta plugin* y pegar
`https://github.com/joseluissaorin/ulysses-export`.

### 2. Descargar el motor, con wifi

Paleta de comandos (desliza hacia abajo desde el centro de la pantalla) →
**«Preparar para usar sin conexión (motor y tipografías)»**. Son 21 MB del
motor más 4 MB de tipografías de reserva. Mantén Obsidian en primer plano.

### 3. Llevar tus estilos y tipografías

En Android tienes una ventaja: **el vault es una carpeta normal del
almacenamiento**, accesible con cualquier gestor de archivos (Files de
Google, Solid Explorer, Total Commander…) y por cable USB desde el
ordenador.

**a) Copiándolos directamente** *(lo más rápido)*

1. Conecta el teléfono al ordenador por USB y elige **Transferencia de
   archivos**, o usa un gestor de archivos en el propio teléfono.
2. Ve a la carpeta de tu bóveda. Suele estar en
   `Almacenamiento interno/Documents/TuBóveda/` o
   `Almacenamiento interno/Obsidian/TuBóveda/` (la ruta exacta la elegiste
   al crear la bóveda).
3. Crea dentro una carpeta, por ejemplo `Estilos Ulysses`, y copia ahí los
   `.ulss`. Haz lo mismo con las tipografías en `Tipografías`.
4. En Obsidian, paleta de comandos → **«Recargar las hojas de estilo»**.

**b) Con sincronización**

Si sincronizas la bóveda (Obsidian Sync, Syncthing, Dropbox…), pon los
archivos desde el ordenador y espera.

> ⚠️ **Con Obsidian Sync**, los `.ulss` y las tipografías cuentan como
> **«todos los otros tipos»**, categoría **desactivada de fábrica**, y ese
> ajuste es **de cada dispositivo**. Actívalo también en el teléfono:
> **Ajustes → Sync → Área de sincronización → «Sincronizar todos los
> otros tipos»**. Si no, el Sync dirá «completo» y las carpetas llegarán
> vacías.

Sin tus tipografías, el PDF se compone con las de reserva (Tinos, Arimo,
Cousine) y el plugin avisa de la sustitución.

---

## Exportar, paso a paso

1. Abre la nota.
2. Toca el menú **⋮** arriba a la derecha *(o abre la paleta de comandos)*.
3. **«Exportar con un estilo de Ulysses…»**.
4. Elige **Estilo** y comprueba **Guardar en**.
5. Pulsa **PDF**.

El archivo queda en la carpeta de salida del vault (por defecto
`Exportaciones`).

## Abrir y compartir el PDF

- **Desde Obsidian:** toca el archivo en el explorador y se abre en el
  visor interno.
- **Desde fuera:** abre tu gestor de archivos, ve a la carpeta de la
  bóveda → `Exportaciones`, mantén pulsado el PDF y usa **Compartir**.
  Cualquier lector de PDF (Drive, Adobe, el visor del sistema) lo abre.

---

## Consejos propios de Android

- **Copias de seguridad automáticas:** si tienes activada la subida
  automática de la carpeta de la bóveda a Google Fotos o Drive, ten en
  cuenta que los PDF exportados también se subirán.
- **Ahorro de batería:** si Android tiene el ahorro de energía agresivo,
  puede pausar la descarga del motor al salir de la app. Hazla con la
  pantalla encendida.
- **Almacenamiento:** motor y tipografías ocupan unos 25 MB dentro de
  `.obsidian/plugins/ulysses-export/`. Se descargan una sola vez.
- **Tipografías del sistema:** aunque Android guarda las suyas en
  `/system/fonts`, las aplicaciones no pueden leerlas libremente; por eso
  el plugin usa las del vault o las de reserva, como en iOS.

---

## Problemas frecuentes

**«Recargar las hojas de estilo» dice 0**
Los `.ulss` no están dentro de la carpeta de la bóveda, o no han llegado.
Compruébalo con un gestor de archivos. Ojo también con que el archivo no
se haya guardado como `Novela.ulss.txt`.

**El PDF sale con otra letra**
Faltan tus tipografías en el vault; se usaron las de reserva.

**El PDF sale en blanco**
No había ninguna tipografía. Ejecuta *«Preparar para usar sin conexión»*.

**La descarga del motor falla**
Repítela con wifi y la app en primer plano. Alternativa: descarga
`typst.wasm` de la
[release](https://github.com/joseluissaorin/ulysses-export/releases/latest)
en el ordenador y cópialo por USB a
`TuBóveda/.obsidian/plugins/ulysses-export/typst.wasm`. Recuerda activar
«mostrar archivos ocultos» en el gestor para ver `.obsidian`.

**Obsidian se cierra con documentos muy largos**
Falta de memoria: exporta por partes.

**He actualizado y sigue igual**
Cierra Obsidian por completo (desde las apps recientes) y vuelve a
abrirlo, o apaga y enciende el plugin.

---

Anterior: **[5. Usarlo en iPhone y iPad](05-uso-ios.md)** ·
Volver al **[índice de guías](README.md)**
