'use strict';

/*
 * Lectura minima de ficheros de fuente (TTF, OTF, TTC)
 * ===================================================
 *
 * Para componer el PDF con Typst necesitamos dos cosas de cada fuente:
 *
 *   1. Como se llama y que cara es (familia, peso, cursiva), para saber
 *      que fichero responde a «Baskerville en negrita».
 *   2. Sus metricas verticales (ascendente y descendente), porque la
 *      altura de linea de Chromium se calcula a partir de ellas y hay
 *      que reproducirla tal cual para que el PDF salga identico.
 *
 * No se interpreta ningun contorno: solo se leen las tablas «name»,
 * «head», «hhea» y «OS/2». Un .ttc es una coleccion con varias caras;
 * se devuelven todas.
 */

function leerTabla(vista, base) {
  const numTablas = vista.getUint16(base + 4);
  const tablas = {};
  for (let i = 0; i < numTablas; i++) {
    const p = base + 12 + i * 16;
    const etiqueta = String.fromCharCode(
      vista.getUint8(p), vista.getUint8(p + 1), vista.getUint8(p + 2), vista.getUint8(p + 3)
    );
    tablas[etiqueta] = { inicio: vista.getUint32(p + 8), longitud: vista.getUint32(p + 12) };
  }
  return tablas;
}

function decodificarNombre(bytes, inicio, longitud, plataforma, codificacion) {
  // Plataforma 0 (Unicode) y 3 (Windows) van en UTF-16BE; 1 (Mac) en ASCII/MacRoman.
  if (plataforma === 0 || plataforma === 3) {
    let s = '';
    for (let i = 0; i + 1 < longitud; i += 2) {
      s += String.fromCharCode((bytes[inicio + i] << 8) | bytes[inicio + i + 1]);
    }
    return s;
  }
  let s = '';
  for (let i = 0; i < longitud; i++) s += String.fromCharCode(bytes[inicio + i]);
  return s;
}

function leerNombres(vista, bytes, tabla) {
  const nombres = {};
  if (!tabla) return nombres;
  const base = tabla.inicio;
  const cuenta = vista.getUint16(base + 2);
  const almacen = base + vista.getUint16(base + 4);
  for (let i = 0; i < cuenta; i++) {
    const p = base + 6 + i * 12;
    const plataforma = vista.getUint16(p);
    const codificacion = vista.getUint16(p + 2);
    const idioma = vista.getUint16(p + 4);
    const id = vista.getUint16(p + 6);
    const longitud = vista.getUint16(p + 8);
    const desplazamiento = vista.getUint16(p + 10);
    // Preferimos ingles de Windows (3/1/0x409) o Mac Roman (1/0/0).
    const prioridad = plataforma === 3 && idioma === 0x409 ? 3 : plataforma === 1 && idioma === 0 ? 2 : 1;
    const valor = decodificarNombre(bytes, almacen + desplazamiento, longitud, plataforma, codificacion);
    if (!nombres[id] || nombres[id].prioridad < prioridad) nombres[id] = { valor, prioridad };
  }
  const salida = {};
  for (const k of Object.keys(nombres)) salida[k] = nombres[k].valor;
  return salida;
}

function leerCara(vista, bytes, base) {
  const tablas = leerTabla(vista, base);
  const nombres = leerNombres(vista, bytes, tablas.name);
  const head = tablas.head;
  const hhea = tablas.hhea;
  const os2 = tablas['OS/2'];

  const upm = head ? vista.getUint16(head.inicio + 18) : 1000;
  const macStyle = head ? vista.getUint16(head.inicio + 44) : 0;

  const cara = {
    familia: nombres[16] || nombres[1] || '',
    familiaBasica: nombres[1] || nombres[16] || '',
    subfamilia: nombres[17] || nombres[2] || '',
    nombreCompleto: nombres[4] || '',
    upm,
    peso: 400,
    cursiva: !!(macStyle & 2),
    ascendente: 0,
    descendente: 0,
    huecoLinea: 0,
  };

  if (hhea) {
    cara.ascendente = vista.getInt16(hhea.inicio + 4);
    cara.descendente = -vista.getInt16(hhea.inicio + 6);
    cara.huecoLinea = vista.getInt16(hhea.inicio + 8);
    cara.numMetricas = vista.getUint16(hhea.inicio + 34);
  }
  // Avances de glifo, para medir texto (cmap + hmtx), en perezoso.
  cara.tablas = { cmap: tablas.cmap, hmtx: tablas.hmtx, vista };
  if (os2) {
    const version = vista.getUint16(os2.inicio);
    cara.peso = vista.getUint16(os2.inicio + 4);
    const fsSelection = vista.getUint16(os2.inicio + 62);
    if (fsSelection & 1) cara.cursiva = true;
    const typoAsc = vista.getInt16(os2.inicio + 68);
    const typoDesc = vista.getInt16(os2.inicio + 70);
    const typoHueco = vista.getInt16(os2.inicio + 72);
    const winAsc = vista.getUint16(os2.inicio + 74);
    const winDesc = vista.getUint16(os2.inicio + 76);
    cara.typo = { ascendente: typoAsc, descendente: -typoDesc, hueco: typoHueco };
    cara.win = { ascendente: winAsc, descendente: winDesc };
    // USE_TYPO_METRICS (bit 7): FreeType y Skia prefieren entonces OS/2.
    if (version >= 4 && fsSelection & 0x80) {
      cara.ascendente = typoAsc;
      cara.descendente = -typoDesc;
      cara.huecoLinea = typoHueco;
    }
    // Sin hhea util, FreeType cae a OS/2.
    if (!hhea || (cara.ascendente === 0 && cara.descendente === 0)) {
      cara.ascendente = typoAsc || winAsc;
      cara.descendente = -typoDesc || winDesc;
    }
  }
  return cara;
}

/**
 * Devuelve las caras de un fichero de fuente.
 * @param {ArrayBuffer|Uint8Array} datos
 */
function leerFuente(datos) {
  const bytes = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firma = vista.getUint32(0);
  const caras = [];
  if (firma === 0x74746366) {
    // 'ttcf'
    const n = vista.getUint32(8);
    for (let i = 0; i < n; i++) caras.push(leerCara(vista, bytes, vista.getUint32(12 + i * 4)));
  } else if (firma === 0x00010000 || firma === 0x4f54544f || firma === 0x74727565) {
    // TrueType, 'OTTO', 'true'
    caras.push(leerCara(vista, bytes, 0));
  } else {
    throw new Error('formato de fuente no reconocido');
  }
  return caras;
}

/**
 * Catalogo de caras: elige la mas parecida a (familia, peso, cursiva),
 * imitando a fontconfig: misma familia, luego la cursiva que toque y
 * el peso mas cercano.
 */
class CatalogoFuentes {
  constructor() {
    this.caras = [];
  }

  anadir(datos, origen) {
    for (const cara of leerFuente(datos)) {
      this.caras.push(Object.assign({ origen }, cara));
    }
  }

  familias() {
    return Array.from(new Set(this.caras.map((c) => c.familia))).sort();
  }

  tieneFamilia(familia) {
    const f = normalizar(familia);
    return this.caras.some((c) => normalizar(c.familia) === f || normalizar(c.familiaBasica) === f);
  }

  buscar(familia, peso, cursiva) {
    const f = normalizar(familia);
    const candidatas = this.caras.filter(
      (c) => normalizar(c.familia) === f || normalizar(c.familiaBasica) === f
    );
    if (!candidatas.length) return null;
    const objetivo = peso || 400;
    let mejor = null;
    let mejorPuntos = Infinity;
    for (const c of candidatas) {
      // La cursiva manda sobre el peso, como en fontconfig.
      const puntos = (c.cursiva !== !!cursiva ? 10000 : 0) + Math.abs(c.peso - objetivo);
      if (puntos < mejorPuntos) {
        mejorPuntos = puntos;
        mejor = c;
      }
    }
    return mejor;
  }
}

function normalizar(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/* ------------------------------------------------------------------ *
 * Medicion de texto (cmap + hmtx)
 * ------------------------------------------------------------------ */

function construirCmap(cara) {
  const { vista } = cara.tablas;
  const tabla = cara.tablas.cmap;
  const mapa = new Map();
  if (!tabla) return mapa;
  const base = tabla.inicio;
  const n = vista.getUint16(base + 2);
  let mejor = null;
  let mejorPuntos = -1;
  for (let i = 0; i < n; i++) {
    const plataforma = vista.getUint16(base + 4 + i * 8);
    const codificacion = vista.getUint16(base + 6 + i * 8);
    const desplazamiento = vista.getUint32(base + 8 + i * 8);
    const puntos =
      plataforma === 3 && codificacion === 10 ? 5 :
      plataforma === 0 && codificacion >= 4 ? 5 :
      plataforma === 3 && codificacion === 1 ? 4 :
      plataforma === 0 ? 3 : 1;
    if (puntos > mejorPuntos) { mejorPuntos = puntos; mejor = base + desplazamiento; }
  }
  if (mejor === null) return mapa;
  const formato = vista.getUint16(mejor);
  if (formato === 4) {
    const segX2 = vista.getUint16(mejor + 6);
    const fines = mejor + 14;
    const inicios = fines + segX2 + 2;
    const deltas = inicios + segX2;
    const rangos = deltas + segX2;
    for (let s = 0; s < segX2; s += 2) {
      const fin = vista.getUint16(fines + s);
      const inicio = vista.getUint16(inicios + s);
      const delta = vista.getInt16(deltas + s);
      const rango = vista.getUint16(rangos + s);
      for (let c = inicio; c <= fin && c !== 0xffff; c++) {
        let g;
        if (rango === 0) g = (c + delta) & 0xffff;
        else {
          const p = rangos + s + rango + (c - inicio) * 2;
          g = vista.getUint16(p);
          if (g !== 0) g = (g + delta) & 0xffff;
        }
        if (g) mapa.set(c, g);
      }
    }
  } else if (formato === 12) {
    const grupos = vista.getUint32(mejor + 12);
    for (let g = 0; g < grupos; g++) {
      const p = mejor + 16 + g * 12;
      const inicio = vista.getUint32(p);
      const fin = vista.getUint32(p + 4);
      const glifo = vista.getUint32(p + 8);
      for (let c = inicio; c <= fin; c++) mapa.set(c, glifo + (c - inicio));
    }
  }
  return mapa;
}

/** Avance de un glifo en unidades de la fuente. */
function avanceGlifo(cara, glifo) {
  const { vista, hmtx } = cara.tablas;
  if (!hmtx) return cara.upm / 2;
  const n = cara.numMetricas || 1;
  const indice = Math.min(glifo, n - 1);
  return vista.getUint16(hmtx.inicio + indice * 4);
}

/**
 * Ancho de un texto en px a un cuerpo dado (sin interletraje: para
 * decisiones de corte sobra; Chromium tampoco interletra los digitos).
 */
function medirTexto(cara, texto, tamanoPx) {
  if (!cara || !cara.tablas) return texto.length * 0.5 * tamanoPx;
  if (!cara.mapaCmap) cara.mapaCmap = construirCmap(cara);
  let unidades = 0;
  for (const ch of texto) {
    let c = ch.codePointAt(0);
    if (c === 0x200b || c === 0xad) continue; // sin anchura
    let g = cara.mapaCmap.get(c);
    if (g === undefined && (c === 0xa0 || c === 0x2007 || c === 0x202f)) {
      g = cara.mapaCmap.get(0x20); // espacios duros sin glifo propio: el del espacio
    }
    unidades += g !== undefined ? avanceGlifo(cara, g) : cara.upm / 2;
  }
  return (unidades / cara.upm) * tamanoPx;
}

module.exports = { leerFuente, CatalogoFuentes, normalizar, medirTexto };
