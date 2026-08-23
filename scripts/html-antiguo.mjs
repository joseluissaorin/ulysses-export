// Genera el HTML del renderizador ANTIGUO del plugin (construirHtml) para
// una nota y una hoja: es exactamente lo que imprimía Chromium.
// Uso: node scripts/html-antiguo.mjs nota.md hoja.ulss salida.html
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const MARKDOWN = require('../src/markdown.js');
const ULSS = require('../src/ulss.js');
const E = require('../src/ensamblado.js');

const [, , md, ulss, salida] = process.argv;
const documento = MARKDOWN.analizar(readFileSync(md, 'utf8'));
const hoja = ULSS.cargar(readFileSync(ulss, 'utf8'));
const opciones = {
  titulo: 'prueba',
  tamanoPagina: 'a4',
  modoLineas: 'auto',
  sangriaVersoEm: 2,
  anchoTabuladorEm: 0,
  recursos: () => null,
  recursoUrl: (r) => r,
};
writeFileSync(salida, E.construirHtml(documento, hoja, opciones));
console.log('ok', salida);
