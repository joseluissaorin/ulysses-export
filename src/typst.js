'use strict';

/*
 * Emisor Typst: del arbol de markdown + hoja .ulss a un documento Typst
 * =====================================================================
 *
 * El PDF se compone con Typst (compilado a WebAssembly, sin Electron ni
 * diálogo de impresión), y la meta es que salga IDENTICO al que producía
 * Chromium imprimiendo el HTML del plugin. Para eso no basta con traducir
 * la hoja: hay que reproducir el modelo de caja de Chromium, que tiene
 * sus manías. Todas se concentran aquí, medidas contra PDFs reales:
 *
 *   · La página se trabaja en píxeles CSS (1pt = 4/3 px) y Chromium la
 *     imprime encogida por un factor constante (S_CHROME) dentro de un
 *     área de contenido cuyo origen y tamaño se redondean a píxel entero.
 *   · Las longitudes viven en LayoutUnit: 1/64 px, truncadas.
 *   · El cuerpo de la fuente se trunca a centésimas de píxel y, para
 *     los avances de los glifos, a 1/64 px (FreeType).
 *   · La altura de línea reparte el sobrante («half-leading») con floor,
 *     y el ascendente/descendente de la fuente se redondean a entero.
 *   · Las líneas base se pintan en píxeles enteros (redondeo).
 *   · El número de página va en una caja de margen con la tipografía del
 *     documento a 16px.
 *
 * La traducción trabaja en dos pasadas cuando se pide exactitud: la
 * primera compone con las medidas fraccionarias de Chromium, se leen las
 * posiciones resultantes y la segunda ajusta cada bloque para que las
 * líneas base caigan en píxel entero, como las pinta Chromium.
 */

const D = require('./docx.js');
const MD = require('./markdown.js');
const ULSS = require('./ulss.js');
const E = require('./ensamblado.js');
const METRICAS = require('./metricas.js');

/* ------------------------------------------------------------------ *
 * Constantes de Chromium
 * ------------------------------------------------------------------ */

/** Factor con que Chromium encoge el contenido al imprimir (medido). */
const S_CHROME = 3.1237822 / 3.125;
/** Puntos PDF por píxel CSS dentro del área de contenido. */
const PX = 0.75 * S_CHROME;
/** Puntos PDF por píxel CSS fuera del contenido (cajas de margen). */
const PX_PAGINA = 0.75;

const r3 = (v) => Math.round((v || 0) * 1000) / 1000; // lo que hace «pt()» del CSS
const lu = (px) => Math.trunc(px * 64 + (px >= 0 ? 1e-7 : -1e-7)) / 64; // LayoutUnit
const ptApx = (pt) => r3(pt) * (4 / 3);
const redondear = (v) => Math.floor(v + 0.5); // SkScalarRoundToScalar
const fmt = (v) => String(Math.round(v * 1e5) / 1e5);
const ptTypst = (px) => `${fmt(px * PX)}pt`;

/* ------------------------------------------------------------------ *
 * Geometria de pagina
 * ------------------------------------------------------------------ */

function geometria(pagina) {
  // Skia trabaja a 300 ppp y trunca el tamaño de página a unidades enteras.
  const dispositivo = (pt) => Math.floor(pt * 300 / 72 + 1e-6) * 72 / 300;
  const anchoPt = dispositivo(pagina.ancho);
  const altoPt = dispositivo(pagina.alto);

  const mlPx = ptApx(pagina.interior);
  const mrPx = ptApx(pagina.exterior);
  const mtPx = ptApx(pagina.superior);
  const mbPx = ptApx(pagina.inferior);
  const pagPxW = pagina.ancho * (4 / 3);
  const pagPxH = pagina.alto * (4 / 3);

  // Bloque contenedor inicial: página entera menos márgenes, en enteros.
  const anchoCont = Math.floor(pagPxW + 1e-6) - Math.floor(mlPx + 1e-6) - Math.floor(mrPx + 1e-6);
  const altoCont = Math.floor(pagPxH + 1e-6) - Math.floor(mtPx + 1e-6) - Math.floor(mbPx + 1e-6);
  // Origen del contenido en la página (medido: izquierda ceil, arriba round).
  const ox = Math.ceil(mlPx - 1e-6);
  const oy = Math.round(mtPx);

  const izquierda = ox * PX_PAGINA;
  const superior = oy * PX_PAGINA;
  const derecha = anchoPt - izquierda - anchoCont * PX;
  const inferior = altoPt - superior - altoCont * PX;

  const columnas = Math.max(1, pagina.columnas || 1);
  // Ancho de cada columna, como lo calcula CSS: (ancho - huecos) / n
  const huecoPx = lu(ptApx(pagina.separacionColumnas || 0));
  const anchoColumna = columnas > 1 ? lu((anchoCont - huecoPx * (columnas - 1)) / columnas) : anchoCont;

  return {
    anchoPt, altoPt, anchoCont, altoCont, ox, oy, columnas, huecoPx, anchoColumna,
    margenes: { izquierda, superior, derecha, inferior },
    mlPx, mrPx, mtPx, mbPx, pagPxW, pagPxH,
    // Altura de página tal como la ve la caja de margen (sin factor S)
    altoPaginaPx: altoPt / PX_PAGINA,
  };
}

/* ------------------------------------------------------------------ *
 * Tipografia: caras y metricas como las ve Blink
 * ------------------------------------------------------------------ */

/** Familias genéricas de CSS → lo que fontconfig suele dar en cada sistema. */
const GENERICAS = {
  serif: ['Times New Roman', 'Liberation Serif', 'DejaVu Serif', 'Nimbus Roman', 'Tinos', 'Noto Serif', 'Georgia'],
  'sans-serif': ['Arial', 'Helvetica', 'Liberation Sans', 'DejaVu Sans', 'Nimbus Sans', 'Arimo', 'Noto Sans'],
  monospace: ['Courier New', 'Liberation Mono', 'DejaVu Sans Mono', 'Nimbus Mono PS', 'Cousine', 'Noto Sans Mono'],
};

/** Separa una pila CSS («"Avenir Next", Avenir, serif») en nombres. */
function familiasDePila(pila) {
  return String(pila || '')
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/**
 * Elige la familia instalada que usaría Chromium para una pila CSS: la
 * primera de la lista que exista; si ninguna, la genérica del final.
 */
function resolverFamilia(catalogo, pila) {
  const familias = familiasDePila(pila);
  const generica = (nombre) => {
    for (const g of GENERICAS[nombre]) if (catalogo.tieneFamilia(g)) return g;
    return null;
  };
  for (const f of familias) {
    const n = f.toLowerCase();
    if (GENERICAS[n]) {
      const g = generica(n);
      if (g) return g;
      continue;
    }
    if (catalogo.tieneFamilia(f)) return f;
    // Como fontconfig: una familia conocida pero no instalada se
    // sustituye por su genérica sensata AQUÍ, antes de seguir la pila.
    const alias =
      /courier|mono|consol|menlo|monaco/.test(n) ? 'monospace' :
      /helvetica|arial|verdana|tahoma|geneva|avenir|futura|gill|optima|segoe|myriad/.test(n) ? 'sans-serif' :
      null;
    if (alias) {
      const g = generica(alias);
      if (g) return g;
    }
  }
  const g = generica('serif');
  if (g) return g;
  // Sin nada instalado: lo primero que haya
  const todas = catalogo.familias();
  return todas.length ? todas[0] : familias[0] || 'serif';
}

/**
 * Métricas de una cara a un cuerpo dado, redondeadas como hace Blink
 * (SimpleFontData::PlatformInit en Linux/Windows: ascent y descent a
 * entero con redondeo).
 */
function metricasBlink(cara, tamanoPx) {
  if (!cara) {
    // Sin fuente conocida: proporciones de una serif corriente
    return { asc: redondear(0.891 * tamanoPx), desc: redondear(0.216 * tamanoPx), hueco: 0 };
  }
  const asc = redondear((cara.ascendente / cara.upm) * tamanoPx);
  const desc = redondear((cara.descendente / cara.upm) * tamanoPx);
  const hueco = redondear((cara.huecoLinea / cara.upm) * tamanoPx);
  return { asc, desc, hueco };
}

/** Cuerpo en px como lo guarda la caché de fuentes de Blink: centésimas truncadas. */
function cuerpoPx(pt) {
  return Math.floor(ptApx(pt) * 100 + 1e-6) / 100;
}

/** Cuerpo con el que FreeType escala los avances: 1/64 px truncado. */
function cuerpoFreeType(px) {
  return Math.floor(px * 64 + 1e-6) / 64;
}

/**
 * Caja de línea de Blink para una fuente dentro de una línea de altura
 * «lh» (LayoutUnit): reparte la mitad del sobrante arriba con floor.
 */
function cajaLinea(metricas, lhLu) {
  const texto = metricas.asc + metricas.desc;
  const crudo = Math.round((lhLu - texto) * 64); // en 1/64
  const mitad = Math.trunc(crudo / 2); // division entera de LayoutUnit
  const mitadFloor = Math.floor(mitad / 64); // LayoutUnit::Floor()
  const ascL = metricas.asc + mitadFloor;
  return { ascL, descL: lhLu - ascL };
}

/* ------------------------------------------------------------------ *
 * Estilo computado (imitando la cascada del CSS de construirCss)
 * ------------------------------------------------------------------ */

/**
 * Lo que «reglasDe» declara para una cadena de selectores. Se devuelve
 * solo lo declarado (null = no se declara), para poder heredar igual que
 * el navegador.
 */
function declaracionesDe(hoja, selectores, base) {
  const a = D.atributos(hoja, selectores, Object.assign({}, base));
  const d = {};
  if (a.familia && a.familia !== base.familia) d.familia = E.pilaTipografica(a.familia);
  if (a.tamano !== null && a.tamano !== undefined) d.tamano = a.tamano;
  if (a.interlineado !== null && a.interlineado !== undefined) d.interlineado = a.interlineado;
  if (a.negrita !== null) d.negrita = !!a.negrita;
  if (a.cursiva !== null) d.cursiva = !!a.cursiva;
  if (a.alineacion) d.alineacion = a.alineacion === 'both' ? 'justify' : a.alineacion;
  d.pt = a.margenSuperior || 0;
  d.pb = a.margenInferior || 0;
  if (a.margenIzquierdo) d.ml = a.margenIzquierdo;
  if (a.margenDerecho) d.mr = a.margenDerecho;
  if (a.sangriaPrimera !== null && a.sangriaPrimera !== undefined) d.sangria = a.sangriaPrimera;
  if (a.saltoPagina === 'before') d.saltoAntes = true;
  if (a.saltoPagina === 'after') d.saltoDespues = true;
  if (a.mantenerJunto) d.mantener = true;
  if (a.color) d.color = a.color;
  return d;
}

const HEREDABLES = ['familia', 'tamano', 'interlineado', 'negrita', 'cursiva', 'alineacion', 'color', 'sangria'];

/** Aplica una lista de declaraciones sobre el estilo heredado del padre. */
function computar(padre, ...listas) {
  const c = {};
  for (const k of HEREDABLES) c[k] = padre[k];
  c.pt = 0; c.pb = 0; c.ml = 0; c.mr = 0;
  c.saltoAntes = false; c.saltoDespues = false; c.mantener = false;
  for (const d of listas) {
    if (!d) continue;
    for (const [k, v] of Object.entries(d)) if (v !== undefined && v !== null) c[k] = v;
  }
  return c;
}

/* ------------------------------------------------------------------ *
 * Cadenas de Typst
 * ------------------------------------------------------------------ */

function cadena(texto) {
  return '"' + String(texto).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** Colapsa blancos como hace HTML con «white-space: normal». */
function colapsar(texto) {
  return String(texto).replace(/[ \t\n\r\f]+/g, ' ');
}

/* ------------------------------------------------------------------ *
 * Documento
 * ------------------------------------------------------------------ */

/**
 * Construye el documento Typst.
 *
 * @param documento  arbol de markdown
 * @param hoja       hoja .ulss cargada
 * @param opciones   las de opcionesComunes, mas:
 *                     catalogo: CatalogoFuentes con las caras disponibles
 *                     ajuste:   resultado de la primera pasada (opcional)
 * @returns {{fuente: string, recursos: Object, bloques: Array}}
 */
function construirTypst(documento, hoja, opciones) {
  const opc = opciones || {};
  const catalogo = opc.catalogo;
  const pagina = E.ajustesPagina(hoja, opc.tamanoPagina);
  const geo = geometria(pagina);
  const base = D.atributosBase(hoja);
  const guionado = hoja.bandera('defaults', 'hyphenation', false);

  const recursos = {};
  const avisos = [];

  /* --- estilo raíz: «.ulysses» --- */
  const raiz = {
    familia: E.pilaTipografica(base.familia) || 'serif',
    tamano: base.tamano,
    interlineado: base.interlineado || null,
    negrita: false,
    cursiva: false,
    alineacion: base.alineacion === 'both' ? 'justify' : base.alineacion || 'left',
    color: '#000000',
    sangria: 0,
  };

  /* --- resolución de fuentes --- */
  const cacheFamilias = new Map();
  const familiaReal = (pila) => {
    if (!catalogo) return familiasDePila(pila)[0] || 'serif';
    if (!cacheFamilias.has(pila)) {
      const f = resolverFamilia(catalogo, pila);
      cacheFamilias.set(pila, f);
      if (f.toLowerCase() !== familiasDePila(pila)[0].toLowerCase()) {
        avisos.push(`«${familiasDePila(pila)[0]}» no está instalada: se usa «${f}».`);
      }
    }
    return cacheFamilias.get(pila);
  };
  const cara = (pila, negrita, cursiva) =>
    catalogo ? catalogo.buscar(familiaReal(pila), negrita ? 700 : 400, cursiva) : null;

  /**
   * Fuente de un tramo: cuerpo en px (Blink), cuerpo de avances (FreeType),
   * métricas enteras y el nombre de familia para Typst.
   */
  function fuenteDe(estilo) {
    const px = cuerpoPx(estilo.tamano);
    const c = cara(estilo.familia, estilo.negrita, estilo.cursiva);
    return {
      familia: familiaReal(estilo.familia),
      px,
      pxAvances: cuerpoFreeType(px),
      metricas: metricasBlink(c, px),
      negrita: !!estilo.negrita,
      cursiva: !!estilo.cursiva,
    };
  }

  /** Altura de línea en LayoutUnit de un estilo (o «normal»). */
  function alturaLinea(estilo, fuente) {
    if (estilo.interlineado) return lu(ptApx(estilo.interlineado));
    const m = fuente.metricas;
    return m.asc + m.desc + m.hueco;
  }

  /* --- texto en línea --- */

  /**
   * Convierte nodos inline en una expresión de contenido de Typst y,
   * de paso, recoge los tramos tipográficos para calcular la caja de
   * línea (ascendente/descendente máximos).
   */
  function inline(nodos, estilo, ctx) {
    const partes = [];
    const tramos = ctx.tramos;

    /**
     * «overflow-wrap: break-word»: si un tramo sin puntos de corte es más
     * ancho que el hueco, Chromium lo parte en el último carácter que
     * cabe. Con el partido voraz de Typst basta sembrar puntos de corte
     * invisibles (U+200B) dentro de esos tramos para clavar el resultado.
     */
    const conRoturas = (texto, est) => {
      const disponible = ctx.anchoDisponible || 0;
      if (!disponible) return texto;
      const f = fuenteDe(est);
      const caraMedida = cara(est.familia, est.negrita, est.cursiva);
      const medir = (s) => METRICAS.medirTexto(caraMedida, s, f.pxAvances);
      if (medir(texto) <= disponible) return texto;
      return texto
        .split(' ')
        .map((palabra) => (medir(palabra) > disponible ? palabra.split('').join('\u200b') : palabra))
        .join(' ');
    };

    const emitirTexto = (texto, est, extra) => {
      if (!texto) return;
      texto = conRoturas(texto, est);
      const f = fuenteDe(est);
      const lh = ctx.lh;
      const caja = cajaLinea(f.metricas, lh);
      tramos.push({ ascL: caja.ascL + (extra && extra.elevar ? extra.elevar : 0), descL: caja.descL - (extra && extra.elevar ? extra.elevar : 0) });
      const args = [
        `font: ${cadena(f.familia)}`,
        `size: ${ptTypst(f.pxAvances)}`,
        `weight: ${f.negrita ? '"bold"' : '"regular"'}`,
        `style: ${f.cursiva ? '"italic"' : '"normal"'}`,
        `top-edge: ${ptTypst(caja.ascL)}`,
        `bottom-edge: ${ptTypst(-caja.descL)}`,
      ];
      if (est.color && est.color.toLowerCase() !== '#000000') args.push(`fill: rgb(${cadena(est.color)})`);
      if (extra && extra.elevar) args.push(`baseline: ${ptTypst(-extra.elevar)}`);
      let expr = `text(${args.join(', ')}, ${cadena(texto)})`;
      if (extra && extra.fondo) {
        expr = `highlight(fill: rgb(${cadena(extra.fondo)}), top-edge: ${ptTypst(f.metricas.asc)}, bottom-edge: ${ptTypst(-f.metricas.desc)}, extent: 0pt, ${expr})`;
      }
      if (extra && extra.tachar) expr = `strike(${expr})`;
      if (extra && extra.enlace) expr = `link(${cadena(extra.enlace)}, ${expr})`;
      partes.push(expr);
    };

    const recorrer = (lista, est, extra) => {
      for (const nodo of lista || []) {
        switch (nodo.tipo) {
          case 'texto':
            emitirTexto(colapsar(nodo.valor), est, extra);
            break;
          case 'salto':
            partes.push('linebreak()');
            break;
          case 'strong':
            recorrer(nodo.hijos, Object.assign({}, est, { negrita: true }), extra);
            break;
          case 'em':
            recorrer(nodo.hijos, Object.assign({}, est, { cursiva: true }), extra);
            break;
          case 'del':
            recorrer(nodo.hijos, est, Object.assign({}, extra, { tachar: true }));
            break;
          case 'mark':
            recorrer(nodo.hijos, est, Object.assign({}, extra, { fondo: '#FEFDD5' }));
            break;
          case 'code':
            emitirTexto(nodo.valor, Object.assign({}, est, { familia: ctx.familiaCodigo }), extra);
            break;
          case 'link':
            recorrer(nodo.hijos, est, Object.assign({}, extra, { enlace: nodo.destino }));
            break;
          case 'wikilink':
            emitirTexto(colapsar(nodo.alias || nodo.destino), est, extra);
            break;
          case 'footnote': {
            // <sup><a>n</a></sup>: cuerpo «smaller» (÷1,2) y elevado un
            // tercio del cuerpo del padre; la caja de línea crece si hace falta.
            const padrePx = cuerpoPx(est.tamano);
            const sup = Object.assign({}, est, { tamano: (Math.floor((padrePx / 1.2) * 100 + 1e-6) / 100) * 0.75 });
            const elevar = lu(padrePx / 3);
            emitirTexto(String(nodo.id), sup, Object.assign({}, extra, { elevar }));
            break;
          }
          case 'image': {
            const exp = imagen(nodo.ruta, nodo.alt, ctx);
            if (exp) partes.push(exp);
            break;
          }
          default:
            if (nodo.hijos) recorrer(nodo.hijos, est, extra);
        }
      }
    };

    recorrer(nodos, estilo, null);
    return partes.length ? partes.join(' + ') : 'none';
  }

  /* --- imágenes --- */
  let numImagen = 0;
  function imagen(ruta, alt, ctx) {
    const r = opc.recursos ? opc.recursos(ruta) : null;
    if (!r || !r.datos) return null;
    const nombre = `/imagen${++numImagen}.${r.extension || 'png'}`;
    recursos[nombre] = r.datos;
    // <img> a su tamaño natural (px a 96 ppp), limitado al 100% del ancho.
    let anchoPx = r.ancho ? r.ancho * (4 / 3) : null;
    const disponible = ctx.anchoDisponible;
    if (anchoPx === null || anchoPx > disponible) anchoPx = disponible;
    return `image(${cadena(nombre)}, width: ${ptTypst(anchoPx)})`;
  }

  /* --- bloques --- */
  const salida = [];
  const bloquesInfo = []; // para la segunda pasada
  let indiceBloque = 0;
  const ajuste = opc.ajuste || null; // resultados de la primera pasada

  /** Un tramo de texto suelto con su caja de línea registrada en ctx. */
  function textoPlano(texto, est, ctx) {
    const f = fuenteDe(est);
    const caja = cajaLinea(f.metricas, ctx.lh);
    ctx.tramos.push(caja);
    const args = [
      `font: ${cadena(f.familia)}`,
      `size: ${ptTypst(f.pxAvances)}`,
      `weight: ${f.negrita ? '"bold"' : '"regular"'}`,
      `style: ${f.cursiva ? '"italic"' : '"normal"'}`,
      `top-edge: ${ptTypst(caja.ascL)}`,
      `bottom-edge: ${ptTypst(-caja.descL)}`,
    ];
    if (est.color && est.color.toLowerCase() !== '#000000') args.push(`fill: rgb(${cadena(est.color)})`);
    return `text(${args.join(', ')}, ${cadena(texto)})`;
  }

  /**
   * Emite un bloque de párrafo con la geometría de Chromium.
   *   estilo:    estilo computado (pt/pb/ml/mr/sangria/...)
   *   contenido: nodos inline
   *   extra:     { marcador, colgante, sticky, lineas, preformateado,
   *                indivisible, familiaCodigo, ptExtra, pbExtra }
   *
   * Modelo de relleno vertical (calcado de la fragmentación de Blink):
   *   · padding-top: una caja invisible de ancho cero en la primera
   *     línea, que la hace más alta por arriba. Así viaja con la línea si
   *     el párrafo salta de página y no se repite en la continuación.
   *   · padding-bottom: un bloque vacío de altura fija tras el párrafo.
   *     Si no cabe, Typst lo parte y el resto aparece en la página
   *     siguiente, que es justo lo que hace Blink con el relleno final.
   */
  function parrafo(estilo, nodos, extra) {
    extra = extra || {};
    const f = fuenteDe(estilo);
    const lh = alturaLinea(estilo, f);
    const tramos = [];
    const ml = lu(ptApx(estilo.ml || 0));
    const mr = lu(ptApx(estilo.mr || 0));
    const ctx = {
      lh,
      tramos,
      familiaCodigo: extra.familiaCodigo || familiaCodigoDe(),
      anchoDisponible: geo.anchoColumna - ml - mr,
      fuentePx: f.pxAvances,
    };
    // El «strut» del párrafo siempre cuenta en la caja de línea
    const cajaStrut = cajaLinea(f.metricas, lh);
    tramos.push(cajaStrut);

    const sangriaPx = Math.max(0, lu(ptApx(estilo.sangria || 0)));
    let manual = false;
    let cuerpo;
    if (extra.lineas) {
      cuerpo = extra.lineas.map((l) => inline(l, estilo, ctx)).join(' + linebreak() + ');
    } else if (
      !extra.preformateado &&
      necesitaComposicionManual(nodos, estilo, ctx.anchoDisponible)
    ) {
      manual = true;
      const texto = colapsar(nodos.map((n) => n.valor).join('')).replace(/^ | $/g, '');
      cuerpo = componerManual(texto, estilo, ctx, ctx.anchoDisponible, sangriaPx, !!extra.marcador);
    } else {
      cuerpo = inline(nodos, estilo, ctx);
    }
    if (extra.marcador) {
      // Marca de lista: caja en línea del ancho del colgante, alineada a
      // la línea base (la caja de Typst toma por defecto su borde inferior).
      const estiloM = extra.marcador.estilo || estilo;
      const fm = fuenteDe(estiloM);
      const cajaM = cajaLinea(fm.metricas, lh);
      const anchoParrafo = ctx.anchoDisponible;
      ctx.anchoDisponible = extra.colgante; // la marca vive en su propia caja
      const marca = inline([{ tipo: 'texto', valor: extra.marcador.texto }], estiloM, ctx);
      ctx.anchoDisponible = anchoParrafo;
      // Si la marca no cabe en su caja se parte en varias líneas (Chromium
      // hace lo mismo con «overflow-wrap»): la caja crece hacia arriba y
      // con ella la primera línea del párrafo.
      const caraM = cara(estiloM.familia, estiloM.negrita, estiloM.cursiva);
      const lineasMarca = lineasEnCaja(caraM, extra.marcador.texto, fm.pxAvances, extra.colgante);
      if (lineasMarca > 1) {
        tramos.push({ ascL: lineasMarca * lh - cajaM.descL, descL: cajaM.descL });
      }
      cuerpo = `box(width: ${ptTypst(extra.colgante)}, baseline: ${ptTypst(cajaM.descL)}, ${marca}) + ${cuerpo}`;
    }

    const ascL = Math.max(...tramos.map((t) => t.ascL));
    const descL = Math.max(...tramos.map((t) => t.descL));
    const lhReal = ascL + descL;

    const pt = lu(ptApx(estilo.pt || 0)) + (extra.ptExtra || 0);
    const pb = lu(ptApx(estilo.pb || 0)) + (extra.pbExtra || 0);
    const sangria = lu(ptApx(estilo.sangria || 0));

    let insetIzq = ml;
    let primera = 0;
    let colgante = 0;
    if (extra.colgante) {
      colgante = extra.colgante;
      insetIzq = ml - colgante;
    } else if (sangria < 0) {
      colgante = -sangria;
      insetIzq = ml - colgante;
    } else {
      primera = sangria;
    }

    const k = indiceBloque++;
    const info = { k, pt, pb, ascL, descL, lh: lhReal, sticky: !!extra.sticky };
    bloquesInfo.push(info);

    // Segunda pasada: corrección del relleno para clavar la línea base en
    // píxel entero. Un delta negativo que el relleno superior no absorbe
    // se resta del relleno inferior del bloque anterior.
    let ptFinal = pt;
    let pbFinal = pb;
    let saltoForzado = '';
    if (ajuste && ajuste[k]) {
      ptFinal = pt + (ajuste[k].ptExtra || 0) + (ajuste[k].deltaPt || 0);
      if (ajuste[k].pb !== undefined) pbFinal = ajuste[k].pb;
      if (ajuste[k].saltoAntes) saltoForzado = '#pagebreak(weak: true)\n';
    }

    const alineacion = { justify: 'left', left: 'left', right: 'right', center: 'center' }[estilo.alineacion] || 'left';
    const justificar = estilo.alineacion === 'justify' && !extra.preformateado && !manual;

    const setPar = [
      `justify: ${justificar}`,
      `first-line-indent: (amount: ${ptTypst(primera)}, all: true)`,
      `hanging-indent: ${ptTypst(colgante)}`,
      'leading: 0pt',
      'spacing: 0pt',
      'linebreaks: "simple"',
    ];

    const posicion = (q) =>
      `[#context [#metadata((b: ${k}, q: "${q}", p: here().page(), y: here().position().y))<ul-b>]]`;

    // Caja invisible que aporta el relleno superior a la primera línea
    const cajaRelleno =
      ptFinal > 0
        ? `box(width: 0pt, height: ${ptTypst(lhReal + ptFinal)}, baseline: ${ptTypst(descL)}) + `
        : '';
    const relleno = pbFinal > 0 ? `#block(width: 100%, height: ${ptTypst(pbFinal)}, breakable: true)` : '';

    salida.push(
      saltoForzado +
        `#block(width: 100%, above: 0pt, below: 0pt, breakable: ${!extra.indivisible}, sticky: ${!!extra.sticky}, ` +
        `inset: (left: ${ptTypst(insetIzq)}, right: ${ptTypst(mr)}))[` +
        `#set par(${setPar.join(', ')})\n#set align(${alineacion})\n` +
        `#set text(top-edge: ${ptTypst(ascL)}, bottom-edge: ${ptTypst(-descL)})\n` +
        `#par(${cajaRelleno}${posicion('i')} + ${cuerpo} + ${posicion('f')})${relleno}]`
    );
  }

  /** Cuántas líneas ocupa un texto partido a lo bruto en una caja estrecha. */
  function lineasEnCaja(caraTexto, texto, px, ancho) {
    const total = METRICAS.medirTexto(caraTexto, texto, px);
    if (total <= ancho) return 1;
    let lineas = 1;
    let usado = 0;
    for (const ch of texto) {
      const w = METRICAS.medirTexto(caraTexto, ch, px);
      if (usado > 0 && usado + w > ancho) {
        lineas++;
        usado = w;
      } else {
        usado += w;
      }
    }
    return lineas;
  }

  /**
   * Composición manual de un párrafo con tramos más anchos que la caja
   * («overflow-wrap: break-word» de verdad): Chromium solo parte dentro
   * de la palabra cuando esta arranca la línea; si no, la baja entera.
   * Se reproduce ese algoritmo con los avances reales de la fuente y se
   * devuelven las líneas ya cortadas y justificadas a mano.
   *
   * Solo se usa cuando el párrafo es texto plano de un solo estilo; para
   * contenido con estilos anidados se cae a la aproximación con U+200B.
   */
  function componerManual(texto, estilo, ctx, ancho, sangriaPrimera, conMarcador) {
    const f = fuenteDe(estilo);
    const caraTexto = cara(estilo.familia, estilo.negrita, estilo.cursiva);
    const medir = (s) => METRICAS.medirTexto(caraTexto, s, f.pxAvances);
    const espacio = medir(' ');
    const justificar = estilo.alineacion === 'justify';

    const fichas = texto.split(' ').filter((s) => s.length);
    const lineas = [];
    let actual = [];
    let usado = conMarcador ? 0 : sangriaPrimera; // el marcador ya resta su caja
    let anchoLinea = ancho;
    // El marcador cuenta como elemento de la primera línea: tras él hay
    // punto de corte, así que una ficha desbordante baja entera.
    let elementos = conMarcador ? 1 : 0;

    const cerrar = () => {
      lineas.push({ piezas: actual, usado });
      actual = [];
      usado = 0;
      elementos = 0;
    };

    for (let ficha of fichas) {
      while (ficha.length) {
        const w = medir(ficha);
        const sep = actual.length ? espacio : 0;
        if (usado + sep + w <= anchoLinea + 1e-6) {
          actual.push({ texto: ficha, espacioAntes: !!actual.length });
          usado += sep + w;
          elementos++;
          ficha = '';
        } else if (w > anchoLinea + 1e-6) {
          // No cabe ni sola: si la línea ya lleva algo, se baja; después
          // se parte en el último carácter que quepa.
          if (elementos > 0) cerrar();
          let corte = 0;
          let acumulado = 0;
          for (const ch of ficha) {
            const wc = medir(ch);
            if (acumulado + wc > anchoLinea + 1e-6 && corte > 0) break;
            acumulado += wc;
            corte += ch.length;
          }
          actual.push({ texto: ficha.slice(0, corte), espacioAntes: false });
          usado = acumulado;
          elementos++;
          ficha = ficha.slice(corte);
          if (ficha.length) cerrar();
        } else {
          cerrar();
        }
      }
    }
    if (actual.length || usado > 0) lineas.push({ piezas: actual, usado });

    // Marcador solo en la primera línea: si la primera ficha no cupo tras
    // él, la primera línea queda vacía (solo la caja del marcador).
    // Chromium reparte el justificado entre espacios normales Y duros
    // (U+00A0): cada pieza se trocea también por espacios duros para que
    // todos los huecos se estiren por igual.
    const partes = [];
    const espacioDuro = medir('\u00a0');
    lineas.forEach((linea, i) => {
      if (i > 0) partes.push('linebreak()');
      const esUltima = i === lineas.length - 1;
      let huecos = 0;
      const trozos = [];
      for (const pieza of linea.piezas) {
        const subpiezas = pieza.texto.split('\u00a0');
        subpiezas.forEach((sub, j) => {
          trozos.push({ texto: sub, hueco: j > 0 ? 'duro' : pieza.espacioAntes ? 'normal' : null });
        });
      }
      for (const tz of trozos) if (tz.hueco) huecos++;
      const extra = justificar && !esUltima && huecos > 0 ? (anchoLinea - linea.usado) / huecos : 0;
      for (const tz of trozos) {
        if (tz.hueco === 'normal') partes.push(`h(${ptTypst(espacio + extra)})`);
        else if (tz.hueco === 'duro') partes.push(`h(${ptTypst(espacioDuro + extra)})`);
        if (tz.texto) partes.push(textoPlano(tz.texto, estilo, ctx));
      }
    });
    return partes.length ? partes.join(' + ') : 'none';
  }

  /** ¿El párrafo es solo texto sin estilos y con algún tramo desbordante? */
  function necesitaComposicionManual(nodos, estilo, ancho) {
    if (!nodos || !nodos.every((n) => n.tipo === 'texto')) return false;
    const f = fuenteDe(estilo);
    const caraTexto = cara(estilo.familia, estilo.negrita, estilo.cursiva);
    const texto = colapsar(nodos.map((n) => n.valor).join(''));
    return texto
      .split(' ')
      .some((palabra) => METRICAS.medirTexto(caraTexto, palabra, f.pxAvances) > ancho + 1e-6);
  }

  function familiaCodigoDe() {
    const atrs = D.atributos(hoja, ['block-all', 'block-code'], Object.assign({}, base));
    return E.pilaTipografica(atrs.familia) || 'monospace';
  }

  function saltoDePagina() {
    salida.push('#pagebreak(weak: true)');
  }

  /* --- cascada por tipo de bloque (espejo de construirCss) --- */

  const declP = declaracionesDe(hoja, ['paragraph'], base);
  const declPPrimero = hoja.bloque('paragraph :first') ? declaracionesDe(hoja, ['paragraph', 'paragraph :first'], base) : null;
  const declPTrasP = declaracionesDe(hoja, ['paragraph', 'paragraph + paragraph'], base);
  const declPTrasH = hoja.bloque('heading-all + paragraph') ? declaracionesDe(hoja, ['paragraph', 'heading-all + paragraph'], base) : null;
  const declCita = declaracionesDe(hoja, ['paragraph', 'block-all', 'block-quote'], base);
  const declCitaP = hoja.bloque('block-quote paragraph') ? declaracionesDe(hoja, ['block-quote paragraph'], base) : null;
  const declPre = declaracionesDe(hoja, ['paragraph', 'block-all', 'block-code'], base);
  const declFigura = declaracionesDe(hoja, ['paragraph', 'paragraph-figure'], base);
  const declPieFigura = declaracionesDe(hoja, ['paragraph', 'figure-caption'], base);
  const declLi = declaracionesDe(hoja, ['paragraph', 'list-all', 'list-all paragraph'], base);
  const declDivisor = declaracionesDe(hoja, ['paragraph', 'paragraph-divider'], base);
  const declComentario = hoja.bloque('block-comment') ? declaracionesDe(hoja, ['paragraph', 'block-comment'], base) : null;
  const declDialogo = declaracionesDe(hoja, ['paragraph', 'list-all', 'list-unordered'], base);
  const declBiblio = hoja.bloque('paragraph-bibliography')
    ? declaracionesDe(hoja, ['paragraph', 'paragraph-bibliography'], base)
    : { ml: E.SANGRIA_BIBLIOGRAFIA, sangria: -E.SANGRIA_BIBLIOGRAFIA };
  const declH = [1, 2, 3, 4, 5, 6].map((n) => declaracionesDe(hoja, ['heading-all', `heading-${n}`], base));

  const saltoH1 = pagina.saltoSeccion === 'heading-1';
  const unidadTab = E.anchoTabulador(hoja, base, opc);
  const sangriaVersoPt = (opc.sangriaVersoEm === undefined || opc.sangriaVersoEm === null ? 2 : opc.sangriaVersoEm) * (base.tamano || 12);
  const dialogoGeo = E.sangriaDialogo(hoja, base);

  // Divisor según la hoja (idéntico a construirHtml)
  const saltoDiv = hoja.palabra('paragraph-divider', 'page-break', null);
  const visibleDiv = hoja.palabra('paragraph-divider', 'visibility', 'visible') !== 'hidden';
  const piezasDiv = hoja.prop('paragraph-divider', 'content');
  const textoDiv = piezasDiv && piezasDiv.length && piezasDiv[0].tipo === 'cadena' ? piezasDiv[0].valor : null;
  const divisor =
    saltoDiv === 'after' || saltoDiv === 'before'
      ? { tipo: 'salto' }
      : visibleDiv && textoDiv
        ? { tipo: 'texto', texto: textoDiv }
        : visibleDiv
          ? { tipo: 'linea' }
          : { tipo: 'oculto' };

  const comentariosVisibles =
    hoja.palabra('block-comment', 'visibility', 'hidden') === 'visible' || !!opc.incluirComentarios;

  /**
   * Recorre una lista de bloques hermanos (como hijos de un mismo
   * elemento HTML) llevando la cuenta del hermano anterior para «p + p»
   * y «h + p».
   *   padre: estilo computado del contenedor
   *   ctx:   { primerHijoArticulo: bool, enLi: bool, nivelLista }
   */
  function emitirBloques(bloques, padre, ctx) {
    let anterior = null; // etiqueta HTML del hermano anterior
    let primero = true;
    // Márgenes heredados de contenedores (blockquote): se suman a los de
    // cada hijo en vez de envolverlos en un block de Typst, porque dentro
    // de un contenedor no puede haber saltos de página.
    const mlExtra = ctx.mlExtra || 0;
    const mrExtra = ctx.mrExtra || 0;
    const emitir = (est, nodos, extra) => {
      est.ml = (est.ml || 0) + mlExtra;
      est.mr = (est.mr || 0) + mrExtra;
      parrafo(est, nodos, extra);
    };
    for (const b of bloques || []) {
      const esPrimeroDelArticulo = ctx.articulo && primero;
      switch (b.tipo) {
        case 'heading': {
          const est = computar(padre, declH[b.nivel - 1]);
          if (saltoH1 && b.nivel === 1 && !esPrimeroDelArticulo) est.saltoAntes = true;
          if (est.saltoAntes) saltoDePagina();
          emitir(est, b.hijos, { sticky: est.mantener });
          if (est.saltoDespues) saltoDePagina();
          anterior = `h${b.nivel}`;
          break;
        }

        case 'paragraph': {
          const lineas = b.lineas || [{ hijos: b.hijos, tabs: 0, espacios: 0 }];
          const modo = E.modoDeLineas(b, opc);
          const cascada = [declP];
          if (esPrimeroDelArticulo && declPPrimero) cascada.push(declPPrimero);
          else if (anterior === 'p') cascada.push(declPTrasP);
          if (/^h\d$/.test(anterior || '') && declPTrasH) cascada.push(declPTrasH);
          if (ctx.enCita && declCitaP) cascada.push(declCitaP);
          if (b.bibliografia) cascada.push(declBiblio);

          if (E.bloqueEsDialogo(b, opc)) {
            // p.dialogo: geometría de la lista sin numerar
            lineas.forEach((l, k) => {
              const c = [declP];
              if (k === 0) {
                if (esPrimeroDelArticulo && declPPrimero) c.push(declPPrimero);
                else if (anterior === 'p') c.push(declPTrasP);
                if (/^h\d$/.test(anterior || '') && declPTrasH) c.push(declPTrasH);
              } else c.push(declPTrasP);
              c.push(declDialogo);
              const est = computar(padre, ...c);
              est.ml = dialogoGeo.izquierda;
              est.sangria = -dialogoGeo.colgante;
              est.pb = 0;
              if (k > 0) est.pt = 0;
              emitir(est, l.hijos, {});
              anterior = 'p';
            });
            break;
          }

          if (modo === 'verso' && lineas.length > 1) {
            lineas.forEach((l, k) => {
              const c = cascada.slice();
              if (k > 0) {
                // p.verso + p.verso:not(.verso-ini): sin relleno arriba
                c.length = 0;
                c.push(declP, declPTrasP);
                if (ctx.enCita && declCitaP) c.push(declCitaP);
              }
              const est = computar(padre, ...c);
              est.pb = 0;
              if (k > 0) est.pt = 0;
              // padding-left sv + text-indent -sv (sangría francesa del verso)
              const sangriaLinea = E.sangriaDeLinea(l, unidadTab);
              est.ml = (est.ml || 0) + sangriaVersoPt + sangriaLinea;
              est.sangria = -sangriaVersoPt;
              emitir(est, l.hijos, { indivisible: true });
              anterior = 'p';
            });
            break;
          }

          const est = computar(padre, ...cascada);
          const sangriaLinea = E.sangriaDeLinea(lineas[0], unidadTab);
          if (sangriaLinea > 0) {
            est.ml = (est.ml || 0) + sangriaLinea;
            est.sangria = 0;
          }
          if (ctx.enLi) {
            // li > p { margin: 0; padding: 0; text-indent: 0 }
            est.pt = 0; est.pb = 0; est.ml = 0; est.mr = 0; est.sangria = 0;
          }
          emitir(est, b.hijos, {});
          anterior = 'p';
          break;
        }

        case 'blockquote': {
          const est = computar(padre, declCita);
          // La cita no envuelve a sus hijos en un block (dentro no podría
          // haber saltos de página): sus márgenes se suman a los de los
          // hijos y sus rellenos son bloques espaciadores que, si no caben,
          // se parten igual que el relleno de Blink.
          const ptCita = lu(ptApx(est.pt || 0));
          const pbCita = lu(ptApx(est.pb || 0));
          if (ptCita > 0) salida.push(`#block(width: 100%, above: 0pt, below: 0pt, height: ${ptTypst(ptCita)}, breakable: true)`);
          emitirBloques(b.bloques, Object.assign({}, est, { pt: 0, pb: 0, ml: 0, mr: 0 }), {
            enCita: true,
            mlExtra: mlExtra + (est.ml || 0),
            mrExtra: mrExtra + (est.mr || 0),
          });
          if (pbCita > 0) salida.push(`#block(width: 100%, above: 0pt, below: 0pt, height: ${ptTypst(pbCita)}, breakable: true)`);
          anterior = 'blockquote';
          break;
        }

        case 'code': {
          const est = computar(padre, declPre);
          est.familia = familiaCodigoDe();
          // white-space: pre-wrap; tabulador a 8 espacios
          const lineasPre = String(b.texto || '').split('\n').map((l) => [{ tipo: 'texto', valor: l.replace(/\t/g, '        ') || ' ' }]);
          emitir(est, null, { lineas: lineasPre, preformateado: true, familiaCodigo: est.familia });
          anterior = 'pre';
          break;
        }

        case 'divider': {
          if (divisor.tipo === 'salto') {
            saltoDePagina();
            anterior = 'div';
          } else if (divisor.tipo === 'texto') {
            const c = [declP];
            if (anterior === 'p') c.push(declPTrasP);
            c.push(declDivisor);
            const est = computar(padre, ...c);
            est.sangria = 0;
            emitir(est, [{ tipo: 'texto', valor: divisor.texto }], {});
            anterior = 'p';
          } else if (divisor.tipo === 'linea') {
            // <hr>: línea de 0,5pt arriba, con los márgenes por defecto del navegador (0.5em)
            const em = cuerpoPx(padre.tamano);
            salida.push(
              `#block(width: 100%, above: 0pt, below: 0pt, inset: (top: ${ptTypst(lu(em / 2))}, bottom: ${ptTypst(lu(em / 2))}))[` +
                `#line(length: 100%, stroke: ${fmt(0.5 * S_CHROME)}pt + black)]`
            );
            anterior = 'hr';
          }
          break;
        }

        case 'figure': {
          const est = computar(padre, declFigura);
          const f = fuenteDe(est);
          const ctxImg = { anchoDisponible: geo.anchoColumna - lu(ptApx(est.ml || 0)) - lu(ptApx(est.mr || 0)) };
          const exp = imagen(b.ruta, b.alt, ctxImg);
          if (exp) {
            // <figure> con la imagen en línea dentro de una línea de texto: la
            // imagen se apoya en la línea base; aquí se simplifica apoyándola
            // en el fondo de la caja.
            emitir(est, [{ tipo: 'image', ruta: b.ruta, alt: b.alt }], {});
          }
          if (b.alt) {
            const estPie = computar(est, declPieFigura);
            emitir(estPie, [{ tipo: 'texto', valor: b.alt }], {});
          }
          anterior = 'figure';
          break;
        }

        case 'list':
          emitirLista(b, padre, 0, mlExtra);
          anterior = b.ordenada ? 'ol' : 'ul';
          break;

        case 'table':
          emitirTabla(b, padre);
          anterior = 'table';
          break;

        case 'comment':
          if (comentariosVisibles && declComentario) {
            const c = [declP];
            if (anterior === 'p') c.push(declPTrasP);
            c.push(declComentario);
            const est = computar(padre, ...c);
            emitir(est, [{ tipo: 'texto', valor: b.texto }], {});
            anterior = 'p';
          }
          break;

        default:
          break;
      }
      primero = false;
    }
  }

  /** Listas: marca en una caja en línea y sangría francesa, como el CSS. */
  function emitirLista(lista, padre, nivel, mlExtra) {
    mlExtra = mlExtra || 0;
    const ordenada = !!lista.ordenada;
    const { izquierda, colgante } = E.sangriaNivel(hoja, base, ordenada, nivel);
    const formato = E.formatoNivel(hoja, ordenada, nivel);
    // «.ulysses li { margin-left }» se acumula en cada nivel de anidado
    const liMl = declLi.ml || 0;
    let contador = 0;
    let anteriorLi = null;
    lista.items.forEach((item) => {
      contador++;
      pilaContadores[nivel] = contador; // para los «%*» de niveles anidados
      const bloquesItem = item.bloques || [];
      const marcaTexto = ordenada ? marcadorOrdenado(formato, nivel, contador) : String(formato);
      let primerParrafo = true;
      bloquesItem.forEach((sub) => {
        if (sub.tipo === 'paragraph' && primerParrafo) {
          const c = [declLi];
          const est = computar(padre, ...c);
          est.ml = (nivel + 1) * liMl + izquierda + mlExtra;
          est.sangria = 0;
          parrafo(est, sub.hijos, { marcador: { texto: marcaTexto }, colgante: lu(ptApx(colgante)) });
          primerParrafo = false;
        } else if (sub.tipo === 'list') {
          const estLi = computar(padre, declLi);
          emitirLista(sub, Object.assign({}, estLi, { pt: 0, pb: 0 }), Math.min(nivel + 1, 8), mlExtra);
        } else {
          const estLi = computar(padre, declLi);
          estLi.ml = 0;
          emitirBloques([sub], Object.assign({}, estLi, { pt: 0, pb: 0, sangria: 0 }), {
            enLi: true,
            mlExtra: (nivel + 1) * liMl + izquierda + mlExtra,
          });
        }
      });
      anteriorLi = item;
    });
  }

  /** «%1.» con contadores → texto de la marca de este elemento. */
  function marcadorOrdenado(formato, nivel, n) {
    // El contador del propio nivel es «n»; los de los niveles de arriba
    // se leen de la pila (para formatos anidados con «%*»). Cada nivel
    // se escribe con su «enumeration-style».
    return String(formato).replace(/%(\d)/g, (m, d) => {
      const idx = Number(d) - 1;
      const valor = idx === nivel ? n : pilaContadores[idx] || 1;
      return E.formatearNumero(valor, E.estiloNivel(hoja, true, idx));
    });
  }
  const pilaContadores = [];

  /** Tablas: bordes arriba y abajo, celdas con el relleno de la hoja. */
  function emitirTabla(tabla, padre) {
    const anchoBorde = hoja.puntos('table', 'border-top-width', 12, 1);
    const padSup = hoja.puntos('table-cell', 'padding-top', 12, 4);
    const padInf = hoja.puntos('table-cell', 'padding-bottom', 12, 4);
    const columnas = tabla.cabecera.length;
    const f = fuenteDe(padre);
    const lh = alturaLinea(padre, f);
    const caja = cajaLinea(f.metricas, lh);
    const celda = (nodos, negrita, alineacion) => {
      const est = Object.assign({}, padre, { negrita: negrita || padre.negrita });
      const tramos = [];
      const ctx = { lh, tramos, familiaCodigo: familiaCodigoDe(), anchoDisponible: geo.anchoColumna / columnas };
      const c = inline(nodos, est, ctx);
      return `table.cell(align: ${alineacion || 'left'}, [#set text(top-edge: ${ptTypst(caja.ascL)}, bottom-edge: ${ptTypst(-caja.descL)}); #(${c})])`;
    };
    const filas = [];
    filas.push(tabla.cabecera.map((c, i) => celda(c, true, tabla.alineaciones[i])).join(', '));
    for (const fila of tabla.filas) filas.push(fila.map((c, i) => celda(c, false, tabla.alineaciones[i])).join(', '));
    salida.push(
      `#block(width: 100%, above: 0pt, below: 0pt)[#set par(leading: 0pt, spacing: 0pt, justify: false)\n` +
        `#table(columns: ${columnas}, stroke: none, ` +
        `inset: (top: ${ptTypst(lu(ptApx(padSup)))}, bottom: ${ptTypst(lu(ptApx(padInf)))}, left: 0pt, right: ${ptTypst(lu(8))}), ` +
        `table.hline(stroke: ${fmt(anchoBorde * S_CHROME)}pt + black), ${filas.join(', ')}, table.hline(stroke: ${fmt(anchoBorde * S_CHROME)}pt + black))]`
    );
  }

  /* --- notas al pie (como el HTML: lista al final) --- */
  function emitirNotas() {
    const ids = Object.keys(documento.notas || {});
    if (!ids.length) return;
    const tamNota = hoja.puntos('area-footnotes', 'font-size', 12, 9);
    const interNota = hoja.puntos('area-footnotes', 'line-height', tamNota, 12);
    const est = computar(raiz, { tamano: tamNota, interlineado: interNota });
    const em = cuerpoPx(tamNota);
    // .notas { margin-top: 24pt; border-top: 0.5pt; padding-top: 8pt }
    salida.push(
      `#block(width: 100%, above: 0pt, below: 0pt, inset: (top: ${ptTypst(lu(ptApx(24)))}))[#line(length: 100%, stroke: ${fmt(0.5 * S_CHROME)}pt + black)]`
    );
    salida.push(`#v(${ptTypst(lu(ptApx(8)))})`);
    const { izquierda, colgante } = E.sangriaNivel(hoja, base, true, 0);
    const formato = E.formatoNivel(hoja, true, 0);
    const liMl = declLi.ml || 0;
    ids.forEach((id, i) => {
      const e = computar(est, declLi);
      e.ml = liMl + izquierda;
      e.sangria = 0;
      const nodos = (documento.notas[id] || []).concat([{ tipo: 'texto', valor: ' ↩' }]);
      parrafo(e, nodos, { marcador: { texto: marcadorOrdenado(formato, 0, i + 1) }, colgante: lu(ptApx(colgante)) });
    });
  }

  /* --- caja de margen con el número de página --- */
  function piePagina() {
    if (pagina.piePagina !== 'page-number') return 'none';
    const f = fuenteDe(Object.assign({}, raiz, { tamano: 12 })); // 16px
    const m = f.metricas;
    const lhNormal = m.asc + m.desc + m.hueco;
    const mb = geo.mbPx;
    const topLinea = geo.altoPaginaPx - mb + (mb - lhNormal) / 2;
    const baseline = Math.round(topLinea + m.asc);
    const centro = (geo.ox + Math.floor(geo.pagPxW + 1e-6) - Math.floor(geo.mrPx + 1e-6) + 0.5) / 2;
    const derecha = Math.floor(geo.pagPxW + 1e-6) - Math.floor(geo.mrPx + 1e-6) + 0.5;
    const primera = pagina.piePrimeraPagina === 'none' ? 'if here().page() > 1 ' : '';
    const texto =
      `text(font: ${cadena(f.familia)}, size: ${fmt(16 * PX_PAGINA)}pt, top-edge: ${fmt(m.asc * PX_PAGINA)}pt, bottom-edge: ${fmt(-m.desc * PX_PAGINA)}pt, ` +
      `weight: "regular", style: "normal", str(counter(page).get().first()))`;
    const ali = pagina.alineacionPie === 'right' ? 'right' : pagina.alineacionPie === 'left' ? 'left' : 'center';
    let pos;
    if (ali === 'center') {
      pos = `place(top + left, dx: ${fmt(centro * PX_PAGINA)}pt - ancho / 2, dy: ${fmt((baseline - m.asc) * PX_PAGINA)}pt, t)`;
    } else if (ali === 'right') {
      pos = `place(top + left, dx: ${fmt(derecha * PX_PAGINA)}pt - ancho, dy: ${fmt((baseline - m.asc) * PX_PAGINA)}pt, t)`;
    } else {
      pos = `place(top + left, dx: ${fmt(geo.ox * PX_PAGINA)}pt, dy: ${fmt((baseline - m.asc) * PX_PAGINA)}pt, t)`;
    }
    return `context ${primera}{ let t = ${texto}; let ancho = measure(t).width; ${pos} }`;
  }

  /* --- ensamblado --- */
  E.marcarBibliografia(documento.bloques, opc.encabezadosBibliografia);

  const setPagina =
    `#set page(width: ${fmt(geo.anchoPt)}pt, height: ${fmt(geo.altoPt)}pt, ` +
    `margin: (left: ${fmt(geo.margenes.izquierda)}pt, top: ${fmt(geo.margenes.superior)}pt, ` +
    `right: ${fmt(geo.margenes.derecha)}pt, bottom: ${fmt(geo.margenes.inferior)}pt), ` +
    (geo.columnas > 1 ? `columns: ${geo.columnas}, ` : '') +
    `header: none, footer: none, foreground: ${piePagina()})` +
    (geo.columnas > 1 ? `\n#set columns(gutter: ${ptTypst(geo.huecoPx)})` : '');

  const fRaiz = fuenteDe(raiz);
  const cabecera = [
    setPagina,
    `#set text(font: ${cadena(fRaiz.familia)}, size: ${ptTypst(fRaiz.pxAvances)}, lang: ${cadena(opc.idioma || 'es')}, hyphenate: ${guionado}, overhang: false, fallback: true, costs: (hyphenation: 0%))`,
    `#set par(leading: 0pt, spacing: 0pt, justify: ${raiz.alineacion === 'justify'}, linebreaks: "simple")`,
    `#set block(spacing: 0pt)`,
    `#show link: it => it`,
  ];

  emitirBloques(documento.bloques, raiz, { articulo: true });
  emitirNotas();

  return {
    fuente: cabecera.join('\n') + '\n\n' + salida.join('\n') + '\n',
    recursos,
    bloques: bloquesInfo,
    geo,
    avisos,
  };
}

/* ------------------------------------------------------------------ *
 * Segunda pasada: líneas base en píxel entero
 * ------------------------------------------------------------------ */

/**
 * A partir de las posiciones medidas en la primera pasada calcula, para
 * cada bloque, cómo retocar su relleno para que las líneas base caigan
 * donde las pinta Chromium (redondeadas a píxel entero a partir del flujo
 * fraccionario) sin alterar la paginación.
 *
 *   · Dentro de una página los desplazamientos se acumulan, así que cada
 *     bloque corrige solo la diferencia respecto a lo que arrastra.
 *   · Al cambiar de página se fuerza el salto donde lo dio la primera
 *     pasada, se recorta el relleno inferior que no cabía y el resto se
 *     pasa como relleno extra al primer bloque de la página siguiente.
 *   · Si un párrafo se parte entre páginas y, tras redondear, la línea
 *     que no cabía pasaría a caber, se le añade una pizca para que siga
 *     sin caber.
 *
 * @param bloques     bloquesInfo de construirTypst (en orden)
 * @param posiciones  { k: { pagina, yIni, paginaFin, yFin } }, líneas base
 *                    de la primera y última línea, en pt de página
 * @param geo         geometría de construirTypst
 * @returns { k: { deltaPt, pb?, saltoAntes? } }
 */
function calcularAjuste(bloques, posiciones, geo) {
  const Hc = geo.altoCont;
  const ajuste = {};
  const px = (yPt) => (yPt - geo.margenes.superior) / PX;
  let pagina = -1;
  let arrastre = 0; // desplazamiento acumulado en la página actual
  let anterior = null; // { b, p } del bloque previo

  for (const b of bloques) {
    const p = posiciones[b.k];
    if (!p) continue;
    const a = (ajuste[b.k] = ajuste[b.k] || { deltaPt: 0 });
    const bf = px(p.yIni); // línea base fraccionaria de la primera línea (Chromium)

    if (p.pagina !== pagina) {
      // Bloque que abre página
      const continuacion = anterior && anterior.p.paginaFin === p.pagina && anterior.p.pagina < p.pagina;
      arrastre = 0;
      if (anterior && !continuacion && pagina !== -1) {
        // El anterior terminó en la página previa: se fuerza aquí el salto
        // y se recorta su relleno inferior a lo que cabía.
        const ap = anterior.p;
        const fondoAnterior = Math.round(px(ap.yFin)) + anterior.b.descL; // ya redondeado en la 2ª pasada
        const cabe = Math.max(0, Hc - fondoAnterior);
        const derrame = Math.max(0, anterior.b.pb - cabe);
        if (derrame > 0) {
          ajuste[anterior.b.k].pb = cabe;
          // Chromium arranca la página con el resto del relleno: en la
          // primera pasada Typst hizo lo mismo, así que «bf» ya lo incluye.
          // Aquí se aporta explícitamente y se descuenta del desplazamiento.
          const derrameChromium = Math.max(0, anterior.b.pb - Math.max(0, Hc - (px(ap.yFin) + anterior.b.descL)));
          a.ptExtra = derrameChromium;
          arrastre = derrameChromium - derrameChromium; // el relleno extra reproduce el flujo de la 1ª pasada
        }
        a.saltoAntes = true;
      }
      pagina = p.pagina;
    }

    const objetivo = Math.round(bf);
    let delta = objetivo - (bf + arrastre);

    // El relleno superior no puede quedar negativo: lo que falte se quita
    // del relleno inferior del bloque anterior (misma página).
    if (b.pt + (a.ptExtra || 0) + delta < 0) {
      const deficit = -(b.pt + (a.ptExtra || 0) + delta);
      if (anterior && anterior.p.paginaFin === p.pagina) {
        const pbPrevio = ajuste[anterior.b.k].pb !== undefined ? ajuste[anterior.b.k].pb : anterior.b.pb;
        if (pbPrevio >= deficit) {
          ajuste[anterior.b.k].pb = pbPrevio - deficit;
          a.deltaPt = -(b.pt + (a.ptExtra || 0));
        } else {
          a.deltaPt = -(b.pt + (a.ptExtra || 0));
          delta = a.deltaPt; // se pierde precisión: menos de medio píxel
        }
      } else {
        a.deltaPt = -(b.pt + (a.ptExtra || 0));
        delta = a.deltaPt;
      }
    } else {
      a.deltaPt = delta;
    }
    arrastre += delta;

    // Párrafo partido entre páginas: que la línea que no cabía siga sin caber
    if (p.paginaFin > p.pagina && b.lh > 0) {
      const nCaben = Math.floor((Hc - b.descL - bf) / b.lh + 1e-6) + 1;
      const bfSiguiente = bf + nCaben * b.lh;
      if (bfSiguiente + b.descL > Hc && Math.round(bfSiguiente) + b.descL <= Hc + 1e-6) {
        a.deltaPt += 0.02;
      }
    }

    anterior = { b, p };
  }
  return ajuste;
}

module.exports = {
  construirTypst,
  calcularAjuste,
  geometria,
  metricasBlink,
  cajaLinea,
  cuerpoPx,
  cuerpoFreeType,
  resolverFamilia,
  familiasDePila,
  S_CHROME,
  PX,
  lu,
};
