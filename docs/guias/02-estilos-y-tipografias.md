# 2. Añadir estilos y tipografías

Un PDF bien compuesto necesita dos cosas: la **hoja de estilo** (`.ulss`),
que dice cómo se ve todo, y las **tipografías** que esa hoja pide.

El plugin busca ambas cosas **por todo el vault**, sin que tengas que
configurar nada: cualquier `.ulss` y cualquier `.ttf`, `.otf` o `.ttc` que
haya dentro de tu bóveda se detecta solo.

---

## Estilos (`.ulss`)

### De dónde sacarlos

- **De tu Ulysses**, si lo usas en el Mac. La forma más segura de sacarlos
  es desde la propia aplicación: *Ulysses → Preferencias → Estilos*, botón
  derecho sobre un estilo → **Mostrar en el Finder** (o *Exportar*). Cada
  estilo es un paquete `.ulstyle`; dentro hay un archivo `Style.ulss`.
  El plugin también sabe leer el paquete entero: si copias la carpeta
  `.ulstyle` al vault, la reconoce y usa el nombre que trae en su
  `Info.plist`.
- **De la galería oficial**: <https://styles.ulysses.app>. Descarga un
  estilo, descomprime el `.ulstyle` (es una carpeta) y quédate con el
  `Style.ulss`, o copia la carpeta entera.
- **Creándolo tú**: ver la guía **[3. Crear estilos](03-crear-estilos.md)**.

### Dónde ponerlos

**Recomendado: una carpeta normal del vault.** Por ejemplo, crea
`Estilos Ulysses/` en la raíz de tu bóveda y copia ahí los `.ulss`.

Por qué ahí y no en la carpeta del plugin: la carpeta del plugin
(`.obsidian/plugins/ulysses-export/estilos/`) **no se sincroniza** con el
móvil ni con Obsidian Sync ni con iCloud. Una carpeta normal, sí.

```
TU_VAULT/
├── Estilos Ulysses/
│   ├── Novela.ulss
│   ├── Universidad.ulss
│   └── …
├── Tipografías/
│   ├── Baskerville.ttc
│   └── Optima.ttc
└── … tus notas …
```

No hace falta que se llamen así ni que estén en la raíz: el plugin busca
por extensión en todo el vault. Los nombres de las carpetas del ejemplo se
usan por claridad.

### Comprobar que los ve

Paleta de comandos → **«Recargar las hojas de estilo»**. Sale un aviso
como *«17 hojas de estilo encontradas»*.

Si dice **0**, ve al final de esta guía.

### Elegir cuáles se ofrecen al exportar

Si tienes muchos estilos y solo usas dos o tres, en
**Ajustes → Ulysses Export → «Estilos que se ofrecen al exportar»**
escribe sus nombres, uno por línea:

```
Universidad
Novela
```

El resto siguen instalados; para verlos todos, activa **«Mostrar todos los
estilos»** (o marca esa casilla puntualmente en el propio diálogo de
exportar).

---

## Tipografías

### Por qué importan

Los estilos de Ulysses piden tipografías de Apple: Baskerville, Optima,
Avenir Next, Hoefler Text, Helvetica Neue, Gill Sans… Si el plugin no las
encuentra, sustituye por la alternativa más parecida que tengas y **te
avisa al exportar**. El PDF sale bien compuesto, pero con otra letra.

### Escritorio

No tienes que hacer nada: el plugin usa las tipografías instaladas en tu
sistema (Windows, macOS y Linux). La primera vez construye un índice —solo
lee los nombres, es cuestión de segundos— y lo guarda en caché.

### Móvil (iPhone, iPad, Android)

Ni iOS ni Android permiten a una aplicación leer los archivos de las
tipografías del sistema. Hay dos escenarios:

**a) Sin hacer nada.** El plugin se descarga un juego de reserva —**Tinos**,
**Arimo** y **Cousine**, libres (Apache-2.0)— que son *métricamente
compatibles* con Times New Roman, Arial y Courier New. El texto se compone
con las mismas medidas, aunque el dibujo de la letra no sea el de la hoja.

**b) Con tus tipografías reales.** Copia los archivos a una carpeta del
vault (por ejemplo `Tipografías/`) y el PDF del móvil saldrá **idéntico**
al del ordenador.

Dónde encontrarlas en un Mac:

| Tipografía | Archivo | Carpeta |
|---|---|---|
| Baskerville | `Baskerville.ttc` | `/System/Library/Fonts/Supplemental/` |
| Optima | `Optima.ttc` | `/System/Library/Fonts/Supplemental/` |
| Avenir Next | `Avenir Next.ttc` | `/System/Library/Fonts/` |
| Hoefler Text | `Hoefler Text.ttc` | `/System/Library/Fonts/Supplemental/` |
| Gill Sans | `GillSans.ttc` | `/System/Library/Fonts/Supplemental/` |
| Helvetica Neue | `HelveticaNeue.ttc` | `/System/Library/Fonts/` |

En Windows están en `C:\Windows\Fonts` (Times New Roman, Courier New,
Georgia, Palatino Linotype…).

> **Sobre licencias:** las tipografías del sistema son de sus fabricantes.
> Copiarlas a tu propio vault para uso personal es una cosa; publicarlas o
> compartirlas es otra. El plugin nunca sube ninguna a ningún sitio.

### Comprobar qué tipografía se ha usado

Exporta y mira el aviso: si aparece *«"Optima" no está instalada: se usa
"Tinos"»*, es que no la encontró. Si no dice nada, usó la que pedía la
hoja.

---

## Si trabajas en varios dispositivos

Con **Obsidian Sync** hay un detalle que despista mucho: los `.ulss` y los
archivos de tipografías no son notas ni imágenes ni PDF, así que entran en
la categoría **«todos los otros tipos»**, que viene **desactivada de
fábrica**. Y —esto es lo importante— **ese ajuste es de cada dispositivo**:

- Activarlo en el **ordenador** hace que los archivos **suban**.
- Activarlo en el **móvil** hace que el móvil **se los baje**.

Hay que activarlo **en los dos**:

> **Ajustes → Sync → Área de sincronización → «Sincronizar todos los otros
> tipos»**

Con iCloud, Dropbox o Google Drive no hay filtros por tipo: se sincroniza
todo tal cual.

---

## Problemas frecuentes

**«Recargar las hojas de estilo» dice 0**

1. ¿Los archivos acaban en `.ulss`? (Ojo con `.ulss.txt` al descargarlos.)
2. ¿Están **dentro** de la carpeta del vault?
3. En el móvil: ¿han llegado de verdad? Míralo en el explorador de
   archivos de Obsidian. Si la carpeta está vacía, es el ajuste de Sync
   del apartado anterior.
4. ¿Tienes la versión 2.0.2 o superior? Las anteriores solo miraban las
   carpetas configuradas. Compruébalo en *Ajustes → Plugins de la
   comunidad*.

**El PDF sale en blanco**
Sin ninguna tipografía disponible no hay nada que dibujar. Ejecuta
*«Preparar para usar sin conexión»* para traerte las de reserva.

**Sale con otra letra distinta a la del ordenador**
Las tipografías reales no están en el vault (o no han llegado al móvil).
Ver arriba.

---

Anterior: **[1. Instalar con BRAT](01-instalar-con-brat.md)** ·
Siguiente: **[3. Crear estilos](03-crear-estilos.md)**
