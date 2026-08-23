'use strict';

/*
 * Motor Typst: carga del compilador WASM y de las tipografías
 * ==========================================================
 *
 * El PDF se compone con el compilador de Typst en WebAssembly, así que
 * funciona igual en escritorio y en el móvil: no hay Electron, ni
 * diálogo de impresión, ni nada nativo. Este módulo no depende de
 * Obsidian: recibe funciones para leer y escribir ficheros y para
 * descargar, y cada entorno (plugin o scripts) pone las suyas.
 *
 * El .wasm pesa ~21 MB y no viaja dentro de main.js: se busca en la
 * carpeta del plugin y, si no está, se descarga una vez desde el CDN de
 * npm y se guarda para siempre.
 *
 * Las tipografías se cargan con cabeza: se indexan las disponibles (las
 * del sistema en escritorio, más las carpetas del vault) leyendo solo
 * sus tablas de nombres, y al compilador se le entregan únicamente las
 * familias que el documento necesita.
 */

const { CatalogoFuentes, leerFuente, normalizar } = require('./metricas.js');
const TYPST = require('./typst.js');

/** De dónde se baja el compilador si no está en la carpeta del plugin. */
const VERSION_COMPILADOR = '0.6.0';
const URL_COMPILADOR =
  `https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@${VERSION_COMPILADOR}/pkg/typst_ts_web_compiler_bg.wasm`;
const FICHERO_COMPILADOR = 'typst.wasm';

/** Carpetas de fuentes del sistema en cada plataforma (solo escritorio). */
function carpetasDelSistema(plataforma, home) {
  switch (plataforma) {
    case 'darwin':
      return ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', `${home}/Library/Fonts`];
    case 'win32':
      return ['C:\\Windows\\Fonts', `${process.env.LOCALAPPDATA || ''}\\Microsoft\\Windows\\Fonts`];
    default:
      // Dentro de un sandbox de Flatpak (p. ej. Obsidian de Flathub) las
      // fuentes del anfitrión aparecen montadas bajo /run/host.
      return [
        '/usr/share/fonts', '/usr/local/share/fonts', `${home}/.local/share/fonts`, `${home}/.fonts`,
        '/run/host/fonts', '/run/host/local-fonts', '/run/host/user-fonts',
      ];
  }
}

/**
 * Índice de tipografías: para cada fichero, sus familias. Solo se leen
 * las tablas de nombres, no los contornos, así que indexar cientos de
 * ficheros es cuestión de segundos y además se cachea.
 */
class IndiceFuentes {
  constructor() {
    this.entradas = []; // { ruta, familias: [..], mtime }
  }

  static desdeCache(json) {
    const i = new IndiceFuentes();
    try {
      const datos = JSON.parse(json);
      if (Array.isArray(datos)) i.entradas = datos;
    } catch (e) {
      /* caché rota: se reconstruye */
    }
    return i;
  }

  aCache() {
    return JSON.stringify(this.entradas);
  }

  tiene(ruta, mtime) {
    return this.entradas.some((e) => e.ruta === ruta && e.mtime === mtime);
  }

  anadir(ruta, mtime, datos) {
    try {
      const caras = leerFuente(datos);
      this.entradas.push({ ruta, mtime, familias: Array.from(new Set(caras.flatMap((c) => [c.familia, c.familiaBasica]))) });
    } catch (e) {
      this.entradas.push({ ruta, mtime, familias: [] });
    }
  }

  olvidar(ruta) {
    this.entradas = this.entradas.filter((e) => e.ruta !== ruta);
  }

  /** Rutas de los ficheros que contienen alguna de estas familias. */
  rutasPara(familias) {
    const buscadas = new Set(familias.map(normalizar));
    return this.entradas
      .filter((e) => e.familias.some((f) => buscadas.has(normalizar(f))))
      .map((e) => e.ruta);
  }
}

/**
 * Familias que puede llegar a pedir un documento con una hoja dada:
 * todas las pilas que emite el emisor, desplegadas en alternativas.
 */
function familiasQuePideLaHoja(hoja, D, E) {
  const base = D.atributosBase(hoja);
  const pilas = new Set();
  const anota = (familia) => {
    if (familia) pilas.add(E.pilaTipografica(familia) || familia);
  };
  anota(base.familia || 'Times New Roman');
  for (const sel of hoja.selectores()) anota(hoja.familia(sel, null));
  const familias = [];
  for (const pila of pilas) familias.push(...TYPST.familiasDePila(pila));
  // Genéricas de reserva por si alguna pila cae hasta el final
  familias.push('Times New Roman', 'Liberation Serif', 'DejaVu Serif', 'Liberation Sans', 'DejaVu Sans', 'Liberation Mono', 'DejaVu Sans Mono', 'Arial', 'Helvetica', 'Courier New', 'Georgia', 'Noto Serif', 'Noto Sans');
  return familias;
}

/**
 * Prepara un compilador con las fuentes justas para un documento.
 *
 * @param entorno {
 *   leerWasm():   Promise<Uint8Array|null>  el wasm cacheado, si existe
 *   guardarWasm(bytes): Promise<void>
 *   descargar(url): Promise<Uint8Array>
 *   listarFuentes(): Promise<[{ruta, mtime}]>   candidatos a fuente
 *   leerFuente(ruta): Promise<Uint8Array>
 *   leerCacheIndice(): Promise<string|null>
 *   guardarCacheIndice(texto): Promise<void>
 *   crearCompilador(wasmBytes, fuentes: Uint8Array[]): Promise<compilador>
 * }
 * @param hoja  hoja .ulss (para saber qué familias hacen falta)
 */
async function prepararMotor(entorno, hoja, D, E, avisar) {
  // 1. El compilador
  let wasm = await entorno.leerWasm();
  if (!wasm) {
    if (avisar) avisar('Descargando el motor de PDF (una sola vez, ~21 MB)…');
    wasm = await entorno.descargar(URL_COMPILADOR);
    await entorno.guardarWasm(wasm);
  }

  // 2. El índice de tipografías
  const indice = IndiceFuentes.desdeCache((await entorno.leerCacheIndice()) || '');
  const vivos = new Set();
  let cambiado = false;
  const candidatos = await entorno.listarFuentes();
  for (const c of candidatos) {
    vivos.add(c.ruta);
    if (indice.tiene(c.ruta, c.mtime)) continue;
    indice.olvidar(c.ruta);
    try {
      indice.anadir(c.ruta, c.mtime, await entorno.leerFuente(c.ruta));
      cambiado = true;
    } catch (e) {
      /* ilegible: fuera */
    }
  }
  const antes = indice.entradas.length;
  indice.entradas = indice.entradas.filter((e) => vivos.has(e.ruta));
  if (cambiado || indice.entradas.length !== antes) await entorno.guardarCacheIndice(indice.aCache());

  // 3. Las fuentes que puede pedir este documento
  const familias = familiasQuePideLaHoja(hoja, D, E);
  const rutas = indice.rutasPara(familias);
  const catalogo = new CatalogoFuentes();
  const fuentes = [];
  for (const ruta of rutas) {
    try {
      const datos = await entorno.leerFuente(ruta);
      catalogo.anadir(datos, ruta);
      fuentes.push(datos);
    } catch (e) {
      /* si una no se puede leer, se sigue con las demás */
    }
  }

  const compilador = await entorno.crearCompilador(wasm, fuentes);
  return { compilador, catalogo };
}

/**
 * Compila un documento a PDF en dos pasadas: la primera mide, la
 * segunda clava las líneas base en el píxel que usaría Chromium.
 */
function compilarPdf(compilador, documento, hoja, opciones) {
  const compilar = (fuente, recursos) => {
    compilador.reset();
    compilador.add_source('/main.typ', fuente);
    for (const [ruta, datos] of Object.entries(recursos || {})) compilador.map_shadow(ruta, datos);
    const r = compilador.compile('/main.typ', null, 'pdf', 0);
    if (!(r instanceof Uint8Array)) {
      const detalle = Array.isArray(r) && r.length ? JSON.stringify(r[0]) : String(r);
      throw new Error('Typst no pudo compilar: ' + detalle);
    }
    return r;
  };

  let primera = TYPST.construirTypst(documento, hoja, opciones);
  if (primera.geo.columnas > 1) {
    // Multicolumna: Chromium EQUILIBRA las columnas (column-fill: balance).
    // Se mide el contenido en una galería a ancho de columna y se busca la
    // altura mínima que reparte el contenido en las columnas disponibles;
    // esa altura se impone como área de la página. El ajuste fino a píxel
    // se omite (queda a menos de medio píxel).
    const galeria = TYPST.construirTypst(documento, hoja, Object.assign({ galeria: true }, opciones));
    compilar(galeria.fuente, galeria.recursos);
    const posiciones = posicionesDeBloques(compilador);
    const alturaPx = alturaEquilibrada(galeria, posiciones, primera.geo.columnas);
    if (alturaPx) {
      primera = TYPST.construirTypst(documento, hoja, Object.assign({ alturaColumnasPx: alturaPx }, opciones));
    }
    const pdf = compilar(primera.fuente, primera.recursos);
    return { pdf, avisos: primera.avisos };
  }
  compilar(primera.fuente, primera.recursos);
  let posiciones = posicionesDeBloques(compilador);
  let ajuste = TYPST.calcularAjuste(primera.bloques, posiciones, primera.geo);

  // Si algún párrafo lleva superíndice en su primera línea, la caja de
  // relleno crece y el flujo cambia: se vuelve a medir con las cajas ya
  // crecidas (que es el flujo real de Chromium) antes del ajuste fino.
  const soloSups = {};
  for (const [k, a] of Object.entries(ajuste)) {
    if (a.supEnPrimera) soloSups[k] = { supEnPrimera: true };
  }
  if (Object.keys(soloSups).length) {
    const media = TYPST.construirTypst(documento, hoja, Object.assign({ ajuste: soloSups }, opciones));
    compilar(media.fuente, media.recursos);
    posiciones = posicionesDeBloques(compilador);
    ajuste = TYPST.calcularAjuste(media.bloques, posiciones, media.geo, soloSups);
  }

  const segunda = TYPST.construirTypst(documento, hoja, Object.assign({ ajuste }, opciones));
  const pdf = compilar(segunda.fuente, segunda.recursos);
  return { pdf, avisos: segunda.avisos, fuente: segunda.fuente };
}

/**
 * Altura de columna equilibrada al estilo de Chromium: la mínima que
 * reparte todas las líneas en las columnas disponibles. Los cortes
 * posibles son los finales de línea de la galería.
 */
function alturaEquilibrada(galeria, posiciones, columnas) {
  const PX = TYPST.PX;
  const superior = galeria.geo.margenes.superior;
  const limites = [];
  for (const b of galeria.bloques) {
    const p = posiciones[b.k];
    if (!p || p.yIni === undefined || p.yFin === undefined) continue;
    const primera = (p.yIni - superior) / PX;
    const ultima = (p.yFin - superior) / PX;
    const n = b.lh > 0 ? Math.max(1, Math.round((ultima - primera) / b.lh) + 1) : 1;
    for (let j = 0; j < n; j++) limites.push(primera + j * b.lh + b.descL);
    if (b.pb) limites.push(ultima + b.descL + b.pb);
  }
  if (!limites.length) return null;
  limites.sort((a, b) => a - b);
  const total = limites[limites.length - 1];

  // Reparto voraz: cada trozo va a la columna actual si cabe; si no, abre
  // columna nueva en el límite anterior. Devuelve cuántas columnas usa.
  const columnasUsadas = (h) => {
    let usadas = 1;
    let inicio = 0;
    let previo = 0;
    for (const corte of limites) {
      if (corte - inicio > h + 1e-6) {
        usadas++;
        inicio = previo;
        if (corte - inicio > h + 1e-6) return Infinity; // un trozo mayor que la columna
      }
      previo = corte;
    }
    return usadas;
  };

  // La mínima altura que reparte el contenido en ≤ N columnas, empezando
  // por el reparto ideal y estirando hasta el siguiente final de línea.
  const objetivo = total / columnas;
  for (const corte of limites) {
    if (corte + 1e-6 >= objetivo && columnasUsadas(corte) <= columnas) {
      return corte + 0.5;
    }
  }
  return total + 0.5;
}

/**
 * Tras compilar, pregunta a Typst dónde ha quedado cada bloque. Devuelve
 * { k: { pagina, yIni, paginaFin, yFin } } con las líneas base primera y
 * última de cada bloque en pt de página.
 */
function posicionesDeBloques(compilador) {
  const crudo = compilador.query('/main.typ', null, '<ul-b>', null);
  const lista = JSON.parse(crudo);
  const posiciones = {};
  const pt = (s) => parseFloat(String(s));
  for (const e of lista) {
    const v = e.value || {};
    const k = v.b;
    if (k === undefined) continue;
    const p = posiciones[k] || (posiciones[k] = {});
    if (v.q === 'i') {
      p.pagina = v.p;
      p.yIni = pt(v.y);
    } else if (v.q === 's') {
      (p.sups = p.sups || []).push({ pagina: v.p, y: pt(v.y) });
    } else {
      p.paginaFin = v.p;
      p.yFin = pt(v.y);
    }
  }
  return posiciones;
}

module.exports = {
  prepararMotor,
  compilarPdf,
  posicionesDeBloques,
  IndiceFuentes,
  carpetasDelSistema,
  familiasQuePideLaHoja,
  URL_COMPILADOR,
  VERSION_COMPILADOR,
  FICHERO_COMPILADOR,
};
