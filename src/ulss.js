'use strict';

const DOCX = require('./docx.js');

/*
 * Parser de hojas de estilo de Ulysses (.ulss)
 * ============================================
 *
 * El formato es un DSL parecido a CSS con estas particularidades:
 *
 *   // comentarios de linea
 *   $variable = valor
 *   @mixin { propiedad: valor }
 *   selector { propiedad: valor; otra: valor }
 *   selector : @mixin { ... }          <- herencia de un mixin
 *   selector : @mixin, @otro { ... }
 *   selector :pseudo { ... }           <- variante (":header", ":header-row")
 *   selector + selector { ... }        <- adyacencia (parrafo tras parrafo)
 *   selector descendiente { ... }      <- descendencia (block-quote paragraph)
 *
 * Los valores pueden ser longitudes (25mm, 12pt, 1in, 2em, 120%), colores
 * (#RRGGBB), cadenas ("Avenir Next"), palabras clave (yes, no, justified)
 * o referencias a variables ($serif).
 *
 * El parser NO interpreta: solo produce un arbol fiel. La interpretacion
 * (que hace cada propiedad) vive en los emisores de CSS y DOCX.
 */

/* ------------------------------------------------------------------ *
 * Errores
 * ------------------------------------------------------------------ */

class ErrorUlss extends Error {
  constructor(mensaje, linea) {
    super(linea ? `${mensaje} (línea ${linea})` : mensaje);
    this.name = 'ErrorUlss';
    this.linea = linea || null;
  }
}

/* ------------------------------------------------------------------ *
 * Lexer
 * ------------------------------------------------------------------ */

const SIMBOLOS = ['{', '}', ':', ';', '=', ',', '+', '>', '(', ')'];

/**
 * Convierte el texto en una lista de tokens.
 * Tipos: palabra, cadena, numero, color, variable, mixin, simbolo, fin
 */
function tokenizar(texto) {
  const tokens = [];
  let i = 0;
  let linea = 1;
  const n = texto.length;

  const empujar = (tipo, valor) => tokens.push({ tipo, valor, linea });

  while (i < n) {
    const c = texto[i];

    // Saltos de linea y espacios
    if (c === '\n') {
      linea++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }

    // Comentario de linea
    if (c === '/' && texto[i + 1] === '/') {
      while (i < n && texto[i] !== '\n') i++;
      continue;
    }

    // Comentario de bloque
    if (c === '/' && texto[i + 1] === '*') {
      i += 2;
      while (i < n && !(texto[i] === '*' && texto[i + 1] === '/')) {
        if (texto[i] === '\n') linea++;
        i++;
      }
      i += 2;
      continue;
    }

    // Cadena entre comillas
    if (c === '"' || c === "'") {
      const cierre = c;
      const inicio = linea;
      i++;
      let valor = '';
      while (i < n && texto[i] !== cierre) {
        if (texto[i] === '\\' && i + 1 < n) {
          valor += texto[i + 1];
          i += 2;
          continue;
        }
        if (texto[i] === '\n') linea++;
        valor += texto[i];
        i++;
      }
      if (i >= n) throw new ErrorUlss('cadena sin cerrar', inicio);
      i++; // comilla de cierre
      empujar('cadena', valor);
      continue;
    }

    // Color hexadecimal
    if (c === '#') {
      let j = i + 1;
      while (j < n && /[0-9a-fA-F]/.test(texto[j])) j++;
      empujar('color', texto.slice(i, j));
      i = j;
      continue;
    }

    // Variable
    if (c === '$') {
      let j = i + 1;
      while (j < n && /[\w-]/.test(texto[j])) j++;
      empujar('variable', texto.slice(i + 1, j));
      i = j;
      continue;
    }

    // Mixin
    if (c === '@') {
      let j = i + 1;
      while (j < n && /[\w-]/.test(texto[j])) j++;
      empujar('mixin', texto.slice(i + 1, j));
      i = j;
      continue;
    }

    // Numero (con unidad opcional). Admite signo y decimales.
    if (/[0-9]/.test(c) || ((c === '-' || c === '.') && /[0-9]/.test(texto[i + 1] || ''))) {
      let j = i;
      if (texto[j] === '-') j++;
      while (j < n && /[0-9.]/.test(texto[j])) j++;
      const numero = parseFloat(texto.slice(i, j));
      let unidad = '';
      if (texto[j] === '%') {
        unidad = '%';
        j++;
      } else {
        let k = j;
        while (k < n && /[a-zA-Z]/.test(texto[k])) k++;
        const posible = texto.slice(j, k).toLowerCase();
        if (['pt', 'mm', 'cm', 'in', 'px', 'em', 'ex'].includes(posible)) {
          unidad = posible;
          j = k;
        }
      }
      empujar('numero', { numero, unidad });
      i = j;
      continue;
    }

    // Simbolos
    if (SIMBOLOS.includes(c)) {
      empujar('simbolo', c);
      i++;
      continue;
    }

    // Palabra (identificador, selector, palabra clave)
    if (/[a-zA-Z_-]/.test(c)) {
      let j = i;
      while (j < n && /[\w-]/.test(texto[j])) j++;
      empujar('palabra', texto.slice(i, j));
      i = j;
      continue;
    }

    throw new ErrorUlss(`carácter inesperado «${c}»`, linea);
  }

  empujar('fin', null);
  return tokens;
}

/**
 * Convierte una notacion funcional de color en una pieza de color.
 * Filmscript, por ejemplo, define «$blue = rgb(0,0,109)».
 */
function aColorFuncion(nombre, args) {
  const hex = (n) => {
    const v = Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
    return v.toString(16).padStart(2, '0');
  };
  if ((nombre === 'rgb' || nombre === 'rgba') && args.length >= 3) {
    return { tipo: 'color', valor: '#' + hex(args[0]) + hex(args[1]) + hex(args[2]) };
  }
  if (nombre === 'gray' || nombre === 'grey') {
    const g = args.length ? hex(args[0]) : '00';
    return { tipo: 'color', valor: '#' + g + g + g };
  }
  // Lo que no sepamos traducir se conserva como palabra, sin romper nada.
  return { tipo: 'palabra', valor: `${nombre}(${args.join(',')})` };
}

/* ------------------------------------------------------------------ *
 * Parser
 * ------------------------------------------------------------------ */

/**
 * Analiza el texto de una hoja .ulss.
 * Devuelve { variables, mixins, reglas, avisos }
 *   variables: { nombre: valor }
 *   mixins:    { nombre: { propiedades } }
 *   reglas:    [ { selector, partes, hereda:[mixins], propiedades, linea } ]
 */
function analizar(texto) {
  const tokens = tokenizar(texto);
  let p = 0;

  const actual = () => tokens[p];
  const mirar = (k = 0) => tokens[p + k] || tokens[tokens.length - 1];
  const avanzar = () => tokens[p++];
  const esSimbolo = (s, k = 0) => mirar(k).tipo === 'simbolo' && mirar(k).valor === s;

  const variables = Object.create(null);
  const mixins = Object.create(null);
  const reglas = [];
  const avisos = [];

  /**
   * Lee un valor. En .ulss un valor termina en «;», en «}» o al acabar la
   * linea: no hay continuacion implicita. Sin la comprobacion de linea, un
   * «$a = 4pt» seguido de «$b = ...» se tragaria la definicion siguiente.
   */
  function leerValor() {
    const piezas = [];
    const lineaInicio = actual().linea;
    while (
      actual().tipo !== 'fin' &&
      actual().linea === lineaInicio &&
      !esSimbolo(';') &&
      !esSimbolo('}') &&
      !(mirar().tipo === 'palabra' && esSimbolo(':', 1)) // empieza otra propiedad
    ) {
      // Notacion funcional: rgb(0,0,109), rgba(...), etc.
      if (mirar().tipo === 'palabra' && esSimbolo('(', 1)) {
        const nombre = avanzar().valor.toLowerCase();
        avanzar(); // el parentesis de apertura
        const args = [];
        while (!esSimbolo(')') && actual().tipo !== 'fin') {
          const a = avanzar();
          if (a.tipo === 'numero') args.push(a.valor.numero);
          else if (a.tipo === 'palabra') args.push(a.valor);
        }
        if (esSimbolo(')')) avanzar();
        piezas.push(aColorFuncion(nombre, args));
        continue;
      }

      const t = avanzar();
      if (t.tipo === 'numero') piezas.push({ tipo: 'longitud', numero: t.valor.numero, unidad: t.valor.unidad });
      else if (t.tipo === 'cadena') piezas.push({ tipo: 'cadena', valor: t.valor });
      else if (t.tipo === 'color') piezas.push({ tipo: 'color', valor: t.valor });
      else if (t.tipo === 'variable') piezas.push({ tipo: 'variable', valor: t.valor });
      else if (t.tipo === 'palabra') piezas.push({ tipo: 'palabra', valor: t.valor });
      else if (t.tipo === 'simbolo' && t.valor === ',') piezas.push({ tipo: 'coma' });
      else piezas.push({ tipo: 'otro', valor: t.valor });
    }
    return piezas;
  }

  /** Lee el cuerpo entre llaves y devuelve el mapa de propiedades. */
  function leerBloque() {
    if (!esSimbolo('{')) throw new ErrorUlss('se esperaba «{»', actual().linea);
    avanzar();

    const propiedades = Object.create(null);
    while (!esSimbolo('}')) {
      if (actual().tipo === 'fin') throw new ErrorUlss('bloque sin cerrar', actual().linea);

      if (esSimbolo(';')) {
        avanzar();
        continue;
      }

      if (actual().tipo !== 'palabra') {
        avisos.push(`token inesperado en un bloque, línea ${actual().linea}`);
        avanzar();
        continue;
      }

      const nombre = avanzar().valor;
      if (!esSimbolo(':')) {
        avisos.push(`propiedad «${nombre}» sin «:», línea ${actual().linea}`);
        continue;
      }
      avanzar(); // los dos puntos

      const linea = actual().linea;
      const valor = leerValor();
      propiedades[nombre] = { piezas: valor, linea };
    }
    avanzar(); // la llave de cierre
    return propiedades;
  }

  /* --- bucle principal --- */
  while (actual().tipo !== 'fin') {
    // Definicion de variable:  $nombre = valor
    if (actual().tipo === 'variable' && esSimbolo('=', 1)) {
      const nombre = avanzar().valor;
      avanzar(); // el igual
      variables[nombre] = leerValor();
      continue;
    }

    // Definicion de mixin:  @nombre { ... }
    if (actual().tipo === 'mixin' && esSimbolo('{', 1)) {
      const nombre = avanzar().valor;
      mixins[nombre] = leerBloque();
      continue;
    }

    // Regla: selector [+ selector] [:pseudo] [: @mixin] { ... }
    if (actual().tipo === 'palabra') {
      const partes = [];
      const hereda = [];
      let pseudo = null;

      // Nombre y combinadores
      partes.push({ tipo: 'nombre', valor: avanzar().valor });

      while (true) {
        if (esSimbolo('+') || esSimbolo('>')) {
          const comb = avanzar().valor;
          if (actual().tipo !== 'palabra') throw new ErrorUlss('se esperaba un selector', actual().linea);
          partes.push({ tipo: comb === '+' ? 'adyacente' : 'hijo', valor: avanzar().valor });
          continue;
        }
        if (actual().tipo === 'palabra') {
          partes.push({ tipo: 'descendiente', valor: avanzar().valor });
          continue;
        }
        // «: algo» puede ser pseudo (palabra) o herencia (@mixin)
        if (esSimbolo(':')) {
          if (mirar(1).tipo === 'palabra') {
            avanzar();
            pseudo = avanzar().valor;
            continue;
          }
          if (mirar(1).tipo === 'mixin') {
            avanzar();
            while (actual().tipo === 'mixin') {
              hereda.push(avanzar().valor);
              if (esSimbolo(',')) avanzar();
              else break;
            }
            continue;
          }
        }
        break;
      }

      const linea = actual().linea;
      const propiedades = leerBloque();

      reglas.push({
        selector: describirSelector(partes, pseudo),
        partes,
        pseudo,
        hereda,
        propiedades,
        linea,
      });
      continue;
    }

    avisos.push(`elemento no reconocido en la línea ${actual().linea}`);
    avanzar();
  }

  return { variables, mixins, reglas, avisos };
}

function describirSelector(partes, pseudo) {
  let s = '';
  for (const parte of partes) {
    if (parte.tipo === 'nombre') s = parte.valor;
    else if (parte.tipo === 'adyacente') s += ' + ' + parte.valor;
    else if (parte.tipo === 'hijo') s += ' > ' + parte.valor;
    else s += ' ' + parte.valor;
  }
  if (pseudo) s += ' :' + pseudo;
  return s;
}

/* ------------------------------------------------------------------ *
 * Resolucion de valores
 * ------------------------------------------------------------------ */

/*
 * Ulysses no trata «em» como el cuerpo entero, sino como 0,6 veces el
 * cuerpo DEL PROPIO ELEMENTO. Medido sobre su exportacion DOCX de
 * Swiss Knife, con siete valores independientes que coinciden:
 *
 *   first-line-indent 3em sobre 12pt  -> 21,6pt  (432 twips)
 *   heading-1 line-height 2em / 32pt  -> 38,4pt  (768 twips)
 *   heading-2 line-height 2em / 24pt  -> 28,8pt  (576 twips)
 *   heading-4 line-height 2em / 15pt  -> 18,0pt  (360 twips)
 *   heading-5 line-height 2em / 12pt  -> 14,4pt  (288 twips)
 *   block-quote margin 3em sobre 12pt -> 21,6pt  (432 twips)
 *   block-code margin 3em sobre 11pt  -> 19,8pt  (396 twips)
 *
 * Que Courier New y Avenir Next den el mismo factor descarta que se
 * derive de las metricas de la fuente: es una constante.
 */
const EM_ULYSSES = 0.6;

const PT_POR_UNIDAD = {
  pt: 1,
  px: 0.75, // 96 px = 72 pt
  in: 72,
  mm: 72 / 25.4,
  cm: 720 / 25.4,
};

/** Pasa una longitud absoluta a puntos. Devuelve null si es relativa. */
function aPuntos(valor, contextoPt) {
  if (!valor || valor.tipo !== 'longitud') return null;
  if (valor.unidad === 'em' || valor.unidad === 'ex') {
    if (typeof contextoPt !== 'number') return null;
    const factor = valor.unidad === 'em' ? EM_ULYSSES : EM_ULYSSES / 2;
    return valor.numero * contextoPt * factor;
  }
  if (valor.unidad === '%') {
    if (typeof contextoPt !== 'number') return null;
    return (valor.numero / 100) * contextoPt;
  }
  const f = PT_POR_UNIDAD[valor.unidad || 'pt'];
  return f ? valor.numero * f : valor.numero;
}

/**
 * Sustituye variables y devuelve el valor ya resuelto.
 * Un valor puede ser simple (una pieza) o compuesto (varias).
 */
function resolverPiezas(piezas, variables, visitadas) {
  const salida = [];
  for (const pieza of piezas || []) {
    if (pieza.tipo === 'variable') {
      const vistas = visitadas || new Set();
      if (vistas.has(pieza.valor)) {
        salida.push({ tipo: 'palabra', valor: '$' + pieza.valor });
        continue;
      }
      const def = variables[pieza.valor];
      if (!def) {
        salida.push({ tipo: 'palabra', valor: '$' + pieza.valor });
        continue;
      }
      vistas.add(pieza.valor);
      salida.push(...resolverPiezas(def, variables, vistas));
      vistas.delete(pieza.valor);
      continue;
    }
    salida.push(pieza);
  }
  return salida;
}

/* ------------------------------------------------------------------ *
 * Hoja de estilo resuelta
 * ------------------------------------------------------------------ */

/**
 * Aplana el arbol: aplica variables, expande mixins y agrupa las reglas
 * por selector. Devuelve un objeto consultable.
 */
function resolver(arbol) {
  const { variables, mixins, reglas, avisos } = arbol;
  const porSelector = new Map();

  for (const regla of reglas) {
    const propiedades = Object.create(null);

    // Primero lo heredado de los mixins, en orden
    for (const nombreMixin of regla.hereda) {
      const mixin = mixins[nombreMixin];
      if (!mixin) {
        avisos.push(`mixin «@${nombreMixin}» no definido (línea ${regla.linea})`);
        continue;
      }
      for (const [k, v] of Object.entries(mixin)) {
        propiedades[k] = resolverPiezas(v.piezas, variables);
      }
    }

    // Luego lo propio, que manda
    for (const [k, v] of Object.entries(regla.propiedades)) {
      propiedades[k] = resolverPiezas(v.piezas, variables);
    }

    const clave = regla.selector;
    if (porSelector.has(clave)) {
      Object.assign(porSelector.get(clave).propiedades, propiedades);
    } else {
      porSelector.set(clave, {
        selector: clave,
        partes: regla.partes,
        pseudo: regla.pseudo,
        propiedades,
      });
    }
  }

  return new HojaUlss(porSelector, variables, avisos);
}

class HojaUlss {
  constructor(porSelector, variables, avisos) {
    this.reglas = porSelector;
    this.variables = variables;
    this.avisos = avisos || [];
  }

  /** Propiedades crudas de un selector exacto. */
  bloque(selector) {
    const r = this.reglas.get(selector);
    return r ? r.propiedades : null;
  }

  /** Una propiedad concreta. Devuelve las piezas resueltas o null. */
  prop(selector, nombre) {
    const b = this.bloque(selector);
    if (!b) return null;
    return b[nombre] || null;
  }

  /** Primera pieza de una propiedad (el caso habitual). */
  valor(selector, nombre) {
    const piezas = this.prop(selector, nombre);
    return piezas && piezas.length ? piezas[0] : null;
  }

  /** Longitud en puntos, o el valor por defecto. */
  puntos(selector, nombre, contextoPt, porDefecto) {
    const v = this.valor(selector, nombre);
    const pt = aPuntos(v, contextoPt);
    return pt === null || pt === undefined ? porDefecto : pt;
  }

  /** Palabra clave en minusculas, o el valor por defecto. */
  palabra(selector, nombre, porDefecto) {
    const v = this.valor(selector, nombre);
    if (!v) return porDefecto;
    if (v.tipo === 'palabra') return String(v.valor).toLowerCase();
    if (v.tipo === 'cadena') return v.valor;
    return porDefecto;
  }

  /** yes/no -> booleano. */
  bandera(selector, nombre, porDefecto) {
    const v = this.palabra(selector, nombre, null);
    if (v === null) return porDefecto;
    return v === 'yes' || v === 'true' || v === 'on';
  }

  /** Familia tipografica como cadena. */
  familia(selector, porDefecto) {
    const piezas = this.prop(selector, 'font-family');
    if (!piezas || !piezas.length) return porDefecto;
    const nombres = piezas
      .filter((x) => x.tipo === 'cadena' || x.tipo === 'palabra')
      .map((x) => String(x.valor));
    return nombres.length ? nombres.join(', ') : porDefecto;
  }

  /** Color #rrggbb, o el valor por defecto. */
  color(selector, nombre, porDefecto) {
    const v = this.valor(selector, nombre);
    if (!v || v.tipo !== 'color') return porDefecto;
    return v.valor;
  }

  /** Lista de selectores presentes. */
  selectores() {
    return Array.from(this.reglas.keys());
  }
}

/** Atajo: de texto .ulss a hoja resuelta. */
function cargar(texto) {
  return resolver(analizar(texto));
}

module.exports = {
  ErrorUlss,
  tokenizar,
  analizar,
  resolver,
  cargar,
  aPuntos,
  aColorFuncion,
  HojaUlss,
  PT_POR_UNIDAD,
  EM_ULYSSES,
};
