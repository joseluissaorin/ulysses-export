'use strict';

/*
 * Deteccion de tipografias instaladas
 * ===================================
 *
 * Dos vias, en este orden:
 *
 *   1. queryLocalFonts() de Chromium, que da la lista real y completa.
 *      Requiere permiso y no siempre esta disponible en Electron.
 *   2. Medicion: se dibuja una cadena en un canvas con la familia pedida
 *      y con las tres genericas. Si el ancho difiere de las tres, la
 *      familia existe; si coincide con alguna, el navegador ha caido en
 *      la de reserva y por tanto no esta instalada.
 *
 * Esto importa mas de lo que parece: exportar con una tipografia que no
 * se tiene produce un PDF con otra distinta y sin avisar.
 */

const GENERICAS = ['monospace', 'serif', 'sans-serif'];
const MUESTRA = 'mmmmmmmmmmlliWWWWQ@#áéñ';
const CUERPO = 72;

/** Catalogo de candidatas: lo habitual en macOS, Windows y Linux. */
const CANDIDATAS = [
  // Las que usan las hojas de Ulysses
  'Avenir', 'Avenir Next', 'Avenir Next Condensed', 'Baskerville', 'Courier New',
  'Gill Sans', 'Helvetica Neue', 'Hoefler Text', 'Optima', 'Times New Roman',
  // macOS
  'American Typewriter', 'Andale Mono', 'Arial', 'Arial Black', 'Arial Narrow',
  'Athelas', 'Bodoni 72', 'Bradley Hand', 'Chalkboard', 'Charter', 'Cochin',
  'Copperplate', 'Didot', 'Futura', 'Geneva', 'Georgia', 'Helvetica',
  'Iowan Old Style', 'Lucida Grande', 'Menlo', 'Monaco', 'Palatino',
  'Papyrus', 'Rockwell', 'San Francisco', 'Savoye LET', 'SF Pro', 'Skia',
  'Snell Roundhand', 'Superclarendon', 'Trattatello', 'Verdana', 'Zapfino',
  'New York', 'PT Serif', 'PT Sans', 'Seravek', 'Marion', 'Trebuchet MS',
  // Windows
  'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Consolas', 'Constantia',
  'Corbel', 'Ebrima', 'Franklin Gothic', 'Gabriola', 'Impact', 'Ink Free',
  'Lucida Console', 'Lucida Sans', 'Malgun Gothic', 'Microsoft Sans Serif',
  'Segoe UI', 'Segoe Print', 'Segoe Script', 'Sitka', 'Sylfaen', 'Tahoma',
  'Comic Sans MS', 'Book Antiqua', 'Bookman Old Style', 'Century Schoolbook',
  'Garamond', 'Perpetua', 'Baskerville Old Face',
  // Linux y libres habituales
  'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono', 'Liberation Sans',
  'Liberation Serif', 'Liberation Mono', 'Nimbus Roman', 'Nimbus Sans',
  'Nimbus Mono PS', 'URW Bookman', 'URW Palladio L', 'C059', 'P052', 'Z003',
  'Noto Sans', 'Noto Serif', 'Noto Sans Mono', 'Cantarell', 'Ubuntu',
  'Ubuntu Mono', 'FreeSerif', 'FreeSans', 'Carlito', 'Caladea',
  // De uso comun en edicion
  'EB Garamond', 'Libre Baskerville', 'Playfair Display', 'Lora', 'Merriweather',
  'Source Serif Pro', 'Source Sans Pro', 'Source Code Pro', 'Crimson Text',
  'Alegreya', 'Cardo', 'Vollkorn', 'Spectral', 'Literata', 'Bitter',
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Raleway',
  'Work Sans', 'Nunito', 'Karla', 'Rubik', 'Fira Sans', 'Fira Code',
  'IBM Plex Serif', 'IBM Plex Sans', 'IBM Plex Mono', 'JetBrains Mono',
];

/** Mide el ancho de la muestra con una pila tipografica concreta. */
function medir(ctx, pila) {
  ctx.font = `${CUERPO}px ${pila}`;
  return ctx.measureText(MUESTRA).width;
}

/**
 * Comprueba si una familia esta instalada de verdad.
 * `base` son los anchos de las genericas, medidos una sola vez.
 */
function instalada(ctx, base, familia) {
  const entrecomillada = /[^\w-]/.test(familia) ? `"${familia}"` : familia;
  for (const g of GENERICAS) {
    if (Math.abs(medir(ctx, `${entrecomillada}, ${g}`) - base[g]) > 0.5) return true;
  }
  return false;
}

/**
 * Lista de tipografias disponibles.
 * Devuelve {lista, exacta} — «exacta» indica si viene de queryLocalFonts.
 */
async function disponibles(extra) {
  const adicionales = (extra || []).filter(Boolean);

  if (typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function') {
    try {
      const crudas = await window.queryLocalFonts();
      const familias = Array.from(new Set(crudas.map((f) => f.family))).filter(Boolean);
      if (familias.length) {
        for (const a of adicionales) if (!familias.includes(a)) familias.push(a);
        return { lista: familias.sort((a, b) => a.localeCompare(b, 'es')), exacta: true };
      }
    } catch (e) {
      // Sin permiso o no soportado: seguimos por medicion.
    }
  }

  const lienzo = document.createElement('canvas');
  const ctx = lienzo.getContext('2d');
  const base = {};
  for (const g of GENERICAS) base[g] = medir(ctx, g);

  const candidatas = Array.from(new Set(CANDIDATAS.concat(adicionales)));
  const lista = candidatas.filter((f) => instalada(ctx, base, f));
  return { lista: lista.sort((a, b) => a.localeCompare(b, 'es')), exacta: false };
}

/** Comprobacion suelta, para avisar de una familia escrita a mano. */
function comprobar(familia) {
  if (!familia) return true;
  try {
    const lienzo = document.createElement('canvas');
    const ctx = lienzo.getContext('2d');
    const base = {};
    for (const g of GENERICAS) base[g] = medir(ctx, g);
    return instalada(ctx, base, String(familia).replace(/^["']|["']$/g, ''));
  } catch (e) {
    return true; // ante la duda, no molestamos
  }
}

module.exports = { disponibles, comprobar, CANDIDATAS, GENERICAS };
