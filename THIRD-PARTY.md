# Software de terceros

| Componente | Licencia | Uso |
|---|---|---|
| [Typst](https://github.com/typst/typst) | Apache-2.0 | Compilador que compone el PDF |
| [typst.ts](https://github.com/Myriad-Dreamin/typst.ts) (`@myriaddreamin/typst-ts-web-compiler`) | Apache-2.0 | Compilación de Typst a WebAssembly y pegamento JS (empaquetado dentro de `main.js`; el binario `typst.wasm` se distribuye/descarga tal cual) |
| [esbuild](https://esbuild.github.io) | MIT | Solo en desarrollo (empaquetado) |

El fichero `typst.wasm` que descarga o distribuye este plugin es el
artefacto `typst_ts_web_compiler_bg.wasm` publicado en npm por typst.ts,
sin modificar.

Las hojas `.ulss` de ejemplo proceden de la galería de estilos de Ulysses
(https://styles.ulysses.app) y conservan la autoría indicada en sus
cabeceras. El formato `.ulss` es de Ulysses GmbH & Co. KG; este proyecto
no está afiliado a Ulysses.
