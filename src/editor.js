'use strict';

/*
 * Edicion de hojas .ulss conservando el texto original
 * ====================================================
 *
 * El editor NO regenera la hoja a partir de un modelo: eso perderia todo
 * lo que la interfaz no expone (los bloques syntax-*, los comentarios del
 * autor, las variables). En vez de eso reescribe propiedad a propiedad
 * sobre el texto original, respetando su formato.
 */

/** Localiza el bloque de un selector. Devuelve {ini, fin, cabecera} o null. */
function localizarBloque(texto, selector) {
  const lineas = texto.split('\n');
  // El selector puede llevar espacios («table-cell :header»); en el fichero
  // los separadores pueden ser espacios o tabuladores en cualquier cantidad.
  const patron = new RegExp(
    '^\\s*' +
      selector
        .trim()
        .split(/\s+/)
        .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s*') +
      '\\s*(:\\s*@[\\w-]+\\s*(,\\s*@[\\w-]+\\s*)*)?\\{'
  );

  for (let i = 0; i < lineas.length; i++) {
    if (!patron.test(lineas[i])) continue;
    // Buscamos la llave de cierre: en .ulss no hay bloques anidados.
    for (let j = i; j < lineas.length; j++) {
      if (j > i || lineas[i].indexOf('}') > lineas[i].indexOf('{')) {
        if (/^\s*\}/.test(lineas[j]) || (j === i && /\}/.test(lineas[i]))) {
          return { ini: i, fin: j, lineas };
        }
      }
    }
    return { ini: i, fin: lineas.length - 1, lineas };
  }
  return null;
}

/**
 * Valor actual de una propiedad, tal cual esta escrito. Null si no esta.
 *
 * Si aparece varias veces en el mismo bloque gana la ULTIMA, que es lo
 * que hace el parser al resolver. Hay hojas reales con duplicados: el
 * area-footer de My Knife V1 declara «text-alignment» dos veces, y
 * quedarse con la primera mostraba un valor que no era el aplicado.
 */
function leerPropiedad(texto, selector, propiedad) {
  const b = localizarBloque(texto, selector);
  if (!b) return null;
  const re = new RegExp('(^|;)\\s*' + propiedad.replace(/-/g, '\\-') + '\\s*:\\s*([^;}]*)');
  let ultimo = null;
  for (let i = b.ini; i <= b.fin; i++) {
    const linea = b.lineas[i].replace(/\/\/.*$/, '');
    const m = re.exec(linea);
    if (m) ultimo = m[2].trim().replace(/\}$/, '').trim();
  }
  return ultimo;
}

/**
 * Escribe una propiedad. Si el valor es null se borra la linea.
 * Si el bloque no existe se crea al final del fichero.
 */
function escribirPropiedad(texto, selector, propiedad, valor) {
  const b = localizarBloque(texto, selector);
  const escapada = propiedad.replace(/-/g, '\\-');
  const re = new RegExp('^(\\s*)' + escapada + '\\s*:\\s*([^;}]*)(;?)(.*)$');

  if (b) {
    // Se escribe sobre la ultima aparicion, que es la que manda.
    let objetivo = -1;
    for (let i = b.ini; i <= b.fin; i++) {
      if (re.test(b.lineas[i].replace(/\/\/.*$/, ''))) objetivo = i;
    }
    for (let i = objetivo; i === objetivo && i >= 0; i++) {
      const m = re.exec(b.lineas[i].replace(/\/\/.*$/, ''));
      if (!m) continue;
      if (valor === null || valor === undefined || valor === '') {
        b.lineas.splice(i, 1);
      } else {
        const comentario = /\/\/.*$/.exec(b.lineas[i]);
        b.lineas[i] =
          `${m[1]}${propiedad}:\t${valor}${m[3]}${m[4] || ''}` +
          (comentario ? '\t' + comentario[0] : '');
      }
      return b.lineas.join('\n');
    }
    if (valor === null || valor === undefined || valor === '') return texto;
    // No estaba: la insertamos justo antes de la llave de cierre.
    const sangria = deducirSangria(b.lineas, b.ini, b.fin);
    b.lineas.splice(b.fin, 0, `${sangria}${propiedad}:\t${valor}`);
    return b.lineas.join('\n');
  }

  if (valor === null || valor === undefined || valor === '') return texto;
  return texto.replace(/\s*$/, '') + `\n\n${selector} {\n\t${propiedad}:\t${valor}\n}\n`;
}

function deducirSangria(lineas, ini, fin) {
  for (let i = ini + 1; i < fin; i++) {
    const m = /^([ \t]+)\S/.exec(lineas[i]);
    if (m) return m[1];
  }
  return '\t';
}

/** Lee varias propiedades de golpe: [{selector, propiedad}] -> {clave: valor} */
function leerVarias(texto, campos) {
  const salida = {};
  for (const c of campos) {
    salida[c.clave] = leerPropiedad(texto, c.selector, c.propiedad);
  }
  return salida;
}

/** Aplica varios cambios en orden. */
function escribirVarias(texto, cambios) {
  let t = texto;
  for (const c of cambios) {
    t = escribirPropiedad(t, c.selector, c.propiedad, c.valor);
  }
  return t;
}

/* ------------------------------------------------------------------ *
 * Esquema de lo editable
 * ------------------------------------------------------------------ */

const ALINEACIONES = [
  ['', '(heredada)'],
  ['left', 'Izquierda'],
  ['justified', 'Justificada'],
  ['center', 'Centrada'],
  ['right', 'Derecha'],
];

const SI_NO = [['', '(heredado)'], ['yes', 'Sí'], ['no', 'No']];

const l = (selector, propiedad, etiqueta, ayuda) => ({
  selector, propiedad, etiqueta, ayuda, tipo: 'longitud',
});
const t = (selector, propiedad, etiqueta, ayuda) => ({
  selector, propiedad, etiqueta, ayuda, tipo: 'texto',
});
const o = (selector, propiedad, etiqueta, opciones, ayuda) => ({
  selector, propiedad, etiqueta, opciones, ayuda, tipo: 'opcion',
});
const c = (selector, propiedad, etiqueta, ayuda) => ({
  selector, propiedad, etiqueta, ayuda, tipo: 'color',
});

function seccionTitular(n) {
  const s = `heading-${n}`;
  return {
    titulo: `Titular de nivel ${n}`,
    campos: [
      l(s, 'font-size', 'Cuerpo'),
      l(s, 'line-height', 'Interlineado'),
      o(s, 'font-weight', 'Peso', [['', '(heredado)'], ['normal', 'Normal'], ['bold', 'Negrita']]),
      o(s, 'font-slant', 'Inclinación', [['', '(heredada)'], ['normal', 'Redonda'], ['italic', 'Cursiva']]),
      o(s, 'underline', 'Subrayado', [['', '(no)'], ['single', 'Sencillo'], ['none', 'Ninguno']]),
      o(s, 'text-alignment', 'Alineación', ALINEACIONES),
      l(s, 'margin-top', 'Espacio antes'),
      l(s, 'margin-bottom', 'Espacio después'),
      o(s, 'page-break', 'Salto de página', [['', '(ninguno)'], ['before', 'Antes'], ['after', 'Después'], ['none', 'Nunca']]),
      t(s, 'style-title', 'Nombre del estilo en Word'),
    ],
  };
}

const SECCIONES = [
  {
    titulo: 'Página',
    campos: [
      l('document-settings', 'page-inset-top', 'Margen superior', 'Por ejemplo 25mm'),
      l('document-settings', 'page-inset-bottom', 'Margen inferior'),
      l('document-settings', 'page-inset-inner', 'Margen interior'),
      l('document-settings', 'page-inset-outer', 'Margen exterior'),
      l('document-settings', 'page-width', 'Ancho de página', 'Vacío = el del ajuste general'),
      l('document-settings', 'page-height', 'Alto de página'),
      o('document-settings', 'two-sided', 'A doble cara', SI_NO),
      o('document-settings', 'section-break', 'Empezar página nueva en', [
        ['', '(nunca)'], ['heading-1', 'Titular 1'], ['heading-2', 'Titular 2'],
        ['heading-3', 'Titular 3'], ['paragraph-divider', 'Divisor'],
      ]),
      l('document-settings', 'column-count', 'Columnas', 'Un número: 1, 2, 3…'),
      l('document-settings', 'column-spacing-width', 'Separación entre columnas'),
    ],
  },
  {
    titulo: 'Tipografía base',
    campos: [
      t('defaults', 'font-family', 'Tipografía', 'Entre comillas: "Optima"'),
      l('defaults', 'font-size', 'Cuerpo', 'Por ejemplo 12pt'),
      l('defaults', 'line-height', 'Interlineado', 'Absoluto (18pt) o relativo (150%)'),
      o('defaults', 'text-alignment', 'Alineación', ALINEACIONES),
      o('defaults', 'hyphenation', 'Guionado automático', SI_NO),
      o('defaults', 'orphans-and-widows', 'Viudas y huérfanas', [['', '(por defecto)'], ['prevented', 'Evitarlas'], ['allowed', 'Permitirlas']]),
    ],
  },
  seccionTitular(1), seccionTitular(2), seccionTitular(3),
  seccionTitular(4), seccionTitular(5), seccionTitular(6),
  {
    titulo: 'Párrafo',
    campos: [
      l('paragraph', 'first-line-indent', 'Sangría de primera línea'),
      l('paragraph', 'margin-top', 'Espacio antes'),
      l('paragraph', 'margin-bottom', 'Espacio después'),
      o('paragraph', 'text-alignment', 'Alineación', ALINEACIONES),
      l('paragraph :first', 'first-line-indent', 'Sangría del primer párrafo'),
      l('heading-all + paragraph', 'first-line-indent', 'Sangría tras un titular'),
      l('paragraph + paragraph', 'first-line-indent', 'Sangría de los siguientes'),
      l('paragraph-bibliography', 'first-line-indent', 'Sangría de bibliografía', 'Negativa para francesa: -12.5mm'),
      l('paragraph-bibliography', 'margin-left', 'Margen de bibliografía'),
    ],
  },
  {
    titulo: 'Cita en bloque',
    campos: [
      l('block-quote', 'margin-left', 'Margen izquierdo'),
      l('block-quote', 'margin-right', 'Margen derecho'),
      l('block-quote', 'margin-top', 'Espacio antes'),
      o('block-quote', 'font-slant', 'Inclinación', [['', '(heredada)'], ['normal', 'Redonda'], ['italic', 'Cursiva']]),
      l('block-quote', 'font-size', 'Cuerpo'),
      o('block-quote paragraph', 'text-alignment', 'Alineación', ALINEACIONES),
    ],
  },
  {
    titulo: 'Bloque de código',
    campos: [
      t('block-code', 'font-family', 'Tipografía', '"Courier New"'),
      l('block-code', 'font-size', 'Cuerpo'),
      l('block-code', 'line-height', 'Interlineado'),
      l('block-code', 'margin-left', 'Margen izquierdo'),
      l('block-code', 'margin-top', 'Espacio antes'),
      l('block-code', 'first-line-indent', 'Sangría', 'Negativa = francesa'),
      l('block-code', 'default-tab-interval', 'Ancho del tabulador'),
    ],
  },
  {
    titulo: 'Listas',
    campos: [
      l('list-all', 'margin-left', 'Margen (se acumula por nivel)'),
      t('list-unordered', 'enumeration-format', 'Marca de viñeta', 'Entre comillas: "-"'),
      l('list-unordered', 'text-inset', 'Separación de la viñeta'),
      t('list-ordered', 'enumeration-format', 'Formato numerado', '"%d." o "%*.%d"'),
      l('list-ordered', 'text-inset', 'Separación del número'),
    ],
  },
  {
    titulo: 'Divisor',
    campos: [
      t('paragraph-divider', 'content', 'Contenido', 'Entre comillas: "*****". Vacío = línea'),
      o('paragraph-divider', 'page-break', 'Salto de página', [['', '(ninguno)'], ['after', 'Después'], ['before', 'Antes'], ['none', 'Nunca']]),
      o('paragraph-divider', 'text-alignment', 'Alineación', ALINEACIONES),
      c('paragraph-divider', 'font-color', 'Color'),
      l('paragraph-divider', 'margin-top', 'Espacio antes'),
      o('paragraph-divider', 'visibility', 'Visible', [['', '(sí)'], ['visible', 'Sí'], ['hidden', 'No']]),
    ],
  },
  {
    titulo: 'Pie de página y notas',
    campos: [
      o('area-footer', 'content', 'Contenido del pie', [['', '(nada)'], ['page-number', 'Número de página'], ['none', 'Nada']]),
      o('area-footer', 'text-alignment', 'Alineación del pie', ALINEACIONES),
      l('area-footer', 'font-size', 'Cuerpo del pie'),
      l('area-footer', 'bottom-spacing', 'Distancia al borde'),
      l('area-footnotes', 'font-size', 'Cuerpo de las notas'),
      l('area-footnotes', 'line-height', 'Interlineado de las notas'),
      o('document-settings', 'footnote-style', 'Numeración de notas', [
        ['', '(decimal)'], ['decimal', 'Números'], ['roman', 'Romanos'], ['alpha', 'Letras'], ['symbol', 'Símbolos'],
      ]),
      o('document-settings', 'footnote-placement', 'Colocación', [['', '(al pie)'], ['end-of-page', 'Al pie de página'], ['end-of-document', 'Al final']]),
    ],
  },
  {
    titulo: 'Estilos de texto',
    campos: [
      o('inline-strong', 'font-weight', 'Negrita', [['', '(negrita)'], ['bold', 'Negrita'], ['normal', 'Normal']]),
      o('inline-emphasis', 'font-slant', 'Cursiva', [['', '(cursiva)'], ['italic', 'Cursiva'], ['normal', 'Redonda']]),
      o('inline-delete', 'strikethrough', 'Tachado', [['', '(tachado)'], ['single', 'Sencillo'], ['none', 'Ninguno']]),
      c('inline-mark', 'background-color', 'Fondo del resaltado'),
      t('inline-link', 'font-family', 'Tipografía del enlace'),
      o('inline-link', 'underline', 'Subrayar enlaces', [['', '(no)'], ['single', 'Sí'], ['none', 'No']]),
      c('inline-link', 'font-color', 'Color del enlace'),
      t('inline-code', 'font-family', 'Tipografía del código en línea'),
      l('inline-code', 'font-size', 'Cuerpo del código en línea'),
    ],
  },
  {
    titulo: 'Tablas',
    campos: [
      l('table', 'border-top-width', 'Grosor del borde superior'),
      l('table', 'border-bottom-width', 'Grosor del borde inferior'),
      l('table-cell', 'padding-top', 'Relleno superior de celda'),
      l('table-cell', 'padding-bottom', 'Relleno inferior'),
      l('table-cell', 'padding-right', 'Relleno derecho'),
      l('table-cell', 'line-height', 'Interlineado de celda'),
      o('table-cell :header', 'font-weight', 'Cabecera en negrita', [['', '(no)'], ['bold', 'Sí'], ['normal', 'No']]),
    ],
  },
];

/** Plantilla minima para empezar un estilo desde cero. */
function plantilla(nombre) {
  return `//
// ${nombre}
//
// Creado con el editor de estilos del plugin de Obsidian.
// Referencia: https://styles.ulysses.app/learn
//

document-settings {
\tpage-inset-top:\t\t25mm
\tpage-inset-bottom:\t25mm
\tpage-inset-inner:\t25mm
\tpage-inset-outer:\t25mm

\ttwo-sided:\t\tno
\tsection-break:\t\theading-1
}

defaults {
\tfont-family:\t\t"Times New Roman"
\tfont-size:\t\t12pt
\tline-height:\t\t18pt

\ttext-alignment:\t\tjustified
\thyphenation:\t\tno
}

area-header {
\tcontent:\t\tnone
}

area-footer {
\tcontent:\t\tpage-number
\ttext-alignment:\t\tcenter
\tbottom-spacing:\t\t10mm
}

area-footnotes {
\tfont-size:\t\t10pt
\tline-height:\t\t14pt
}

@code {
\tfont-family:\t\t"Courier New"
\tfont-weight:\t\tnormal
\tfont-slant:\t\tnormal
}

heading-all {
\tfont-weight:\t\tbold
\tkeep-with-following:\ttrue
\ttext-alignment:\t\tleft
}

heading-1 {\tfont-size:\t18pt\tline-height:\t24pt\tmargin-bottom:\t4mm }
heading-2 {\tfont-size:\t16pt\tline-height:\t22pt\tmargin-top:\t4mm\tmargin-bottom:\t2mm }
heading-3 {\tfont-size:\t14pt\tline-height:\t20pt\tmargin-top:\t3mm\tmargin-bottom:\t2mm }
heading-4 {\tfont-size:\t13pt\tline-height:\t18pt\tmargin-bottom:\t2mm }
heading-5 {\tfont-size:\t12pt\tline-height:\t18pt\tmargin-bottom:\t2mm }
heading-6 {\tfont-size:\t11pt\tline-height:\t16pt\tmargin-bottom:\t2mm }

paragraph {
\tfirst-line-indent:\t10mm
\tmargin-top:\t\t0pt
\tmargin-bottom:\t\t0pt
}

paragraph :first {
\tfirst-line-indent:\t0pt
}

paragraph-divider {
\tpage-break:\t\tafter
}

block-all {
\tmargin-top:\t\t12pt
\tmargin-bottom:\t\t12pt
\tmargin-left:\t\t3em
\tmargin-right:\t\t3em
}

block-code : @code {
\tfont-size:\t\t10pt
\tline-height:\t\t14pt
}

block-quote {
\tfont-slant:\t\titalic
}

list-all {
\tmargin-left:\t\t5mm
}

list-unordered {
\tenumeration-format:\t"-"
\ttext-inset:\t\t1.3em
}

list-ordered {
\tenumeration-format:\t"%d."
\ttext-inset:\t\t1.3em
}

inline-strong {\tfont-weight:\tbold }
inline-emphasis {\tfont-slant:\titalic }
inline-code : @code { }
inline-link {\tunderline:\tsingle }
inline-delete {\tstrikethrough:\tsingle }
inline-mark {\tbackground-color:\t#FEFDD5 }

table {
\tborder-top-style:\tsolid
\tborder-top-width:\t1pt
\tborder-bottom-style:\tsolid
\tborder-bottom-width:\t1pt
}

table-cell {
\tpadding-top:\t\t4pt
\tpadding-bottom:\t\t4pt
\tline-height:\t\t16pt
}

table-cell :header {
\tfont-weight:\t\tbold
}
`;
}

module.exports = {
  localizarBloque,
  leerPropiedad,
  escribirPropiedad,
  leerVarias,
  escribirVarias,
  SECCIONES,
  plantilla,
};

/* ------------------------------------------------------------------ *
 * Utilidades para la interfaz
 * ------------------------------------------------------------------ */

const UNIDADES = ['pt', 'mm', 'cm', 'in', 'em', '%'];
const A_PUNTOS = { pt: 1, mm: 72 / 25.4, cm: 720 / 25.4, in: 72, px: 0.75 };

/** «12.5mm» -> {numero: 12.5, unidad: 'mm'}. Null si no es una medida. */
function parsearMedida(valor) {
  if (valor === null || valor === undefined) return null;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(pt|mm|cm|in|px|em|ex|%)?\s*$/i.exec(String(valor));
  if (!m) return null;
  return {
    numero: parseFloat(m[1].replace(',', '.')),
    unidad: (m[2] || '').toLowerCase(),
  };
}

/** Compone el valor de vuelta, sin ceros decimales sobrantes. */
function formatearMedida(numero, unidad) {
  if (numero === null || numero === undefined || Number.isNaN(numero)) return '';
  const n = Math.round(numero * 1000) / 1000;
  return `${n}${unidad || ''}`;
}

/** Convierte entre unidades absolutas. Los em y % necesitan contexto. */
function convertir(numero, de, a, contextoPt) {
  const ctx = contextoPt || 12;
  const enPuntos =
    de === 'em' ? numero * 0.6 * ctx
    : de === '%' ? (numero / 100) * ctx
    : numero * (A_PUNTOS[de] || 1);
  if (a === 'em') return enPuntos / (0.6 * ctx);
  if (a === '%') return (enPuntos / ctx) * 100;
  return enPuntos / (A_PUNTOS[a] || 1);
}

/** Texto de ayuda con la equivalencia en las unidades habituales. */
function equivalencia(valor, contextoPt) {
  const m = parsearMedida(valor);
  if (!m || !m.unidad) return '';
  const ctx = contextoPt || 12;
  if (m.unidad === 'em') {
    const pt = m.numero * 0.6 * ctx;
    return `= ${Math.round(pt * 100) / 100} pt · en Ulysses 1em vale 0,6 del cuerpo`;
  }
  if (m.unidad === '%') {
    return `= ${Math.round(((m.numero / 100) * ctx) * 100) / 100} pt sobre un cuerpo de ${ctx} pt`;
  }
  const pt = m.numero * (A_PUNTOS[m.unidad] || 1);
  const mm = pt / (72 / 25.4);
  return `= ${Math.round(pt * 100) / 100} pt · ${Math.round(mm * 100) / 100} mm`;
}

/** Todos los selectores donde una hoja declara una propiedad. */
function selectoresCon(texto, propiedad) {
  const salida = [];
  const lineas = texto.split('\n');
  let actual = null;
  for (const linea of lineas) {
    const limpia = linea.replace(/\/\/.*$/, '');
    const cab = /^\s*([a-z@][\w@ :+>-]*?)\s*(:\s*@[\w-]+\s*(,\s*@[\w-]+\s*)*)?\{/.exec(limpia);
    if (cab) {
      actual = cab[1].trim().replace(/\s+/g, ' ');
      continue;
    }
    if (/^\s*\}/.test(limpia)) {
      actual = null;
      continue;
    }
    if (actual && new RegExp('^\\s*' + propiedad.replace(/-/g, '\\-') + '\\s*:').test(limpia)) {
      salida.push(actual);
    }
  }
  return salida;
}

/** Sube o baja todos los cuerpos del estilo a la vez. */
function escalarCuerpos(texto, delta) {
  let t = texto;
  for (const sel of selectoresCon(texto, 'font-size')) {
    const actual = leerPropiedad(t, sel, 'font-size');
    const m = parsearMedida(actual);
    if (!m || m.unidad === '%' || m.unidad === 'em') continue;
    t = escribirPropiedad(t, sel, 'font-size', formatearMedida(m.numero + delta, m.unidad || 'pt'));
  }
  return t;
}

/** Cambia de golpe todas las tipografias que coincidan (o todas). */
function reemplazarFuentes(texto, nueva, soloEsta) {
  let t = texto;
  const sinComillas = (x) => String(x || '').replace(/^["']|["']$/g, '');
  const comillada = /^["']/.test(nueva) ? nueva : `"${nueva}"`;
  for (const sel of selectoresCon(texto, 'font-family')) {
    if (soloEsta && sinComillas(leerPropiedad(t, sel, 'font-family')) !== sinComillas(soloEsta)) continue;
    t = escribirPropiedad(t, sel, 'font-family', comillada);
  }
  return t;
}

const redondo = (n) => Math.round(n * 10) / 10;

/** Resumen de una linea para reconocer un estilo de un vistazo. */
function resumen(hoja) {
  const familia = hoja.familia('defaults', null);
  const cuerpo = hoja.puntos('defaults', 'font-size', 12, null);
  const inter = hoja.puntos('defaults', 'line-height', cuerpo || 12, null);
  const ali = hoja.palabra('defaults', 'text-alignment', null);
  const ancho = hoja.puntos('document-settings', 'page-width', 12, null);
  const nombres = { justified: 'justificado', left: 'izquierda', center: 'centrado', right: 'derecha' };
  const partes = [];
  if (familia) partes.push(familia);
  if (cuerpo) partes.push(inter ? `${redondo(cuerpo)}/${redondo(inter)}` : `${redondo(cuerpo)} pt`);
  if (ancho) partes.push(`${redondo(ancho / (72 / 25.4))} mm`);
  if (ali) partes.push(nombres[ali] || ali);
  return partes.join(' · ');
}

/** Diferencias entre dos versiones de una hoja, propiedad a propiedad. */
function diferencias(antes, despues, campos) {
  const salida = [];
  const vistos = new Set();
  const revisar = (selector, propiedad) => {
    const clave = selector + ' ' + propiedad;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    const a = leerPropiedad(antes, selector, propiedad);
    const b = leerPropiedad(despues, selector, propiedad);
    if (a !== b) salida.push({ selector, propiedad, antes: a, despues: b });
  };
  for (const c of campos || []) revisar(c.selector, c.propiedad);
  for (const texto of [antes, despues]) {
    for (const propiedad of ['font-family', 'font-size', 'line-height', 'margin-left', 'margin-top', 'first-line-indent']) {
      for (const sel of selectoresCon(texto, propiedad)) revisar(sel, propiedad);
    }
  }
  return salida;
}

module.exports.parsearMedida = parsearMedida;
module.exports.formatearMedida = formatearMedida;
module.exports.convertir = convertir;
module.exports.equivalencia = equivalencia;
module.exports.selectoresCon = selectoresCon;
module.exports.escalarCuerpos = escalarCuerpos;
module.exports.reemplazarFuentes = reemplazarFuentes;
module.exports.resumen = resumen;
module.exports.diferencias = diferencias;
module.exports.UNIDADES = UNIDADES;

/* ------------------------------------------------------------------ *
 * Valor efectivo
 * ------------------------------------------------------------------ */

/**
 * Cadena de herencia de un selector, la misma que recorre el emisor al
 * componer. Sirve para saber que valor se aplica DE VERDAD cuando el
 * bloque no lo declara: la tipografia de un titular suele venir de
 * «defaults», la del codigo del mixin «@code», y muchas hojas usan
 * variables. Sin esto el editor muestra el campo vacio y parece que no
 * detecta nada.
 */
function cadenaHerencia(selector) {
  const s = String(selector);
  if (/^heading-[1-6]$/.test(s)) return ['defaults', 'heading-all', s];
  if (s === 'heading-all') return ['defaults', 'heading-all'];
  if (s === 'block-quote' || s === 'block-quote paragraph') {
    return ['defaults', 'block-all', 'block-quote', s];
  }
  if (s === 'block-code' || s === 'block-code paragraph') {
    return ['defaults', 'block-all', 'block-code', s];
  }
  if (s.startsWith('block-')) return ['defaults', 'block-all', s];
  if (s.startsWith('list-')) return ['defaults', 'list-all', s];
  if (s.startsWith('table-cell')) return ['defaults', 'table-cell', s];
  if (s === 'table') return ['defaults', 'table'];
  if (s.startsWith('inline-')) return ['defaults', s];
  if (s.startsWith('syntax-')) return ['defaults', 'syntax-all', s];
  if (s.startsWith('paragraph') || s === 'heading-all + paragraph' || s === 'figure-caption') {
    return ['defaults', 'paragraph', s];
  }
  return [s];
}

/** Piezas resueltas del parser -> texto legible. */
function piezasATexto(piezas) {
  if (!piezas || !piezas.length) return null;
  return piezas
    .map((p) => {
      if (p.tipo === 'longitud') {
        const n = Math.round(p.numero * 1000) / 1000;
        return `${n}${p.unidad || ''}`;
      }
      return String(p.valor);
    })
    .join(' ');
}

/**
 * Que valor se aplica realmente, y de donde sale.
 * Devuelve {texto, origen, propio} o null.
 *   propio = true  -> lo declara el propio bloque
 *   propio = false -> lo hereda de «origen»
 */
function valorEfectivo(hoja, selector, propiedad) {
  if (!hoja) return null;
  const cadena = cadenaHerencia(selector);
  let piezas = null;
  let origen = null;
  for (const sel of cadena) {
    const bloque = hoja.bloque(sel);
    if (bloque && bloque[propiedad]) {
      piezas = bloque[propiedad];
      origen = sel;
    }
  }
  if (!piezas) return null;
  return { texto: piezasATexto(piezas), origen, propio: origen === selector };
}

/**
 * Explicacion corta para la pista del campo: de donde sale el valor y
 * si el texto escrito es una variable.
 */
function explicar(hoja, texto, selector, propiedad) {
  const crudo = leerPropiedad(texto, selector, propiedad);
  const efectivo = valorEfectivo(hoja, selector, propiedad);

  if (crudo !== null && /^\$/.test(crudo.trim())) {
    return {
      marcador: efectivo ? efectivo.texto : '',
      nota: efectivo ? `${crudo.trim()} = ${efectivo.texto}` : `variable ${crudo.trim()}`,
      variable: true,
    };
  }
  if (crudo !== null) return { marcador: '', nota: '', variable: false };
  if (!efectivo) return { marcador: '', nota: '', variable: false };

  // Si el origen es el propio selector pero el texto no lo declara, viene
  // de un mixin («block-code : @code»), no de la herencia.
  if (efectivo.origen === selector) {
    return { marcador: efectivo.texto, nota: `del mixin: ${efectivo.texto}`, variable: false };
  }

  const comoSeLlama =
    efectivo.origen === 'defaults' ? 'del texto base'
    : efectivo.origen === 'heading-all' ? 'de todos los titulares'
    : efectivo.origen === 'block-all' ? 'de todos los bloques'
    : efectivo.origen === 'list-all' ? 'de todas las listas'
    : `de «${efectivo.origen}»`;
  return {
    marcador: efectivo.texto,
    nota: `hereda ${comoSeLlama}: ${efectivo.texto}`,
    variable: false,
  };
}

module.exports.cadenaHerencia = cadenaHerencia;
module.exports.piezasATexto = piezasATexto;
module.exports.valorEfectivo = valorEfectivo;
module.exports.explicar = explicar;
