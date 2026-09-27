// Exporta un .md con una hoja .ulss usando el MISMO código del plugin
// (parser, hoja, emisores y compilador WASM), fuera de Obsidian.
//
// Uso: node scripts/exportar.mjs nota.md hoja.ulss salida.(pdf|docx|html) [opciones]
//
//   --fuentes DIR          carpeta de tipografías (por defecto ~/.local/share/fonts/ulysses)
//   --vault DIR            raíz del vault, para encontrar imágenes por su nombre
//   --tamano a4|letter|legal
//   --laminas girada|apaisada|no
//   --doble-cara si|no|estilo
//   --epigrafes si|no      --conversaciones si|no      --raya si|no
//   --typ salida.typ       guarda la fuente Typst (solo PDF)
//   --una-pasada           sin la segunda pasada de ajuste fino (solo PDF)
//
// Las propiedades «ulysses-…» de la nota (ulysses-laminas, ulysses-epigrafes…)
// se aplican igual que en el plugin; las opciones de la línea de órdenes mandan.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createRequire } from 'node:module';
import { crearCompilador, compilar } from './typst-wasm.mjs';

const require = createRequire(import.meta.url);
const MARKDOWN = require('../src/markdown.js');
const ULSS = require('../src/ulss.js');
const TYPST = require('../src/typst.js');
const ENSAMBLADO = require('../src/ensamblado.js');
const LIBRO = require('../src/libro.js');
const IMAGENES = require('../src/imagenes.js');
const { CatalogoFuentes } = require('../src/metricas.js');
const MOTOR = require('../src/motor.js');

const args = process.argv.slice(2);
const opc = {
  typ: null,
  unaPasada: false,
  fuentes: [process.env.HOME + '/.local/share/fonts/ulysses'],
  vault: null,
  cambios: {},
};
/** Un valor de una lista cerrada; si no lo es, se para con un mensaje claro. */
function elegir(opcion, valor, validos) {
  const v = String(valor || '').toLowerCase();
  if (v in validos) return validos[v];
  console.error(`${opcion}: «${valor}» no vale; usa ${Object.keys(validos).join(', ')}.`);
  process.exit(2);
}
const SI_NO = { si: true, 'sí': true, yes: true, true: true, 1: true, no: false, false: false, 0: false };
const libres = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--typ') opc.typ = args[++i];
  else if (a === '--una-pasada') opc.unaPasada = true;
  else if (a === '--fuentes') opc.fuentes = [args[++i]];
  else if (a === '--vault') opc.vault = args[++i];
  else if (a === '--tamano') opc.cambios.tamanoPagina = elegir(a, args[++i], { a4: 'a4', letter: 'letter', carta: 'letter', legal: 'legal', oficio: 'legal' });
  else if (a === '--laminas') opc.cambios.laminas = elegir(a, args[++i], { girada: 'girada', imprenta: 'girada', apaisada: 'apaisada', pantalla: 'apaisada', no: 'no' });
  else if (a === '--doble-cara') opc.cambios.dobleCara = elegir(a, args[++i], { si: 'si', 'sí': 'si', no: 'no', estilo: 'estilo' });
  else if (a === '--epigrafes') opc.cambios.epigrafes = elegir(a, args[++i], SI_NO);
  else if (a === '--conversaciones') opc.cambios.conversaciones = elegir(a, args[++i], SI_NO);
  else if (a === '--raya') opc.cambios.rayaPegada = elegir(a, args[++i], SI_NO);
  else if (a.startsWith('--')) {
    console.error(`Opción desconocida: ${a}`);
    process.exit(2);
  } else libres.push(a);
}
const [md, ulss, salida] = libres;
if (!md || !ulss || !salida) {
  console.error('Uso: node scripts/exportar.mjs nota.md hoja.ulss salida.(pdf|docx|html) [opciones]');
  process.exit(2);
}

const texto = readFileSync(md, 'utf8');
const documento = MARKDOWN.analizar(texto);
const hoja = ULSS.cargar(readFileSync(ulss, 'utf8'));

/* --- imágenes: junto a la nota, en el vault o por su nombre --- */
const MIMES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
let indiceVault = null;
function buscarEnVault(nombre) {
  if (!opc.vault) return null;
  if (!indiceVault) {
    indiceVault = new Map();
    const pila = [opc.vault];
    while (pila.length) {
      const dir = pila.pop();
      let entradas = [];
      try { entradas = readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const e of entradas) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) pila.push(p);
        else if (!indiceVault.has(e.name)) indiceVault.set(e.name, p);
      }
    }
  }
  return indiceVault.get(nombre) || null;
}
const cacheRecursos = new Map();
function recurso(ruta) {
  if (cacheRecursos.has(ruta)) return cacheRecursos.get(ruta);
  let limpia = ruta;
  try { limpia = decodeURIComponent(ruta); } catch (e) { /* tal cual */ }
  const candidatos = [join(dirname(md), limpia)];
  if (opc.vault) candidatos.push(join(opc.vault, limpia));
  let p = candidatos.find((c) => existsSync(c) && statSync(c).isFile()) || buscarEnVault(basename(limpia));
  let r = null;
  if (p) {
    const datos = new Uint8Array(readFileSync(p));
    const extension = IMAGENES.extension(p) || 'png';
    const dim = IMAGENES.dimensiones(datos, extension);
    r = {
      datos,
      extension,
      mime: MIMES[extension] || 'image/png',
      ancho: dim ? dim.ancho * 0.75 : null,
      alto: dim ? dim.alto * 0.75 : null,
      anchoPx: dim ? dim.ancho : null,
      altoPx: dim ? dim.alto : null,
    };
  }
  cacheRecursos.set(ruta, r);
  return r;
}

/* --- ajustes: los de la nota, pisados por la línea de órdenes --- */
const deNota = LIBRO.ajustesDeNota(documento.propiedades);
const ajustes = Object.assign(
  { tamanoPagina: 'a4', modoLineas: 'auto', sangriaVersoEm: 2, incluirComentarios: false },
  deNota,
  Object.fromEntries(Object.entries(opc.cambios).filter(([, v]) => v !== undefined))
);

const opciones = {
  titulo: basename(md).replace(/\.md$/, ''),
  tamanoPagina: ajustes.tamanoPagina,
  incluirComentarios: ajustes.incluirComentarios,
  modoLineas: ajustes.modoLineas,
  anchoTabuladorEm: 0,
  sangriaVersoEm: ajustes.sangriaVersoEm,
  numeroInicial: ajustes.numeroInicial,
  desdePagina: ajustes.desdePagina,
  laminas: ajustes.laminas,
  dobleCara: ajustes.dobleCara,
  epigrafes: ajustes.epigrafes,
  conversaciones: ajustes.conversaciones,
  rayaPegada: ajustes.rayaPegada,
  recursos: recurso,
  recursoUrl: (ruta) => {
    const r = recurso(ruta);
    return r ? `data:${r.mime};base64,${Buffer.from(r.datos).toString('base64')}` : ruta;
  },
};

const formato = (/\.(pdf|docx|html)$/i.exec(salida) || [, 'pdf'])[1].toLowerCase();
let avisos = [];

if (formato === 'docx') {
  writeFileSync(salida, ENSAMBLADO.construirDocx(documento, hoja, opciones));
} else if (formato === 'html') {
  writeFileSync(salida, ENSAMBLADO.construirHtml(documento, hoja, opciones));
} else {
  const catalogo = new CatalogoFuentes();
  for (const dir of opc.fuentes) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (/\.(ttf|otf|ttc)$/i.test(f) && statSync(p).isFile()) catalogo.anadir(readFileSync(p), p);
    }
  }
  opciones.catalogo = catalogo;
  const compilador = await crearCompilador(opc.fuentes);
  let pdf;
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
    if (opc.typ && r.fuente) writeFileSync(opc.typ, r.fuente);
  }
  writeFileSync(salida, pdf);
}
for (const a of avisos) console.warn('aviso:', a);
console.log('ok', salida);
