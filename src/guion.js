'use strict';

/*
 * Guion
 * =====
 *
 * Compone una obra de teatro como un guion de cine: el nombre del
 * personaje en su columna, la acotación del personaje debajo, el diálogo
 * en una columna estrecha y las acotaciones de escena a todo lo ancho,
 * sin paréntesis. Se activa con una hoja que declare alguno de los
 * selectores de guion (script-character, script-parenthetical,
 * script-dialogue, script-action) o con «ulysses-guion» en la nota.
 * Ulysses ignora esos selectores, así que la hoja sirve igual allí.
 *
 * Entiende las dos maneras habituales de escribir teatro en una nota:
 *
 *   NOMBRE (acotación): réplica           una línea, como en un libreto
 *   **NOMBRE** *(acotación)*⏎réplica       el nombre en negrita y la
 *                                          réplica en las líneas de debajo
 *
 * y las acotaciones de escena como párrafos entre paréntesis, en
 * cursiva o no. Una acotación metida en mitad de una réplica, «(Se
 * levanta)», sale en su propia línea, como en un guion. Las líneas de
 * una réplica sangradas con tabuladores son un dibujo (versos que caen,
 * una escalera) y se componen a todo lo ancho para que no se rompan.
 *
 * Como libro.js, no toca el documento de entrada: devuelve bloques nuevos
 * marcados con  paragraph.guion = { rol, libre? }  y
 *   rol: 'personaje' | 'acotacion' | 'dialogo' | 'accion' | 'portada'
 *
 * La portada es el titular 1 con el que empieza la nota y lo que le sigue
 * hasta el primer separador o titular: el título y los subtítulos, que
 * se componen centrados y a un tercio de la primera página
 * (heading.portada y paragraph.guion.rol = 'portada').
 */

const MD = require('./markdown.js');

const SELECTORES = {
  personaje: 'script-character',
  acotacion: 'script-parenthetical',
  dialogo: 'script-dialogue',
  accion: 'script-action',
  portada: 'script-title',
};

/** ¿La hoja pide guion? (o la nota/exportación lo fuerza) */
function activo(hoja, opc) {
  if (opc && opc.guion === true) return true;
  if (opc && opc.guion === false) return false;
  return !!hoja && Object.values(SELECTORES).some((s) => hoja.bloque(s));
}

/* ------------------------------------------------------------------ *
 * Cortar nodos inline por posiciones del texto plano
 * ------------------------------------------------------------------ */

function largoPlano(nodo) {
  if (nodo.tipo === 'texto' || nodo.tipo === 'code') return nodo.valor.length;
  if (nodo.tipo === 'wikilink') return (nodo.alias || nodo.destino).length;
  if (nodo.tipo === 'salto') return 1;
  if (nodo.hijos) return nodo.hijos.reduce((s, h) => s + largoPlano(h), 0);
  return 0;
}

/** Los nodos que caen entre las posiciones [ini, fin) del texto plano. */
function cortar(nodos, ini, fin) {
  const salida = [];
  let pos = 0;
  for (const nodo of nodos || []) {
    const largo = largoPlano(nodo);
    const a = pos;
    const b = pos + largo;
    pos = b;
    if (b <= ini || a >= fin) {
      if (largo === 0 && a >= ini && a < fin) salida.push(nodo); // imagen, nota
      continue;
    }
    if (nodo.tipo === 'texto' || nodo.tipo === 'code') {
      const v = nodo.valor.slice(Math.max(0, ini - a), Math.min(largo, fin - a));
      if (v) salida.push(Object.assign({}, nodo, { valor: v }));
    } else if (nodo.hijos) {
      const hijos = cortar(nodo.hijos, Math.max(0, ini - a), Math.min(largo, fin - a));
      if (hijos.length) salida.push(Object.assign({}, nodo, { hijos }));
    } else if (a >= ini && b <= fin) {
      salida.push(nodo);
    }
  }
  return salida;
}

/** Texto plano con las mismas posiciones que usa «cortar». */
function plano(nodos) {
  let s = '';
  for (const nodo of nodos || []) {
    if (nodo.tipo === 'texto' || nodo.tipo === 'code') s += nodo.valor;
    else if (nodo.tipo === 'wikilink') s += nodo.alias || nodo.destino;
    else if (nodo.tipo === 'salto') s += '\n';
    else if (nodo.hijos) s += plano(nodo.hijos);
  }
  return s;
}

/** Quita blancos al principio y al final, respetando el formato. */
function recortar(nodos) {
  const t = plano(nodos);
  const ini = t.length - t.replace(/^\s+/, '').length;
  const fin = t.replace(/\s+$/, '').length;
  return fin > ini ? cortar(nodos, ini, fin) : [];
}

/**
 * Si todo va dentro de una cursiva, se quita esa cursiva de fuera: en un
 * guion las acotaciones van en redonda. Lo que el autor tenía en cursiva
 * dentro de ella («*(…el *Poison* de Dior…)*») sigue en cursiva.
 */
function sinCursivaDeFuera(nodos) {
  const llenos = (nodos || []).filter((x) => !(x.tipo === 'texto' && !x.valor.trim()));
  if (llenos.length === 1 && llenos[0].tipo === 'em') return llenos[0].hijos;
  return nodos;
}

/* ------------------------------------------------------------------ *
 * Reconocer turnos y acotaciones
 * ------------------------------------------------------------------ */

// NOMBRE en mayúsculas (puede llevar espacios, comas, la «y» de «A Y B»).
const RE_NOMBRE = /^((?:[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9'’.-]*)(?:(?:\s+|,\s*)(?:[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9'’.-]*|Y|E))*)/;

/**
 * ¿La primera línea abre un turno? Devuelve las posiciones (en el texto
 * plano de la línea) del nombre, de la acotación y del principio de la
 * réplica, o null.
 */
function turnoDeLinea(nodos) {
  const t = plano(nodos);
  // Formato **NOMBRE**: el nombre es la negrita del principio.
  const primero = (nodos || []).find((x) => !(x.tipo === 'texto' && !x.valor.trim()));
  if (primero && primero.tipo === 'strong') {
    const nombre = MD.aTextoPlano(primero.hijos).trim().replace(/[.:]$/, '').trim();
    if (nombre && nombre.length <= 60 && nombre === nombre.toUpperCase() && /\p{L}/u.test(nombre)) {
      const ini = t.indexOf(MD.aTextoPlano(primero.hijos));
      let pos = ini + MD.aTextoPlano(primero.hijos).length;
      const resto = t.slice(pos);
      const m = /^\s*[:.]?\s*(\(([^()]*(?:\([^()]*\)[^()]*)*)\))?\s*:?\s*/.exec(resto);
      const acot = m && m[1] ? { ini: pos + resto.indexOf(m[1]), fin: pos + resto.indexOf(m[1]) + m[1].length } : null;
      return { nombre, acot, replica: pos + (m ? m[0].length : 0) };
    }
  }
  // Formato NOMBRE (acotación): réplica
  const m = RE_NOMBRE.exec(t);
  if (!m) return null;
  const nombre = m[1].trim();
  if (nombre.length < 2 || nombre.length > 60 || !/\p{Lu}.*\p{Lu}/u.test(nombre)) return null;
  let pos = m[1].length;
  let acot = null;
  const resto = t.slice(pos);
  const ma = /^\s*\(/.exec(resto);
  if (ma) {
    // Paréntesis equilibrado (puede haber otros dentro).
    let prof = 0;
    let i = pos + ma[0].length - 1;
    for (; i < t.length; i++) {
      if (t[i] === '(') prof++;
      else if (t[i] === ')') {
        prof--;
        if (prof === 0) break;
      }
    }
    if (prof !== 0) return null;
    acot = { ini: pos + ma[0].length - 1, fin: i + 1 };
    pos = i + 1;
  }
  const mc = /^\s*:\s*/.exec(t.slice(pos));
  if (!mc) return null;
  return { nombre, acot, replica: pos + mc[0].length };
}

/** ¿El párrafo es una acotación de escena entera, entre paréntesis? */
function esAcotacion(bloque) {
  const t = plano(bloque.hijos).trim();
  return /^\(/.test(t) && /\)[.…]?$/.test(t) && equilibrado(t);
}

function equilibrado(t) {
  let prof = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '(') prof++;
    else if (t[i] === ')') {
      prof--;
      if (prof === 0 && i < t.length - 2) return false; // se cierra antes del final
    }
  }
  return prof === 0;
}

/** Quita el paréntesis de fuera de una acotación de escena. */
function quitarParentesis(nodos) {
  let n = sinCursivaDeFuera(recortar(nodos));
  let t = plano(n);
  const ini = t.indexOf('(');
  const fin = t.lastIndexOf(')');
  if (ini === -1 || fin === -1) return n;
  n = recortar(cortar(n, ini + 1, fin).concat(cortar(n, fin + 1, t.length).filter((x) => x.tipo !== 'texto' || x.valor !== '.')));
  t = plano(n);
  // Una acotación de una frase acaba en punto, como cualquier frase.
  if (t && !t.includes('\n') && !/[.!?…:»"”)]$/.test(t)) n = n.concat([{ tipo: 'texto', valor: '.' }]);
  return n;
}

/* ------------------------------------------------------------------ *
 * Partir una réplica en diálogo y acotaciones de en medio
 * ------------------------------------------------------------------ */

// «(Se levanta)», «(A la primera fila)»: empiezan por mayúscula.
// Las más largas que esto son acción y van a todo lo ancho.
const LARGO_ACOTACION = 70;
const RE_ACOT_MEDIO = /\((?=[A-ZÁÉÍÓÚÜÑ¡¿])[^()\n]*\)/g;

/** Una línea de réplica → trozos { rol: 'dialogo'|'acotacion', hijos } */
function trozosDeLinea(nodos) {
  const t = plano(nodos);
  const trozos = [];
  let pos = 0;
  let m;
  RE_ACOT_MEDIO.lastIndex = 0;
  while ((m = RE_ACOT_MEDIO.exec(t))) {
    const antes = recortar(cortar(nodos, pos, m.index));
    if (plano(antes).trim()) trozos.push({ rol: 'dialogo', hijos: antes });
    trozos.push({ rol: 'acotacion', hijos: recortar(cortar(nodos, m.index, m.index + m[0].length)) });
    pos = m.index + m[0].length;
    // Lo que sigue a la acotación no empieza con el punto que la cerraba.
    const sig = /^[\s.,;]*/.exec(t.slice(pos));
    pos += sig ? sig[0].length : 0;
  }
  const resto = recortar(cortar(nodos, pos, t.length));
  if (plano(resto).trim()) trozos.push({ rol: 'dialogo', hijos: resto });
  return trozos;
}

function bloque(rol, lineas, extra) {
  const hijos = [];
  lineas.forEach((l, k) => {
    if (k > 0) hijos.push({ tipo: 'salto' });
    hijos.push(...l.hijos);
  });
  return {
    tipo: 'paragraph',
    hijos,
    lineas: lineas.map((l) => ({ hijos: l.hijos, tabs: l.tabs || 0, espacios: l.espacios || 0, texto: plano(l.hijos) })),
    guion: Object.assign({ rol }, extra || {}),
  };
}

/** Un párrafo que abre turno → bloques de personaje, acotación y diálogo. */
function partirTurno(b, turno) {
  const lineas = b.lineas || [{ hijos: b.hijos, tabs: 0, espacios: 0 }];
  const primera = lineas[0].hijos;
  const salida = [bloque('personaje', [{ hijos: [{ tipo: 'texto', valor: turno.nombre }] }])];
  if (turno.acot) {
    salida.push(bloque('acotacion', [{ hijos: sinCursivaDeFuera(recortar(cortar(primera, turno.acot.ini, turno.acot.fin))) }]));
  }
  // Las líneas de la réplica: lo que queda de la primera y las demás.
  const replica = [];
  const restoPrimera = recortar(cortar(primera, turno.replica, plano(primera).length));
  if (plano(restoPrimera).trim()) replica.push({ hijos: restoPrimera, tabs: 0, espacios: 0 });
  for (const l of lineas.slice(1)) replica.push({ hijos: l.hijos, tabs: l.tabs, espacios: l.espacios });

  // Una réplica con líneas sangradas es un dibujo: entera, a todo lo ancho.
  const libre = replica.some((l) => (l.tabs || 0) > 0);
  if (libre) {
    salida.push(bloque('dialogo', replica, { libre: true, nombre: turno.nombre }));
    return salida;
  }
  // Si no, cada acotación de en medio sale en su línea.
  let acumulado = [];
  const volcar = () => {
    if (acumulado.length) salida.push(bloque('dialogo', acumulado, { nombre: turno.nombre }));
    acumulado = [];
  };
  let pendiente = false; // tras una acción, el personaje vuelve con «(CONT.)»
  for (const l of replica) {
    for (const trozo of trozosDeLinea(l.hijos)) {
      if (trozo.rol === 'acotacion' && plano(trozo.hijos).length > LARGO_ACOTACION) {
        // Larga: es acción, a todo lo ancho, y el personaje sigue después.
        volcar();
        salida.push(bloque('accion', [{ hijos: quitarParentesis(trozo.hijos) }]));
        pendiente = true;
      } else if (trozo.rol === 'acotacion') {
        volcar();
        salida.push(bloque('acotacion', [{ hijos: trozo.hijos }]));
      } else {
        if (pendiente) {
          salida.push(bloque('personaje', [{ hijos: [{ tipo: 'texto', valor: `${turno.nombre} (CONT.)` }] }]));
          pendiente = false;
        }
        acumulado.push({ hijos: trozo.hijos });
      }
    }
  }
  volcar();
  return salida;
}

/**
 * Recorre los bloques de primer nivel y devuelve la lista nueva, con los
 * turnos partidos y las acotaciones de escena marcadas.
 */
function marcarGuion(bloques) {
  const salida = [];
  const lista = bloques || [];
  let i0 = 0;
  // La portada: el titular 1 del principio y sus subtítulos.
  if (lista[0] && lista[0].tipo === 'heading' && lista[0].nivel === 1) {
    salida.push(Object.assign({}, lista[0], { portada: true }));
    i0 = 1;
    while (i0 < lista.length && lista[i0].tipo === 'paragraph') {
      salida.push(Object.assign({}, lista[i0], { guion: { rol: 'portada' } }));
      i0++;
    }
  }
  for (const b of lista.slice(i0)) {
    if (b.tipo !== 'paragraph') {
      salida.push(b);
      continue;
    }
    if (esAcotacion(b)) {
      const lineas = (b.lineas || [{ hijos: b.hijos }]).map((l) => ({ hijos: l.hijos, tabs: l.tabs, espacios: l.espacios }));
      // El paréntesis abre en la primera línea y cierra en la última.
      const todo = quitarParentesis(b.hijos);
      const partes = [];
      let actual = [];
      for (const n of todo) {
        if (n.tipo === 'salto') {
          partes.push(actual);
          actual = [];
        } else actual.push(n);
      }
      partes.push(actual);
      salida.push(bloque('accion', partes.map((h, k) => ({ hijos: h, tabs: (lineas[k] || {}).tabs, espacios: (lineas[k] || {}).espacios }))));
      continue;
    }
    const turno = turnoDeLinea((b.lineas && b.lineas[0] ? b.lineas[0].hijos : b.hijos));
    if (turno) {
      salida.push(...partirTurno(b, turno));
      continue;
    }
    // Lo demás es acción: a todo lo ancho, con las sangrías de cada línea.
    const lineas = b.lineas || [{ hijos: b.hijos, tabs: 0, espacios: 0 }];
    salida.push(bloque('accion', lineas.map((l) => ({ hijos: l.hijos, tabs: l.tabs, espacios: l.espacios }))));
  }
  return salida;
}

/**
 * Geometría por defecto, en pt, para lo que la hoja no declare: la del
 * guion de cine en una página de 6 pulgadas de caja (personaje a 2,2 in
 * del margen, diálogo de 1 a 4,5 in, acotación de 1,6 a 4 in).
 */
function geometriaPorDefecto(rol, anchoPt) {
  const f = anchoPt / 432; // 6 in
  switch (rol) {
    case 'personaje':
      return { ml: 158 * f, mr: 0 };
    case 'acotacion':
      return { ml: 115 * f, mr: 144 * f };
    case 'dialogo':
      return { ml: 72 * f, mr: 108 * f };
    case 'portada':
      return { ml: 36 * f, mr: 36 * f };
    default:
      return { ml: 0, mr: 0 };
  }
}

/**
 * ¿Es la línea un dibujo? Lo es si lleva blancos que cuentan: dos o más
 * espacios seguidos, o un tabulador, entre letras. Esas líneas se
 * componen como en una máquina de escribir, sin juntar los blancos.
 */
function esDibujo(nodos) {
  return /\S(?: {2,}|\t)/.test(plano(nodos));
}

/**
 * Lleva cada tabulador de dentro de la línea a su parada, contando en
 * columnas de la máquina de escribir (exacto con letra de paso fijo, como
 * la Courier de un guion). «columna» es dónde empieza la línea y
 * «porTab» las columnas entre paradas.
 */
function expandirTabuladores(nodos, columna, porTab) {
  let col = columna || 0;
  const paso = Math.max(1, porTab || 1);
  const recorrer = (lista) =>
    (lista || []).map((n) => {
      if (n.tipo === 'texto') {
        let valor = '';
        for (const ch of n.valor) {
          if (ch === '\t') {
            const parada = (Math.floor(col / paso + 1e-6) + 1) * paso;
            valor += ' '.repeat(parada - col);
            col = parada;
          } else {
            valor += ch;
            col++;
          }
        }
        return Object.assign({}, n, { valor });
      }
      if (n.hijos) return Object.assign({}, n, { hijos: recorrer(n.hijos) });
      return n;
    });
  return recorrer(nodos);
}

/**
 * Un dibujo puesto a máquina: los tabuladores, a su parada en columnas de
 * 0,6 em (el paso de la Courier). «sangria» y «unidadTab» en pt, como el
 * cuerpo. Igual en el PDF, el DOCX y el HTML.
 */
function aMaquina(nodos, sangria, unidadTab, tamano) {
  const columna = 0.6 * (tamano || 12);
  return expandirTabuladores(nodos, Math.round((sangria || 0) / columna), Math.max(1, Math.round((unidadTab || 0) / columna)));
}

/** Mayúsculas en los nodos de texto (para «text-transform: uppercase»). */
function aMayusculas(nodos) {
  return (nodos || []).map((n) => {
    if (n.tipo === 'texto') return Object.assign({}, n, { valor: n.valor.toLocaleUpperCase('es') });
    if (n.hijos) return Object.assign({}, n, { hijos: aMayusculas(n.hijos) });
    return n;
  });
}

module.exports = {
  SELECTORES,
  activo,
  marcarGuion,
  turnoDeLinea,
  trozosDeLinea,
  esAcotacion,
  quitarParentesis,
  geometriaPorDefecto,
  aMayusculas,
  esDibujo,
  expandirTabuladores,
  aMaquina,
  cortar,
  plano,
};
