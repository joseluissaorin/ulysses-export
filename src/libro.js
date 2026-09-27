'use strict';

/*
 * Composición de libro
 * ====================
 *
 * Una pasada sobre el árbol de bloques, común a los tres emisores, que
 * decide lo que una hoja .ulss no puede expresar y una novela necesita:
 *
 *   · láminas: imágenes con la proporción de la página, que van solas y
 *     a sangre en su propia página, justo donde las puso el autor;
 *   · secciones en verso: dentro de un poema, un verso suelto («Duermes.»)
 *     es un verso y no un párrafo de prosa con su sangría;
 *   · conversaciones: un chat o una obra de teatro («**Nombre** texto»)
 *     se compone como un registro y no como prosa;
 *   · epígrafes: la cita que va justo debajo de un titular;
 *   · la raya de diálogo pegada al parlamento, como pide el DPD.
 *
 * No toca el documento de entrada: devuelve otro con los bloques
 * partidos y marcados, de modo que cada pasada del compositor parte de
 * lo mismo. Las marcas que deja:
 *
 *   {tipo:'lamina', ruta, alt, orientacion, encaje, imagenApaisada, anchoPx, altoPx}
 *   paragraph.continuacion   el trozo de párrafo que sigue a una lámina
 *   paragraph.versoSuelto    párrafo de una línea dentro de un poema
 *   paragraph.chat           {tipo:'turno'|'sistema'|'borrador', inicio, fin}
 *   blockquote.epigrafe
 */

const MD = require('./markdown.js');

// ensamblado.js también usa este módulo: se pide al llamar, cuando los
// dos ya están cargados, para no depender del orden de los require.
const E = () => require('./ensamblado.js');

/** Una lámina tolera un 2 % de diferencia con la proporción de la página. */
const TOLERANCIA_PROPORCION = 0.02;
/** Y necesita al menos 100 ppp a tamaño de página (salvo si es vectorial). */
const PPP_MINIMO = 100;

/* ------------------------------------------------------------------ *
 * Opciones
 * ------------------------------------------------------------------ */

const MODOS_LAMINA = ['girada', 'apaisada', 'no'];

/** Opciones de composición con sus valores por defecto. */
function opcionesLibro(opc) {
  const o = opc || {};
  return {
    // Una lámina apaisada en un libro vertical: girada en su página
    // (imprenta), en una página apaisada (pantalla) o sin lámina.
    laminas: MODOS_LAMINA.includes(o.laminas) ? o.laminas : 'girada',
    epigrafes: o.epigrafes === true,
    conversaciones: o.conversaciones !== false,
    rayaPegada: o.rayaPegada !== false && (!o.idioma || /^es/i.test(o.idioma)),
    seccionesEnVerso: o.seccionesEnVerso !== false,
  };
}

/* ------------------------------------------------------------------ *
 * Páginas: saltos de sección y doble cara
 * ------------------------------------------------------------------ */

/**
 * «section-break» con la semántica de Ulysses: «heading-2» hace que los
 * titulares de nivel 2 Y TODOS LOS SUPERIORES abran sección; con
 * «paragraph-divider», los divisores.
 */
function saltoDeSeccion(valor) {
  const v = String(valor || '').toLowerCase();
  const m = /^heading-([1-6])$/.exec(v);
  if (m) return { nivel: Number(m[1]), divisor: false };
  if (v === 'paragraph-divider') return { nivel: 0, divisor: true };
  return { nivel: 0, divisor: false };
}

/** ¿Este titular abre sección? */
function abreSeccion(seccion, bloque) {
  return !!(seccion && seccion.nivel && bloque && bloque.tipo === 'heading' && bloque.nivel <= seccion.nivel);
}

/**
 * Doble cara efectiva: la elección de la exportación manda sobre el
 * estilo. «si»/«no» o booleanos; cualquier otra cosa, lo que diga la hoja.
 */
function dobleCara(pagina, opc) {
  const v = opc && opc.dobleCara;
  if (v === true || v === 'si' || v === 'sí') return true;
  if (v === false || v === 'no') return false;
  return !!(pagina && pagina.dosCaras);
}

/* ------------------------------------------------------------------ *
 * Láminas
 * ------------------------------------------------------------------ */

/**
 * ¿Es esta imagen una lámina? Devuelve null o su descripción.
 *
 *   recurso  { anchoPx, altoPx, extension } (o ancho/alto en pt a 96 ppp)
 *   pagina   { ancho, alto } en pt
 *   nodo     opciones de la imagen: lamina 'si'|'no', orientacion
 *   modo     'girada' | 'apaisada' | 'no'
 */
function decidirLamina(recurso, pagina, nodo, modo) {
  const n = nodo || {};
  if (n.lamina === 'no') return null;
  const forzada = n.lamina === 'si';
  if (modo === 'no' && !forzada) return null;
  if (!recurso || !pagina) return null;

  const w = recurso.anchoPx || (recurso.ancho ? recurso.ancho / 0.75 : 0);
  const h = recurso.altoPx || (recurso.alto ? recurso.alto / 0.75 : 0);
  if (!w || !h) return forzada ? { orientacion: n.orientacion || orientacionPorDefecto(modo), encaje: 'contain', imagenApaisada: false, anchoPx: 0, altoPx: 0 } : null;

  const largoImg = Math.max(w, h);
  const proporcionImg = largoImg / Math.min(w, h);
  const largoPag = Math.max(pagina.ancho, pagina.alto);
  const proporcionPag = largoPag / Math.min(pagina.ancho, pagina.alto);
  const encaja = Math.abs(proporcionImg / proporcionPag - 1) <= TOLERANCIA_PROPORCION;
  const vectorial = /svg/i.test(recurso.extension || '');
  const nitida = vectorial || largoImg >= (largoPag / 72) * PPP_MINIMO;

  if (!forzada && !(encaja && nitida)) return null;
  return {
    orientacion: n.orientacion || orientacionPorDefecto(modo),
    // A sangre si la proporción es la de la página (recorta como mucho
    // un 2 %); si se forzó una imagen de otra proporción, entera.
    encaje: encaja ? 'cover' : 'contain',
    imagenApaisada: w > h,
    anchoPx: w,
    altoPx: h,
  };
}

function orientacionPorDefecto(modo) {
  return modo === 'apaisada' ? 'apaisada' : 'girada';
}

/** Deja fuera los blancos de los extremos de una lista de nodos. */
function recortar(nodos) {
  const r = nodos.slice();
  while (r.length && r[0].tipo === 'texto' && !r[0].valor.trim()) r.shift();
  while (r.length && r[r.length - 1].tipo === 'texto' && !r[r.length - 1].valor.trim()) r.pop();
  if (r.length && r[0].tipo === 'texto') r[0] = Object.assign({}, r[0], { valor: r[0].valor.replace(/^\s+/, '') });
  const u = r.length - 1;
  if (u >= 0 && r[u].tipo === 'texto') r[u] = Object.assign({}, r[u], { valor: r[u].valor.replace(/\s+$/, '') });
  return r;
}

function unirLineas(lineas) {
  const hijos = [];
  lineas.forEach((l, k) => {
    hijos.push(...l.hijos);
    if (k < lineas.length - 1) hijos.push({ tipo: 'salto' });
  });
  return hijos;
}

/**
 * Parte un párrafo por sus láminas. «…el siguiente.![[faro.png]]» da el
 * párrafo sin la imagen y, detrás, la lámina; si hubiera texto después,
 * un párrafo de continuación (sin sangría: es el mismo párrafo).
 */
function partirPorLaminas(bloque, decidir) {
  const lineas = bloque.lineas || [{ hijos: bloque.hijos, tabs: 0, espacios: 0, texto: MD.aTextoPlano(bloque.hijos) }];
  const piezas = [];
  let actuales = [];
  let hay = false;

  const linea = (original, nodos, partida) => {
    const hijos = recortar(nodos);
    if (!hijos.length) return null;
    const cambiada = partida || hijos.length !== original.hijos.length;
    return {
      hijos,
      tabs: partida ? 0 : original.tabs,
      espacios: partida ? 0 : original.espacios,
      texto: cambiada ? MD.aTextoPlano(hijos).trim() : original.texto,
    };
  };

  for (const l of lineas) {
    let acumulado = [];
    let partida = false;
    for (const nodo of l.hijos || []) {
      const lam = nodo.tipo === 'image' ? decidir(nodo) : null;
      if (!lam) {
        acumulado.push(nodo);
        continue;
      }
      hay = true;
      const antes = linea(l, acumulado, partida);
      if (antes) actuales.push(antes);
      if (actuales.length) piezas.push({ lineas: actuales });
      actuales = [];
      piezas.push(Object.assign({ tipo: 'lamina', ruta: nodo.ruta, alt: nodo.alt || '' }, lam));
      acumulado = [];
      partida = true;
    }
    const resto = linea(l, acumulado, partida);
    if (resto) actuales.push(resto);
  }
  if (actuales.length) piezas.push({ lineas: actuales });
  if (!hay) return [bloque];

  const salida = [];
  let trasLamina = false;
  for (const p of piezas) {
    if (p.tipo === 'lamina') {
      salida.push(p);
      trasLamina = true;
      continue;
    }
    const nuevo = Object.assign({}, bloque, { lineas: p.lineas, hijos: unirLineas(p.lineas) });
    if (trasLamina) nuevo.continuacion = true;
    salida.push(nuevo);
  }
  return salida;
}

function tieneImagen(nodos) {
  return (nodos || []).some((n) => n.tipo === 'image');
}

/** Sustituye figuras y párrafos con láminas por bloques «lamina». */
function extraerLaminas(bloques, decidir) {
  const salida = [];
  for (const b of bloques) {
    if (b.tipo === 'figure') {
      const lam = decidir(b);
      if (lam) salida.push(Object.assign({ tipo: 'lamina', ruta: b.ruta, alt: b.alt || '' }, lam));
      else salida.push(b);
      continue;
    }
    if (b.tipo === 'paragraph' && (tieneImagen(b.hijos) || (b.lineas || []).some((l) => tieneImagen(l.hijos)))) {
      salida.push(...partirPorLaminas(b, decidir));
      continue;
    }
    salida.push(b);
  }
  return salida;
}

/* ------------------------------------------------------------------ *
 * Tramos: lo que queda entre titulares y separadores
 * ------------------------------------------------------------------ */

function tramos(bloques) {
  const lista = [];
  let actual = [];
  for (const b of bloques) {
    // Una lámina no corta el tramo: puede caer a mitad de un poema.
    if (b.tipo === 'heading' || b.tipo === 'divider') {
      if (actual.length) lista.push(actual);
      actual = [];
      continue;
    }
    actual.push(b);
  }
  if (actual.length) lista.push(actual);
  return lista;
}

/* ------------------------------------------------------------------ *
 * Conversaciones
 * ------------------------------------------------------------------ */

const sinBlancos = (nodos) => (nodos || []).filter((n) => !(n.tipo === 'texto' && !n.valor.trim()));

/**
 * «**Nombre** mensaje». El nombre no termina en punto ni en dos puntos,
 * que es como se escriben los rótulos de unos apuntes («**Definición:**»);
 * se admiten solo si va en mayúsculas, que es como se escribe el teatro
 * («**DON JUAN:**»). Un mensaje que acaba en dos puntos presenta algo.
 */
function turnoDe(nodos) {
  const ns = sinBlancos(nodos);
  if (ns.length < 2 || ns[0].tipo !== 'strong') return null;
  const etiqueta = MD.aTextoPlano(ns[0].hijos).trim();
  if (!etiqueta || etiqueta.length > 60) return null;
  const mayusculas = etiqueta === etiqueta.toUpperCase() && /\p{L}/u.test(etiqueta);
  if (/[.:]$/.test(etiqueta) && !mayusculas) return null;
  const mensaje = MD.aTextoPlano(ns.slice(1)).trim();
  if (!mensaje || /:$/.test(mensaje)) return null;
  return { etiqueta: etiqueta.replace(/[.:]$/, '').trim(), largo: mensaje.length };
}

/** Aviso del sistema: la línea entera en cursiva («_Marta ha iniciado sesión._»). */
function esSistema(nodos) {
  const ns = sinBlancos(nodos);
  return ns.length === 1 && ns[0].tipo === 'em' && MD.aTextoPlano(ns[0].hijos).trim().length <= 160;
}

/** Borrador: una línea corta, sin punto final («se ve el barco»). */
function esBorrador(nodos) {
  const t = MD.aTextoPlano(nodos).trim();
  return t.length > 0 && t.length <= 60 && !/[.!?…»”"')]$/.test(t);
}

function clasificarChat(bloque, opc) {
  if (bloque.tipo !== 'paragraph' || E().bloqueEsDialogo(bloque, opc)) return null;
  const lineas = bloque.lineas || [{ hijos: bloque.hijos }];
  const turnos = lineas.map((l) => turnoDe(l.hijos));
  if (turnos.every(Boolean)) return { tipo: 'turno', turnos };
  if (lineas.length === 1 && esSistema(lineas[0].hijos)) return { tipo: 'sistema', turnos: [] };
  if (lineas.length === 1 && esBorrador(lineas[0].hijos)) return { tipo: 'borrador', turnos: [] };
  return null;
}

/**
 * Un tramo es una conversación si tiene al menos tres líneas de chat
 * (turnos o avisos), dos interlocutores o más, alguno repetido, y
 * mensajes cortos (mediana de 80 caracteres como mucho). Probada contra
 * diez mil notas reales: solo salta en novelas y obras de teatro.
 */
function marcarConversaciones(bloques, opc) {
  for (const tramo of tramos(bloques)) {
    const clases = tramo.map((b) => clasificarChat(b, opc));
    const turnos = [];
    let avisos = 0;
    for (const c of clases) {
      if (!c) continue;
      if (c.tipo === 'turno') turnos.push(...c.turnos);
      if (c.tipo === 'sistema') avisos++;
    }
    if (turnos.length + avisos < 3) continue;
    const cuenta = new Map();
    for (const t of turnos) cuenta.set(t.etiqueta, (cuenta.get(t.etiqueta) || 0) + 1);
    if (cuenta.size < 2 || Math.max(...cuenta.values()) < 2) continue;
    const largos = turnos.map((t) => t.largo).sort((a, b) => a - b);
    const mediana = largos[Math.floor((largos.length - 1) / 2)];
    if (mediana > 80) continue;

    // Rachas de líneas de chat; los borradores entran solo si quedan
    // entre dos líneas de chat de la misma racha.
    let i = 0;
    while (i < tramo.length) {
      if (!clases[i] || clases[i].tipo === 'borrador') {
        i++;
        continue;
      }
      let fin = i;
      let j = i + 1;
      while (j < tramo.length && clases[j]) {
        if (clases[j].tipo !== 'borrador') fin = j;
        j++;
      }
      for (let k = i; k <= fin; k++) {
        tramo[k].chat = { tipo: clases[k].tipo, inicio: k === i, fin: k === fin };
      }
      i = fin + 1;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Secciones en verso
 * ------------------------------------------------------------------ */

/**
 * Si la mayoría de los párrafos de un tramo son verso (tres al menos),
 * el tramo es un poema: sus párrafos de una sola línea también son
 * versos y no llevan la sangría de la prosa. Salvo que desentonen: si
 * los versos van sangrados y la línea no, o si es mucho más larga que
 * los versos, es prosa entre estrofas.
 */
function marcarVerso(bloques, opc) {
  const ens = E();
  const sangrada = (l) => (l.tabs || 0) + (l.espacios || 0) > 0;
  for (const tramo of tramos(bloques)) {
    const parrafos = tramo.filter((b) => b.tipo === 'paragraph' && !b.chat && !ens.bloqueEsDialogo(b, opc));
    const versos = parrafos.filter((b) => (b.lineas || []).length > 1 && ens.modoDeLineas(b, opc) === 'verso');
    if (versos.length < 3 || versos.length < 0.6 * parrafos.length) continue;
    const lineas = versos.flatMap((b) => b.lineas);
    const versosSangrados = lineas.filter(sangrada).length >= lineas.length / 2;
    const largos = lineas.map((l) => MD.aTextoPlano(l.hijos).trim().length).sort((a, b) => a - b);
    const mediana = largos[Math.floor((largos.length - 1) / 2)] || 0;
    const tope = Math.max(60, 2.5 * mediana);
    for (const b of parrafos) {
      const ls = b.lineas || [];
      if (ls.length !== 1 || sangrada(ls[0]) !== versosSangrados) continue;
      if (MD.aTextoPlano(b.hijos).trim().length <= tope) b.versoSuelto = true;
    }
  }
}

/**
 * Qué versos de una estrofa tienen que ir pegados al siguiente para que
 * la estrofa no se parta mal: hasta cuatro versos, entera; las más
 * largas dejan al menos dos versos a cada lado del corte.
 */
function versosPegados(n) {
  const pegados = new Array(n).fill(false);
  if (n <= 1) return pegados;
  if (n <= 4) {
    for (let k = 0; k < n - 1; k++) pegados[k] = true;
    return pegados;
  }
  pegados[0] = true;
  pegados[n - 2] = true;
  return pegados;
}

/* ------------------------------------------------------------------ *
 * Epígrafes
 * ------------------------------------------------------------------ */

/** La cita corta que va justo debajo de un titular. */
function marcarEpigrafes(bloques) {
  for (let i = 0; i + 1 < bloques.length; i++) {
    const h = bloques[i];
    const q = bloques[i + 1];
    if (h.tipo !== 'heading' || q.tipo !== 'blockquote') continue;
    const dentro = q.bloques || [];
    if (!dentro.length || dentro.length > 3 || !dentro.every((b) => b.tipo === 'paragraph')) continue;
    const texto = dentro.map((b) => MD.aTextoPlano(b.hijos)).join(' ').trim();
    if (!texto || texto.length > 400 || /^\[!/.test(texto)) continue;
    q.epigrafe = true;
  }
}

/* ------------------------------------------------------------------ *
 * Raya de diálogo
 * ------------------------------------------------------------------ */

const RE_RAYA_INICIAL = /^(\s*)[—–―][ \t ]*/;

function primerTexto(nodos) {
  for (const n of nodos || []) {
    if (n.tipo === 'texto') return n;
    if (n.hijos) return primerTexto(n.hijos);
    return null;
  }
  return null;
}

/**
 * La raya de apertura del diálogo va pegada al parlamento
 * («—¿No vienes?»). Solo en las líneas que abren con raya y siguen con
 * mayúscula o signo de apertura: «— expresiva,» es una enumeración, y
 * ahí la raya va separada.
 */
function pegarRaya(bloques) {
  for (const b of bloques) {
    if (b.tipo === 'blockquote') {
      pegarRaya(b.bloques || []);
      continue;
    }
    if (b.tipo !== 'paragraph') continue;
    for (const l of b.lineas || []) {
      const t = primerTexto(l.hijos);
      if (!t || !RE_RAYA_INICIAL.test(t.valor)) continue;
      const tras = t.valor.replace(RE_RAYA_INICIAL, '');
      const siguiente = tras || MD.aTextoPlano(l.hijos).replace(RE_RAYA_INICIAL, '');
      if (/^\p{Ll}/u.test(siguiente)) continue;
      t.valor = t.valor.replace(RE_RAYA_INICIAL, '$1—');
      if (typeof l.texto === 'string') l.texto = l.texto.replace(RE_RAYA_INICIAL, '$1—');
    }
  }
}

/* ------------------------------------------------------------------ *
 * Ajustes por nota
 * ------------------------------------------------------------------ */

const aBooleano = (v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = MD.sinTildes(v);
  if (['true', 'si', 'yes', '1', 'on'].includes(s)) return true;
  if (['false', 'no', '0', 'off'].includes(s)) return false;
  return undefined;
};
const aNumero = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};
const deLista = (valores, alias) => (v) => {
  const s = MD.sinTildes(v);
  if (alias && alias[s] !== undefined) return alias[s];
  return valores.includes(s) ? s : undefined;
};

/**
 * Propiedades que una nota puede fijar para sí misma, con el prefijo
 * «ulysses-». Las claves se comparan sin tildes ni mayúsculas.
 */
const CLAVES_NOTA = {
  estilo: ['estilo', (v) => (String(v).trim() ? String(v).trim() : undefined)],
  laminas: ['laminas', deLista(MODOS_LAMINA, { imprenta: 'girada', pantalla: 'apaisada', false: 'no', true: 'girada' })],
  'doble-cara': ['dobleCara', (v) => {
    const b = aBooleano(v);
    if (b !== undefined) return b ? 'si' : 'no';
    return MD.sinTildes(v) === 'estilo' ? 'estilo' : undefined;
  }],
  epigrafes: ['epigrafes', aBooleano],
  conversaciones: ['conversaciones', aBooleano],
  'raya-pegada': ['rayaPegada', aBooleano],
  'tamano-pagina': ['tamanoPagina', deLista(['a4', 'letter', 'legal'], { carta: 'letter', oficio: 'legal' })],
  'modo-lineas': ['modoLineas', deLista(['auto', 'verso', 'salto', 'parrafo'])],
  'sangria-verso': ['sangriaVersoEm', aNumero],
  comentarios: ['incluirComentarios', aBooleano],
  'numero-inicial': ['numeroInicial', aNumero],
  'desde-pagina': ['desdePagina', aNumero],
};

/** De las propiedades de una nota a ajustes del plugin. */
function ajustesDeNota(propiedades) {
  const r = {};
  for (const [clave, valor] of Object.entries(propiedades || {})) {
    if (valor === null || valor === undefined || Array.isArray(valor)) continue;
    const k = MD.sinTildes(clave).replace(/[_\s]+/g, '-');
    if (!k.startsWith('ulysses-')) continue;
    const def = CLAVES_NOTA[k.slice('ulysses-'.length)];
    if (!def) continue;
    const v = def[1](valor);
    if (v !== undefined) r[def[0]] = v;
  }
  return r;
}

/* ------------------------------------------------------------------ *
 * Pasada completa
 * ------------------------------------------------------------------ */

const MARCAS = ['chat', 'versoSuelto', 'epigrafe'];

function limpiarMarcas(bloques) {
  for (const b of bloques) {
    for (const m of MARCAS) delete b[m];
    if (b.bloques) limpiarMarcas(b.bloques);
  }
}

/**
 * Prepara el documento para componerlo como libro. Devuelve un documento
 * nuevo; el de entrada solo recibe marcas en sus bloques (que se borran
 * y se recalculan en cada llamada) y la raya normalizada, que es estable.
 *
 * @param opc  las opciones de exportación: recursos, tamanoPagina, idioma,
 *             laminas, epigrafes, conversaciones, rayaPegada…
 */
function preparar(documento, hoja, opc) {
  const o = opcionesLibro(opc);
  const pagina = E().ajustesPagina(hoja, opc && opc.tamanoPagina);
  limpiarMarcas(documento.bloques || []);

  const recurso = (ruta) => (opc && opc.recursos ? opc.recursos(ruta) : null);
  const decidir = (nodo) => decidirLamina(recurso(nodo.ruta), pagina, nodo, o.laminas);
  let bloques = extraerLaminas(documento.bloques || [], decidir);

  if (o.rayaPegada) pegarRaya(bloques);
  if (o.conversaciones) marcarConversaciones(bloques, opc);
  if (o.seccionesEnVerso) marcarVerso(bloques, opc);
  if (o.epigrafes) marcarEpigrafes(bloques);

  return Object.assign({}, documento, { bloques, libro: o });
}

module.exports = {
  preparar,
  opcionesLibro,
  ajustesDeNota,
  CLAVES_NOTA,
  saltoDeSeccion,
  abreSeccion,
  dobleCara,
  decidirLamina,
  extraerLaminas,
  partirPorLaminas,
  marcarConversaciones,
  clasificarChat,
  turnoDe,
  marcarVerso,
  versosPegados,
  marcarEpigrafes,
  pegarRaya,
  tramos,
  TOLERANCIA_PROPORCION,
  PPP_MINIMO,
  MODOS_LAMINA,
};
