# Guías de Ulysses Export

Todo lo que necesitas para instalarlo, prepararlo y usarlo, paso a paso.

| | Guía | Para qué |
|---|---|---|
| 1 | **[Instalar con BRAT](01-instalar-con-brat.md)** | Poner el plugin en cualquier dispositivo y mantenerlo actualizado |
| 2 | **[Añadir estilos y tipografías](02-estilos-y-tipografias.md)** | De dónde sacarlos, dónde ponerlos y cómo llegan al móvil |
| 3 | **[Crear estilos](03-crear-estilos.md)** | El editor con previsualización y la sintaxis `.ulss` completa |
| 4 | **[Usarlo en el escritorio](04-uso-escritorio.md)** | Windows, macOS y Linux: exportar, ajustes, qué entiende de tus notas |
| 5 | **[Usarlo en iPhone y iPad](05-uso-ios.md)** | iOS de principio a fin, con las trampas de la sincronización |
| 6 | **[Usarlo en Android](06-uso-android.md)** | Android de principio a fin |

## Por dónde empezar

**Si es tu primera vez:** guía 1 → guía 2 → guía 4 (o 5/6 si vas a móvil).

**Si ya lo tienes funcionando en el ordenador y quieres el móvil:**
guía 5 (iPhone/iPad) o guía 6 (Android). Presta atención al aviso sobre
Obsidian Sync: los estilos y las tipografías no se sincronizan de fábrica,
y el ajuste hay que activarlo **en cada dispositivo**.

**Si quieres tocar el diseño:** guía 3.

## Documentación técnica

Para quien quiera saber cómo está hecho por dentro:

- **[Paridad con Chromium](../paridad-chromium.md)** — el modelo de
  composición que reproduce el emisor (unidades de 1/64 px, redondeo de
  líneas base, justificado, fragmentación de página).
- **[Batería de equivalencia](../bateria.md)** — las 136 comparaciones
  (8 documentos × 17 estilos) entre el renderizador anterior y el actual,
  con sus resultados y los límites conocidos.
- **[Guía del móvil](../movil.md)** — resumen técnico de cómo funciona en
  iOS y Android.
