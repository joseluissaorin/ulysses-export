'use strict';

/*
 * Emisor DOCX (OOXML) desde el arbol de markdown + una hoja .ulss
 * ==============================================================
 *
 * Aqui es donde la fidelidad con Ulysses es realmente alcanzable: el
 * modelo de Word y el de .ulss hablan el mismo idioma.
 *
 *   .ulss                     OOXML
 *   -----------------------   ---------------------------------------
 *   page-inset-*  (pt)        w:sectPr/w:pgMar   (twips = pt * 20)
 *   font-size     (pt)        w:sz               (medios puntos = pt*2)
 *   line-height   (pt)        w:spacing w:line + w:lineRule="exact"
 *   margin-top/bottom         w:spacing w:before / w:after
 *   first-line-indent         w:ind w:firstLine
 *   margin-left/right         w:ind w:left / w:right
 *   text-alignment            w:jc  (justified -> both)
 *   font-weight: bold         w:b
 *   font-slant: italic        w:i
 *   page-break: before        w:pageBreakBefore
 *   keep-with-following       w:keepNext
 *   hyphenation               w:settings/w:autoHyphenation
 *   column-count              w:cols w:num
 *
 * Ulysses usa interlineado absoluto, por eso lineRule="exact": es lo que
 * reproduce su composicion, no "auto".
 */

const PT_A_TWIP = 20;
const PT_A_MEDIOPUNTO = 2;
const PT_A_EMU = 12700;

/* ------------------------------------------------------------------ *
 * ZIP (solo almacenado, sin compresion: Word lo acepta igual)
 * ------------------------------------------------------------------ */

const TABLA_CRC = (() => {
  const tabla = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c;
  }
  return tabla;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function textoABytes(texto) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(texto);
  return Uint8Array.from(Buffer.from(texto, 'utf8'));
}

class Zip {
  constructor() {
    this.entradas = [];
  }

  anadir(nombre, contenido) {
    const datos = typeof contenido === 'string' ? textoABytes(contenido) : new Uint8Array(contenido);
    this.entradas.push({ nombre, datos, crc: crc32(datos) });
  }

  generar() {
    const trozos = [];
    const central = [];
    let desplazamiento = 0;

    for (const e of this.entradas) {
      const nombre = textoABytes(e.nombre);
      const local = new Uint8Array(30 + nombre.length);
      const v = new DataView(local.buffer);
      v.setUint32(0, 0x04034b50, true); // firma
      v.setUint16(4, 20, true); // version
      v.setUint16(6, 0, true); // banderas
      v.setUint16(8, 0, true); // metodo: almacenado
      v.setUint16(10, 0, true); // hora
      v.setUint16(12, 0x21, true); // fecha (1980-01-01)
      v.setUint32(14, e.crc, true);
      v.setUint32(18, e.datos.length, true);
      v.setUint32(22, e.datos.length, true);
      v.setUint16(26, nombre.length, true);
      v.setUint16(28, 0, true);
      local.set(nombre, 30);

      trozos.push(local, e.datos);

      const cab = new Uint8Array(46 + nombre.length);
      const w = new DataView(cab.buffer);
      w.setUint32(0, 0x02014b50, true);
      w.setUint16(4, 20, true);
      w.setUint16(6, 20, true);
      w.setUint16(8, 0, true);
      w.setUint16(10, 0, true);
      w.setUint16(12, 0, true);
      w.setUint16(14, 0x21, true);
      w.setUint32(16, e.crc, true);
      w.setUint32(20, e.datos.length, true);
      w.setUint32(24, e.datos.length, true);
      w.setUint16(28, nombre.length, true);
      w.setUint16(30, 0, true);
      w.setUint16(32, 0, true);
      w.setUint16(34, 0, true);
      w.setUint16(36, 0, true);
      w.setUint32(38, 0, true);
      w.setUint32(42, desplazamiento, true);
      cab.set(nombre, 46);
      central.push(cab);

      desplazamiento += local.length + e.datos.length;
    }

    const inicioCentral = desplazamiento;
    let tamCentral = 0;
    for (const c of central) tamCentral += c.length;

    const fin = new Uint8Array(22);
    const f = new DataView(fin.buffer);
    f.setUint32(0, 0x06054b50, true);
    f.setUint16(8, central.length, true);
    f.setUint16(10, central.length, true);
    f.setUint32(12, tamCentral, true);
    f.setUint32(16, inicioCentral, true);

    let total = 0;
    for (const t of trozos) total += t.length;
    total += tamCentral + fin.length;

    const salida = new Uint8Array(total);
    let pos = 0;
    for (const t of trozos) {
      salida.set(t, pos);
      pos += t.length;
    }
    for (const c of central) {
      salida.set(c, pos);
      pos += c.length;
    }
    salida.set(fin, pos);
    return salida;
  }
}

/* ------------------------------------------------------------------ *
 * Utilidades XML
 * ------------------------------------------------------------------ */

function esc(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/*
 * Ulysses trunca al convertir a twips, no redondea. Medido contra sus
 * exportaciones: 10mm -> 566 (no 567), 12,5mm -> 708 (no 709),
 * 30mm -> 1700 (no 1701), 25mm -> 1417. El redondeo acertaba 3 de 7
 * casos; el truncado, 6. El epsilon evita que un 21,6 exacto que en
 * binario es 21,599999... caiga a 431 en vez de 432.
 */
/*
 * OOXML exige un orden estricto dentro de <w:pPr> y <w:rPr>. Word es
 * indulgente y se lo traga desordenado, pero LibreOffice —y el resto de
 * suites que validan el esquema— descartan en silencio lo que llega
 * fuera de sitio: por eso se perdian la sangria y el justificado.
 *
 * Estas son las secuencias del esquema (CT_PPrBase y CT_RPr).
 */
const ORDEN_PPR = [
  'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl',
  'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens',
  'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE',
  'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind',
  'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection',
  'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr',
];

const ORDEN_RPR = [
  'rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike',
  'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid',
  'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz',
  'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign',
  'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath',
];

/** Ordena una lista de elementos XML segun la secuencia del esquema. */
function ordenar(elementos, orden) {
  const indice = (x) => {
    const m = /^<w:([a-zA-Z]+)/.exec(x);
    const i = m ? orden.indexOf(m[1]) : -1;
    return i === -1 ? orden.length : i;
  };
  return elementos
    .map((x, i) => ({ x, i, k: indice(x) }))
    .sort((a, b) => (a.k - b.k) || (a.i - b.i))
    .map((e) => e.x);
}

const twips = (pt) => {
  const v = Math.round((pt || 0) * PT_A_TWIP * 1e6) / 1e6;
  return v < 0 ? -Math.floor(-v + 1e-6) : Math.floor(v + 1e-6);
};
const medioPunto = (pt) => Math.round((pt || 0) * PT_A_MEDIOPUNTO);

/* ------------------------------------------------------------------ *
 * Lectura de la hoja: bloque -> atributos de parrafo y de texto
 * ------------------------------------------------------------------ */

// Ulysses no aplica formato directo al texto: define estilos de caracter
// en styles.xml y los referencia con <w:rStyle>. Estos son sus nombres.
const ESTILOS_INLINE = {
  strong: { nombre: 'Fuerte', selector: 'inline-strong', porDefecto: { negrita: true } },
  em: { nombre: 'Énfasis', selector: 'inline-emphasis', porDefecto: { cursiva: true } },
  del: { nombre: 'Borrar', selector: 'inline-delete', porDefecto: { tachado: true } },
  mark: { nombre: 'Resaltado', selector: 'inline-mark', porDefecto: { fondo: '#FEFDD5' } },
  code: { nombre: 'Código', selector: 'inline-code', porDefecto: {} },
  link: { nombre: 'Enlace', selector: 'inline-link', porDefecto: {} },
  footnote: { nombre: 'Nota al pie', selector: 'inline-footnote', porDefecto: {} },
  citation: { nombre: 'Cita', selector: 'inline-citation', porDefecto: {} },
};

const ALINEACION = {
  justified: 'both',
  justify: 'both',
  left: 'left',
  right: 'right',
  center: 'center',
  centered: 'center',
  natural: 'left',
};

/**
 * Reune los atributos de un selector, cayendo hacia atras en los
 * selectores mas genericos que Ulysses define (heading-all, defaults).
 */
function atributos(hoja, selectores, base) {
  const r = Object.assign(
    {
      familia: null,
      tamano: null,
      interlineado: null,
      alineacion: null,
      negrita: null,
      cursiva: null,
      margenSuperior: null,
      margenInferior: null,
      margenIzquierdo: null,
      margenDerecho: null,
      sangriaPrimera: null,
      saltoPagina: null,
      mantenerJunto: null,
      color: null,
      subrayado: null,
      tachado: null,
      fondo: null,
      viudas: null,
      visible: null,
      textInset: null,
    },
    base || {}
  );

  const presentes = selectores.filter((sel) => hoja.bloque(sel));

  // --- Pasada 1: todo lo que no depende de una longitud relativa -------
  // El cuerpo tiene que quedar fijado ANTES de resolver los «em», porque
  // en Ulysses un em se mide sobre el cuerpo del propio elemento. Si se
  // resolviera al vuelo, «block-code» heredaria el margen de «block-all»
  // calculado sobre 12pt en vez de sobre sus 11pt.
  for (const sel of presentes) {
    const fam = hoja.familia(sel, null);
    if (fam) r.familia = fam;

    const tam = hoja.puntos(sel, 'font-size', r.tamano || 12, null);
    if (tam !== null) r.tamano = tam;

    const ali = hoja.palabra(sel, 'text-alignment', null);
    if (ali) r.alineacion = ALINEACION[ali] || 'left';

    const peso = hoja.palabra(sel, 'font-weight', null);
    if (peso) r.negrita = peso === 'bold' || peso === 'semibold' || peso === 'black';

    const inclinacion = hoja.palabra(sel, 'font-slant', null);
    if (inclinacion) r.cursiva = inclinacion === 'italic' || inclinacion === 'oblique';

    const salto = hoja.palabra(sel, 'page-break', null);
    if (salto) r.saltoPagina = salto;

    const junto = hoja.palabra(sel, 'keep-with-following', null);
    if (junto) r.mantenerJunto = junto === 'true' || junto === 'yes';

    // Las hojas de Ulysses declaran «font-color», no «color»: leer solo
    // «color» dejaba sin aplicar todos los colores del estilo.
    const col = hoja.color(sel, 'font-color', null) || hoja.color(sel, 'color', null);
    if (col) r.color = col;

    const fondo = hoja.color(sel, 'background-color', null);
    if (fondo) r.fondo = fondo;

    const sub = hoja.palabra(sel, 'underline', null);
    if (sub) r.subrayado = sub !== 'none';

    const tach = hoja.palabra(sel, 'strikethrough', null);
    if (tach) r.tachado = tach !== 'none';

    const vw = hoja.palabra(sel, 'orphans-and-widows', null);
    if (vw) r.viudas = vw === 'prevented';

    const vis = hoja.palabra(sel, 'visibility', null);
    if (vis) r.visible = vis !== 'hidden';
  }

  // --- Pasada 2: longitudes, ya con el cuerpo definitivo ---------------
  const ctx = r.tamano || 12;
  const LONGITUDES = [
    ['line-height', 'interlineado'],
    ['margin-top', 'margenSuperior'],
    ['margin-bottom', 'margenInferior'],
    ['margin-left', 'margenIzquierdo'],
    ['margin-right', 'margenDerecho'],
    ['first-line-indent', 'sangriaPrimera'],
    ['text-inset', 'textInset'],
  ];
  for (const sel of presentes) {
    for (const [propiedad, campo] of LONGITUDES) {
      const v = hoja.puntos(sel, propiedad, ctx, null);
      if (v !== null) r[campo] = v;
    }
  }

  return r;
}

/** Atributos por defecto del documento. */
function atributosBase(hoja) {
  const a = atributos(hoja, ['defaults'], { tamano: 12, interlineado: null, alineacion: 'left' });
  if (!a.familia) a.familia = 'Times New Roman';
  if (!a.tamano) a.tamano = 12;
  return a;
}

/* ------------------------------------------------------------------ *
 * Generacion de parrafos
 * ------------------------------------------------------------------ */

function propiedadesParrafo(a, base, extra) {
  const p = [];

  // El estilo de parrafo va primero; en linea solo lo que varia por
  // instancia (margenes, sangria, numeracion, salto de pagina).
  if (extra && extra.pStyle) p.push(`<w:pStyle w:val="${esc(extra.pStyle)}"/>`);

  if (a.saltoPagina === 'before') p.push('<w:pageBreakBefore/>');
  if (a.viudas === true) p.push('<w:widowControl w:val="true"/>');
  else if (a.viudas === false) p.push('<w:widowControl w:val="false"/>');
  if (extra && extra.numeracion) {
    p.push(
      `<w:numPr><w:ilvl w:val="${extra.numeracion.nivel}"/>` +
        `<w:numId w:val="${extra.numeracion.numId}"/></w:numPr>`
    );
  }
  if (a.mantenerJunto || (extra && extra.keepNext)) p.push('<w:keepNext/>');

  const ind = [];
  if (a.margenIzquierdo) ind.push(`w:left="${twips(a.margenIzquierdo)}"`);
  if (a.margenDerecho) ind.push(`w:right="${twips(a.margenDerecho)}"`);
  // Una sangria de primera linea negativa es sangria francesa: en OOXML
  // no es «firstLine» con signo, sino «hanging» con el valor absoluto.
  if (a.sangriaPrimera > 0) ind.push(`w:firstLine="${twips(a.sangriaPrimera)}"`);
  else if (a.sangriaPrimera < 0) ind.push(`w:hanging="${twips(-a.sangriaPrimera)}"`);
  if (ind.length) p.push(`<w:ind ${ind.join(' ')}/>`);

  const esp = [];
  esp.push(`w:before="${twips(a.margenSuperior || 0)}"`);
  esp.push(`w:after="${twips(a.margenInferior || 0)}"`);
  const inter = a.interlineado || base.interlineado;
  if (inter) {
    esp.push(`w:line="${twips(inter)}"`);
    // Ulysses emite «atLeast», no «exact»: deja crecer la linea si algo
    // no cabe, en vez de recortarlo.
    esp.push('w:lineRule="atLeast"');
  }
  p.push(`<w:spacing ${esp.join(' ')}/>`);

  const ali = a.alineacion || base.alineacion;
  if (ali && ali !== 'left') p.push(`<w:jc w:val="${ali}"/>`);

  // Sin duplicados: «keepNext» puede venir del estilo y del contexto.
  const unicos = ordenar(p, ORDEN_PPR).filter((x, i, a) => a.indexOf(x) === i);
  return unicos.length ? `<w:pPr>${unicos.join('')}</w:pPr>` : '';
}

function propiedadesTexto(a, base, extra) {
  const r = [];

  // El estilo de caracter va primero y sustituye al formato directo:
  // lo que ya lleva el estilo no se repite en la corrida.
  if (extra && extra.rStyle) {
    r.push(`<w:rStyle w:val="${esc(extra.rStyle)}"/>`);
    if (extra.superindice) r.push('<w:vertAlign w:val="superscript"/>');
    return `<w:rPr>${ordenar(r, ORDEN_RPR).join('')}</w:rPr>`;
  }

  const familia = a.familia || base.familia;
  if (familia) {
    const f = esc(familia.split(',')[0].trim());
    r.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>`);
  }
  const negrita = extra && extra.negrita !== undefined ? extra.negrita : a.negrita;
  const cursiva = extra && extra.cursiva !== undefined ? extra.cursiva : a.cursiva;
  if (negrita) r.push('<w:b/>');
  if (cursiva) r.push('<w:i/>');

  const tachado = extra && extra.tachado !== undefined ? extra.tachado : a.tachado;
  if (tachado) r.push('<w:strike/>');

  const subrayado = extra && extra.subrayado !== undefined ? extra.subrayado : a.subrayado;
  if (subrayado) r.push('<w:u w:val="single"/>');

  const fondo = (extra && extra.fondo) || a.fondo;
  if (fondo) {
    r.push(`<w:shd w:val="clear" w:color="auto" w:fill="${esc(String(fondo).replace('#', ''))}"/>`);
  }

  const tam = (extra && extra.tamano) || a.tamano || base.tamano;
  if (tam) r.push(`<w:sz w:val="${medioPunto(tam)}"/><w:szCs w:val="${medioPunto(tam)}"/>`);

  const color = (extra && extra.color) || a.color;
  if (color) r.push(`<w:color w:val="${esc(String(color).replace('#', ''))}"/>`);

  if (extra && extra.superindice) r.push('<w:vertAlign w:val="superscript"/>');

  return r.length ? `<w:rPr>${ordenar(r, ORDEN_RPR).join('')}</w:rPr>` : '';
}

/**
 * Lee un selector «inline-*» de la hoja y lo traduce a los ajustes de
 * texto. Si la hoja no lo define, se usa el comportamiento por defecto.
 * Asi el estilo manda: Universidad, por ejemplo, pone los enlaces en
 * Courier New y subrayados, cosa que no se puede cablear a mano.
 */
function inlineDeHoja(hoja, base, selector, porDefecto) {
  const previo = porDefecto || {};
  if (!hoja.bloque(selector)) return previo;

  const a = atributos(hoja, [selector], { tamano: base.tamano, familia: base.familia });
  const salida = Object.assign({}, previo);

  if (a.negrita !== null) salida.negrita = a.negrita;
  if (a.cursiva !== null) salida.cursiva = a.cursiva;
  if (a.subrayado !== null) salida.subrayado = a.subrayado;
  if (a.tachado !== null) salida.tachado = a.tachado;
  if (a.fondo) salida.fondo = a.fondo;
  if (a.color) salida.color = a.color;
  if (a.visible !== null) salida.visible = a.visible;
  if (a.familia && a.familia !== base.familia) salida.familia = a.familia;
  if (a.tamano && a.tamano !== base.tamano) salida.tamano = a.tamano;

  return salida;
}

/** Une dos juegos de ajustes sin dejar que los vacios pisen a los llenos. */
function unir(a, b) {
  const r = Object.assign({}, a);
  for (const [k, v] of Object.entries(b || {})) {
    if (v !== undefined && v !== null) r[k] = v;
  }
  return r;
}

/**
 * Aplica un estilo inline. El primero que aparece se resuelve como
 * estilo de caracter (rStyle); si van anidados —negrita dentro de
 * cursiva—, el de dentro cae a formato directo, porque OOXML solo
 * admite un rStyle por corrida. Es lo mismo que hace Ulysses.
 */
function aplicarInline(tipo, ctx, h) {
  const def = ESTILOS_INLINE[tipo];
  if (!def) return h;
  const ajustes = inlineDeHoja(ctx.hoja, ctx.base, def.selector, def.porDefecto);
  if (ajustes.visible === false) return null;

  if (!h.rStyle) return unir(h, { rStyle: def.nombre, visible: ajustes.visible });
  const directo = Object.assign({}, ajustes);
  delete directo.visible;
  return unir(h, directo);
}

/** Convierte los nodos inline en <w:r> */
function corridas(nodos, ctx, herencia) {
  const salida = [];
  const h = herencia || {};
  const base = ctx.base;

  for (const nodo of nodos || []) {
    if (!nodo) continue;

    switch (nodo.tipo) {
      case 'texto': {
        if (!nodo.valor) break;
        const rPr = propiedadesTexto(ctx.atributos, base, h);
        salida.push(`<w:r>${rPr}<w:t xml:space="preserve">${esc(nodo.valor)}</w:t></w:r>`);
        break;
      }

      case 'salto':
        salida.push('<w:r><w:br/></w:r>');
        break;

      case 'strong':
      case 'em':
      case 'del':
      case 'mark': {
        const nueva = aplicarInline(nodo.tipo, ctx, h);
        if (nueva) salida.push(...corridas(nodo.hijos, ctx, nueva));
        break;
      }

      case 'code': {
        const nueva = aplicarInline('code', ctx, h);
        if (!nueva) break;
        const familiaCodigo =
          ctx.hoja.familia('inline-code', null) || ctx.hoja.familia('block-code', null) || 'Courier New';
        const atrsLocal = Object.assign({}, ctx.atributos, { familia: familiaCodigo });
        const rPr = propiedadesTexto(atrsLocal, base, nueva);
        salida.push(`<w:r>${rPr}<w:t xml:space="preserve">${esc(nodo.valor)}</w:t></w:r>`);
        break;
      }

      case 'link': {
        const nueva = aplicarInline('link', ctx, h);
        if (!nueva) break;
        const id = ctx.enlace(nodo.destino);
        const dentro = corridas(nodo.hijos, ctx, nueva);
        salida.push(`<w:hyperlink r:id="${id}">${dentro.join('')}</w:hyperlink>`);
        break;
      }

      case 'wikilink': {
        const texto = nodo.alias || nodo.destino;
        const rPr = propiedadesTexto(ctx.atributos, base, h);
        salida.push(`<w:r>${rPr}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r>`);
        break;
      }

      case 'footnote': {
        const num = ctx.notaAlPie(nodo.id);
        if (num === null) break;
        const nueva = unir(aplicarInline('footnote', ctx, h) || h, { superindice: true });
        const rPr = propiedadesTexto(ctx.atributos, base, nueva);
        salida.push(`<w:r>${rPr}<w:footnoteReference w:id="${num}"/></w:r>`);
        break;
      }

      case 'image': {
        const dibujo = ctx.imagen(nodo.ruta, nodo.alt);
        if (dibujo) salida.push(`<w:r>${dibujo}</w:r>`);
        break;
      }

      default:
        if (nodo.hijos) salida.push(...corridas(nodo.hijos, ctx, h));
    }
  }

  return salida;
}

module.exports = {
  Zip,
  crc32,
  esc,
  twips,
  ordenar,
  ORDEN_PPR,
  ORDEN_RPR,
  medioPunto,
  atributos,
  atributosBase,
  propiedadesParrafo,
  propiedadesTexto,
  corridas,
  aplicarInline,
  ESTILOS_INLINE,
  inlineDeHoja,
  unir,
  ALINEACION,
  PT_A_TWIP,
  PT_A_MEDIOPUNTO,
  PT_A_EMU,
};
