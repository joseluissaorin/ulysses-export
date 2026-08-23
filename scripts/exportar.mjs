// Exporta un .md con una hoja .ulss a PDF usando el MISMO código del plugin
// (parser, hoja, emisor Typst y compilador WASM), fuera de Obsidian.
//
// Uso: node scripts/exportar.mjs nota.md hoja.ulss salida.pdf [--typ salida.typ] [--una-pasada] [--fuentes DIR]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { crearCompilador, compilar } from './typst-wasm.mjs';

const require = createRequire(import.meta.url);
const MARKDOWN = require('../src/markdown.js');
const ULSS = require('../src/ulss.js');
const TYPST = require('../src/typst.js');
const { CatalogoFuentes } = require('../src/metricas.js');
const MOTOR = require('../src/motor.js');

const args = process.argv.slice(2);
const opc = { typ: null, unaPasada: false, fuentes: [process.env.HOME + '/.local/share/fonts/ulysses'] };
const libres = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--typ') opc.typ = args[++i];
  else if (args[i] === '--una-pasada') opc.unaPasada = true;
  else if (args[i] === '--fuentes') opc.fuentes = [args[++i]];
  else libres.push(args[i]);
}
const [md, ulss, salida] = libres;

const texto = readFileSync(md, 'utf8');
const documento = MARKDOWN.analizar(texto);
const hoja = ULSS.cargar(readFileSync(ulss, 'utf8'));

const catalogo = new CatalogoFuentes();
for (const dir of opc.fuentes) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (/\.(ttf|otf|ttc)$/i.test(f) && statSync(p).isFile()) catalogo.anadir(readFileSync(p), p);
  }
}

const opciones = {
  titulo: md.replace(/.*\//, '').replace(/\.md$/, ''),
  tamanoPagina: 'a4',
  incluirComentarios: false,
  modoLineas: 'auto',
  anchoTabuladorEm: 0,
  sangriaVersoEm: 2,
  catalogo,
  recursos: () => null,
};

const compilador = await crearCompilador(opc.fuentes);
let pdf;
let avisos = [];
if (opc.unaPasada) {
  const r = TYPST.construirTypst(documento, hoja, opciones);
  if (opc.typ) writeFileSync(opc.typ, r.fuente);
  pdf = compilar(compilador, r.fuente, r.recursos);
  avisos = r.avisos;
} else {
  if (opc.typ) {
    const r1 = TYPST.construirTypst(documento, hoja, opciones);
    writeFileSync(opc.typ.replace(/\.typ$/, '.1.typ'), r1.fuente);
  }
  const r = MOTOR.compilarPdf(compilador, documento, hoja, opciones);
  pdf = r.pdf;
  avisos = r.avisos;
}
writeFileSync(salida, pdf);
for (const a of avisos) console.warn('aviso:', a);
console.log('ok', salida);
