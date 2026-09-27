'use strict';

/*
 * Markdown -> arbol de bloques
 * ============================
 *
 * Un unico arbol alimenta los dos emisores (CSS/PDF y DOCX), para que
 * ambos salgan del mismo sitio y no diverjan. Cubre lo que Ulysses maneja
 * en sus hojas: titulares, parrafos, citas, codigo, divisores, listas,
 * tablas, imagenes y notas al pie.
 *
 * Bloques:
 *   {tipo:'heading', nivel, hijos}
 *   {tipo:'paragraph', hijos}
 *   {tipo:'blockquote', bloques}
 *   {tipo:'code', lenguaje, texto}
 *   {tipo:'divider'}
 *   {tipo:'list', ordenada, items:[{bloques}]}
 *   {tipo:'table', cabecera:[celdas], filas:[[celdas]], alineaciones}
 *   {tipo:'figure', ruta, alt, titulo, ancho?, alto?, lamina?, orientacion?}
 *   {tipo:'comment', texto}          // %% ... %% de Obsidian
 *
 * Inline:
 *   {tipo:'texto', valor}
 *   {tipo:'strong'|'em'|'del'|'mark'|'code', hijos|valor}
 *   {tipo:'link', destino, hijos}
 *   {tipo:'wikilink', destino, alias}
 *   {tipo:'image', ruta, alt, ancho?, alto?, lamina?, orientacion?}
 *   {tipo:'footnote', id}
 *   {tipo:'salto'}
 *
 * Las opciones de imagen salen de lo que Obsidian admite tras la barra:
 * «![[foto.png|300]]» o «|300x200» fijan el tamaño en píxeles, y el
 * plugin añade sus palabras: «página»/«lámina» (a página completa),
 * «texto» (nunca como lámina), «girada» y «apaisada» (orientación).
 */

/* ------------------------------------------------------------------ *
 * Frontmatter
 * ------------------------------------------------------------------ */

function separarFrontmatter(texto) {
  if (!texto.startsWith('---')) return { frontmatter: null, cuerpo: texto };
  const fin = texto.indexOf('\n---', 3);
  if (fin === -1) return { frontmatter: null, cuerpo: texto };
  const salto = texto.indexOf('\n', fin + 1);
  return {
    frontmatter: texto.slice(3, fin).trim(),
    cuerpo: salto === -1 ? '' : texto.slice(salto + 1),
  };
}

/**
 * Propiedades de la nota: el YAML plano que Obsidian escribe en su panel
 * («clave: valor», listas con guion o entre corchetes). No pretende ser
 * un YAML completo; en el plugin manda la caché de Obsidian, y esto
 * sirve para la terminal.
 */
function leerPropiedades(frontmatter) {
  const props = Object.create(null);
  if (!frontmatter) return props;
  const escalar = (v) => {
    const s = String(v).trim();
    if (/^(["']).*\1$/.test(s)) return s.slice(1, -1);
    if (/^(true|sí|si|yes)$/i.test(s)) return true;
    if (/^(false|no)$/i.test(s)) return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  };
  let lista = null;
  for (const linea of frontmatter.split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(linea);
    if (item && lista) {
      lista.push(escalar(item[1]));
      continue;
    }
    const m = /^([^\s:#][^:]*):\s*(.*)$/.exec(linea);
    if (!m) continue;
    const clave = m[1].trim();
    const valor = m[2].trim();
    lista = null;
    if (!valor) {
      lista = props[clave] = [];
    } else if (/^\[.*\]$/.test(valor)) {
      props[clave] = valor.slice(1, -1).split(',').map((x) => escalar(x)).filter((x) => x !== '');
    } else {
      props[clave] = escalar(valor);
    }
  }
  return props;
}

/* ------------------------------------------------------------------ *
 * Opciones de imagen
 * ------------------------------------------------------------------ */

const sinTildes = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const PALABRAS_IMAGEN = {
  pagina: { lamina: 'si' }, lamina: { lamina: 'si' }, page: { lamina: 'si' },
  full: { lamina: 'si' }, 'pagina completa': { lamina: 'si' }, 'a sangre': { lamina: 'si' },
  texto: { lamina: 'no' }, text: { lamina: 'no' }, inline: { lamina: 'no' },
  'en linea': { lamina: 'no' }, 'sin lamina': { lamina: 'no' }, nolamina: { lamina: 'no' },
  girada: { orientacion: 'girada' }, rotada: { orientacion: 'girada' }, rotate: { orientacion: 'girada' },
  rotated: { orientacion: 'girada' },
  apaisada: { orientacion: 'apaisada' }, landscape: { orientacion: 'apaisada' },
  horizontal: { orientacion: 'apaisada' },
};

/**
 * Reparte lo que va tras la barra de una imagen entre tamaño, palabras
 * del plugin y texto alternativo. «Mapa de la casa|300» da un pie y un
 * ancho; «página|girada» fuerza una lámina girada.
 */
function opcionesDeImagen(alias, primeroEsAlt) {
  const r = { alt: '' };
  if (alias === undefined || alias === null) return r;
  const libres = [];
  String(alias).split('|').forEach((trozo, k) => {
    const t = trozo.trim();
    if (!t) return;
    // En «![alt|300](ruta)» el primer trozo es el texto alternativo, diga
    // lo que diga: «![Página](scan.png)» no es una lámina forzada.
    if (primeroEsAlt && k === 0) {
      libres.push(t);
      return;
    }
    const tam = /^(\d+)(?:\s*x\s*(\d+))?$/i.exec(t);
    if (tam) {
      r.ancho = Number(tam[1]);
      if (tam[2]) r.alto = Number(tam[2]);
      return;
    }
    const palabra = PALABRAS_IMAGEN[sinTildes(t)];
    if (palabra) {
      Object.assign(r, palabra);
      return;
    }
    libres.push(t);
  });
  r.alt = libres.join(' | ');
  return r;
}

/* ------------------------------------------------------------------ *
 * Inline
 * ------------------------------------------------------------------ */

function analizarInline(texto) {
  const nodos = [];
  let buffer = '';
  let i = 0;
  const n = texto.length;

  const volcar = () => {
    if (buffer) {
      nodos.push({ tipo: 'texto', valor: buffer });
      buffer = '';
    }
  };

  while (i < n) {
    const c = texto[i];

    // Fin de línea dentro del párrafo: salto duro. Llega aquí porque el
    // párrafo se analiza entero, para que una cursiva pueda abarcar
    // varios versos como en Obsidian.
    if (c === '\n') {
      volcar();
      nodos.push({ tipo: 'salto' });
      i++;
      continue;
    }

    // Escape
    if (c === '\\' && i + 1 < n) {
      buffer += texto[i + 1];
      i += 2;
      continue;
    }

    // Codigo inline (mantiene su contenido literal)
    if (c === '`') {
      let vallas = 0;
      while (texto[i + vallas] === '`') vallas++;
      const marca = '`'.repeat(vallas);
      const cierre = texto.indexOf(marca, i + vallas);
      if (cierre !== -1) {
        volcar();
        nodos.push({ tipo: 'code', valor: texto.slice(i + vallas, cierre) });
        i = cierre + vallas;
        continue;
      }
    }

    // Imagen  ![alt](ruta)  (Obsidian admite también «![alt|300](ruta)»)
    if (c === '!' && texto[i + 1] === '[') {
      const m = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(texto.slice(i));
      if (m) {
        volcar();
        nodos.push(Object.assign({ tipo: 'image', ruta: m[2].trim() }, opcionesDeImagen(m[1], true)));
        i += m[0].length;
        continue;
      }
    }

    // Embebido de Obsidian  ![[ruta|alias]]
    if (c === '!' && texto.startsWith('![[', i)) {
      const cierre = texto.indexOf(']]', i);
      if (cierre !== -1) {
        volcar();
        const dentro = texto.slice(i + 3, cierre);
        const barra = dentro.indexOf('|');
        nodos.push(
          Object.assign(
            { tipo: 'image', ruta: (barra === -1 ? dentro : dentro.slice(0, barra)).trim() },
            opcionesDeImagen(barra === -1 ? '' : dentro.slice(barra + 1))
          )
        );
        i = cierre + 2;
        continue;
      }
    }

    // Wikilink  [[destino|alias]]
    if (texto.startsWith('[[', i)) {
      const cierre = texto.indexOf(']]', i);
      if (cierre !== -1) {
        volcar();
        const dentro = texto.slice(i + 2, cierre);
        const barra = dentro.indexOf('|');
        nodos.push({
          tipo: 'wikilink',
          destino: (barra === -1 ? dentro : dentro.slice(0, barra)).trim(),
          alias: barra === -1 ? null : dentro.slice(barra + 1).trim(),
        });
        i = cierre + 2;
        continue;
      }
    }

    // Nota al pie  [^id]
    if (c === '[' && texto[i + 1] === '^') {
      const m = /^\[\^([^\]]+)\]/.exec(texto.slice(i));
      if (m) {
        volcar();
        nodos.push({ tipo: 'footnote', id: m[1] });
        i += m[0].length;
        continue;
      }
    }

    // Enlace  [texto](destino)
    if (c === '[') {
      const m = /^\[([^\]]*)\]\(([^)]*)\)/.exec(texto.slice(i));
      if (m) {
        volcar();
        nodos.push({ tipo: 'link', destino: m[2].trim(), hijos: analizarInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }

    // Marcas emparejadas
    const pares = [
      { marca: '***', tipo: 'strongem' },
      { marca: '___', tipo: 'strongem' },
      { marca: '**', tipo: 'strong' },
      { marca: '__', tipo: 'strong' },
      { marca: '==', tipo: 'mark' },
      { marca: '~~', tipo: 'del' },
      { marca: '*', tipo: 'em' },
      { marca: '_', tipo: 'em' },
    ];

    let emparejado = false;
    for (const par of pares) {
      if (!texto.startsWith(par.marca, i)) continue;
      // Regla de markdown: la marca de apertura no puede ir seguida de un
      // espacio, o «2 * 3 * 4» se leeria como cursiva.
      const siguiente = texto[i + par.marca.length];
      if (siguiente === undefined || /\s/.test(siguiente)) continue;
      // Y, como en CommonMark (y en Obsidian), el guion bajo no abre
      // dentro de una palabra: «mi_tesis.docx» es texto. Importa más
      // ahora que el párrafo se analiza entero y un «_» podría emparejarse
      // con otro de una línea posterior.
      if (par.marca[0] === '_' && i > 0 && ALFANUMERICO.test(texto[i - 1])) continue;
      const cierre = buscarCierre(texto, i + par.marca.length, par.marca);
      if (cierre === -1) continue;
      volcar();
      const dentro = analizarInline(texto.slice(i + par.marca.length, cierre));
      if (par.tipo === 'strongem') {
        nodos.push({ tipo: 'strong', hijos: [{ tipo: 'em', hijos: dentro }] });
      } else {
        nodos.push({ tipo: par.tipo, hijos: dentro });
      }
      i = cierre + par.marca.length;
      emparejado = true;
      break;
    }
    if (emparejado) continue;

    buffer += c;
    i++;
  }

  volcar();
  return nodos;
}

const ALFANUMERICO = /[\p{L}\p{N}]/u;

/** Busca la marca de cierre respetando los escapes y el codigo inline. */
function buscarCierre(texto, desde, marca) {
  let i = desde;
  while (i < texto.length) {
    if (texto[i] === '\\') {
      i += 2;
      continue;
    }
    if (texto[i] === '`') {
      const cierre = texto.indexOf('`', i + 1);
      i = cierre === -1 ? i + 1 : cierre + 1;
      continue;
    }
    if (texto.startsWith(marca, i)) {
      if (i === desde) return -1;              // marca vacia
      if (/\s/.test(texto[i - 1])) {          // «a * b»: no cierra
        i++;
        continue;
      }
      // «_» seguido de letra o número tampoco cierra («notas_finales»)
      if (marca[0] === '_' && ALFANUMERICO.test(texto[i + marca.length] || '')) {
        i++;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

/* ------------------------------------------------------------------ *
 * Bloques
 * ------------------------------------------------------------------ */

const RE_TITULAR = /^(#{1,6})\s+(.*)$/;
const RE_DIVISOR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const RE_VALLA = /^\s{0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const RE_VINETA = /^(\s*)([-*+])\s+(.*)$/;
const RE_NUMERO = /^(\s*)(\d+)[.)]\s+(.*)$/;
const RE_CITA = /^\s{0,3}>\s?(.*)$/;
const RE_NOTA = /^\[\^([^\]]+)\]:\s*(.*)$/;
const RE_FILA = /^\s*\|(.+)\|\s*$/;
const RE_SEPARADOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function analizarBloques(texto) {
  const lineas = texto.replace(/\r\n?/g, '\n').split('\n');
  const bloques = [];
  const notas = Object.create(null);
  let i = 0;

  while (i < lineas.length) {
    const linea = lineas[i];

    // Linea en blanco
    if (!linea.trim()) {
      i++;
      continue;
    }

    // Comentario de Obsidian  %% ... %%
    if (linea.trim().startsWith('%%')) {
      const partes = [];
      let l = linea.trim().slice(2);
      if (l.endsWith('%%')) {
        bloques.push({ tipo: 'comment', texto: l.slice(0, -2).trim() });
        i++;
        continue;
      }
      partes.push(l);
      i++;
      while (i < lineas.length && !lineas[i].includes('%%')) {
        partes.push(lineas[i]);
        i++;
      }
      if (i < lineas.length) {
        partes.push(lineas[i].slice(0, lineas[i].indexOf('%%')));
        i++;
      }
      bloques.push({ tipo: 'comment', texto: partes.join('\n').trim() });
      continue;
    }

    // Definicion de nota al pie
    const mNota = RE_NOTA.exec(linea);
    if (mNota) {
      const partes = [mNota[2]];
      i++;
      while (i < lineas.length && lineas[i].trim() && !RE_NOTA.test(lineas[i]) && !RE_TITULAR.test(lineas[i])) {
        partes.push(lineas[i].trim());
        i++;
      }
      notas[mNota[1]] = analizarInline(partes.join(' ').trim());
      continue;
    }

    // Divisor
    if (RE_DIVISOR.test(linea)) {
      bloques.push({ tipo: 'divider' });
      i++;
      continue;
    }

    // Titular
    const mTit = RE_TITULAR.exec(linea);
    if (mTit) {
      bloques.push({ tipo: 'heading', nivel: mTit[1].length, hijos: analizarInline(mTit[2].trim()) });
      i++;
      continue;
    }

    // Bloque de codigo con vallas
    const mValla = RE_VALLA.exec(linea);
    if (mValla) {
      const valla = mValla[1][0];
      const largo = mValla[1].length;
      const lenguaje = (mValla[2] || '').trim();
      const cuerpo = [];
      i++;
      while (i < lineas.length) {
        const cierre = new RegExp('^\\s{0,3}' + (valla === '`' ? '`' : '~') + '{' + largo + ',}\\s*$');
        if (cierre.test(lineas[i])) {
          i++;
          break;
        }
        cuerpo.push(lineas[i]);
        i++;
      }
      bloques.push({ tipo: 'code', lenguaje, texto: cuerpo.join('\n') });
      continue;
    }

    // Cita
    if (RE_CITA.test(linea)) {
      const dentro = [];
      while (i < lineas.length && (RE_CITA.test(lineas[i]) || (lineas[i].trim() && dentro.length))) {
        const m = RE_CITA.exec(lineas[i]);
        if (m) dentro.push(m[1]);
        else dentro.push(lineas[i]);
        i++;
      }
      const sub = analizarBloques(dentro.join('\n'));
      bloques.push({ tipo: 'blockquote', bloques: sub.bloques });
      Object.assign(notas, sub.notas);
      continue;
    }

    // Tabla
    if (RE_FILA.test(linea) && i + 1 < lineas.length && RE_SEPARADOR.test(lineas[i + 1])) {
      const celdas = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const cabecera = celdas(linea);
      const alineaciones = celdas(lineas[i + 1]).map((c) => {
        const izq = c.startsWith(':');
        const der = c.endsWith(':');
        return izq && der ? 'center' : der ? 'right' : 'left';
      });
      i += 2;
      const filas = [];
      while (i < lineas.length && RE_FILA.test(lineas[i])) {
        filas.push(celdas(lineas[i]));
        i++;
      }
      bloques.push({
        tipo: 'table',
        cabecera: cabecera.map(analizarInline),
        alineaciones,
        filas: filas.map((f) => f.map(analizarInline)),
      });
      continue;
    }

    // Listas
    if (RE_VINETA.test(linea) || RE_NUMERO.test(linea)) {
      const resultado = analizarLista(lineas, i);
      bloques.push(resultado.lista);
      Object.assign(notas, resultado.notas);
      i = resultado.siguiente;
      continue;
    }

    // Parrafo: acumula hasta linea en blanco o inicio de otro bloque.
    // Se guarda la sangria de cada linea, que en textos literarios es
    // significativa (verso, prosa sangrada) y el .trim() se comia.
    const parrafo = [];
    while (i < lineas.length) {
      const l = lineas[i];
      if (!l.trim()) break;
      if (RE_TITULAR.test(l) || RE_DIVISOR.test(l) || RE_VALLA.test(l) || RE_CITA.test(l)) break;
      if (RE_VINETA.test(l) || RE_NUMERO.test(l)) break;
      if (RE_NOTA.test(l)) break;
      const m = /^([\t ]*)/.exec(l);
      const blancos = m ? m[1] : '';
      parrafo.push({
        texto: l.trim(),
        tabs: (blancos.match(/\t/g) || []).length,
        espacios: (blancos.match(/ /g) || []).length,
      });
      i++;
    }

    if (parrafo.length) {
      // Un parrafo que es solo una imagen se convierte en figura
      const unaImagen = parrafo.length === 1 && analizarInline(parrafo[0].texto);
      if (unaImagen && unaImagen.length === 1 && unaImagen[0].tipo === 'image') {
        const img = Object.assign({}, unaImagen[0]);
        delete img.tipo;
        bloques.push(Object.assign({ tipo: 'figure' }, img));
      } else {
        // El párrafo se analiza entero y después se reparte en líneas:
        // así una cursiva que abarca varios versos se cierra donde toca
        // y no deja los «_» a la vista. Si el reparto no cuadra (un
        // código en línea que cruza el salto), se vuelve al análisis
        // línea a línea de siempre.
        const plano = analizarInline(parrafo.map((l) => l.texto).join('\n'));
        let porLineas = partirEnLineas(plano);
        let hijos = plano;
        if (porLineas.length !== parrafo.length) {
          porLineas = parrafo.map((l) => analizarInline(l.texto));
          hijos = [];
          porLineas.forEach((h, idx) => {
            hijos.push(...h);
            if (idx < porLineas.length - 1) hijos.push({ tipo: 'salto' });
          });
        }
        const detalle = parrafo.map((l, idx) => ({
          hijos: porLineas[idx],
          tabs: l.tabs,
          espacios: l.espacios,
          texto: l.texto,
        }));
        bloques.push({
          tipo: 'paragraph',
          hijos, // vista plana, con saltos duros
          lineas: detalle, // vista por lineas, con su sangria
        });
      }
    }
  }

  return { bloques, notas };
}

/** Nodos que envuelven a otros y que pueden abarcar varias líneas. */
const ENVOLTORIOS = new Set(['strong', 'em', 'del', 'mark', 'link']);

/**
 * Reparte un árbol inline en líneas por sus saltos. Un envoltorio que
 * cruza un salto se duplica a cada lado: «_a⏎b_» da «_a_» y «_b_».
 */
function partirEnLineas(nodos) {
  const lineas = [[]];
  for (const nodo of nodos || []) {
    if (nodo.tipo === 'salto') {
      lineas.push([]);
      continue;
    }
    if (ENVOLTORIOS.has(nodo.tipo) && nodo.hijos) {
      partirEnLineas(nodo.hijos).forEach((trozo, k) => {
        if (k > 0) lineas.push([]);
        if (trozo.length) lineas[lineas.length - 1].push(Object.assign({}, nodo, { hijos: trozo }));
      });
      continue;
    }
    lineas[lineas.length - 1].push(nodo);
  }
  return lineas;
}

function analizarLista(lineas, inicio) {
  const primera = RE_VINETA.exec(lineas[inicio]) || RE_NUMERO.exec(lineas[inicio]);
  const ordenada = !RE_VINETA.test(lineas[inicio]);
  const sangriaBase = primera[1].length;
  const items = [];
  const notas = Object.create(null);
  let i = inicio;

  while (i < lineas.length) {
    const linea = lineas[i];
    if (!linea.trim()) {
      // Una linea en blanco solo corta si lo siguiente no es de la lista
      const siguiente = lineas[i + 1];
      if (!siguiente || !(RE_VINETA.test(siguiente) || RE_NUMERO.test(siguiente) || /^\s{2,}\S/.test(siguiente))) break;
      i++;
      continue;
    }

    const m = RE_VINETA.exec(linea) || RE_NUMERO.exec(linea);
    if (!m) break;
    if (m[1].length < sangriaBase) break;

    // Al mismo nivel, cambiar de vinetas a numeros (o al reves) empieza
    // OTRA lista: si no, «1. Uno» tras «- x» se absorbe como vineta.
    if (m[1].length === sangriaBase && !RE_VINETA.test(linea) !== ordenada) break;

    if (m[1].length > sangriaBase) {
      // Sublista: pertenece al ultimo item
      const sub = analizarLista(lineas, i);
      if (items.length) items[items.length - 1].bloques.push(sub.lista);
      else items.push({ bloques: [sub.lista] });
      Object.assign(notas, sub.notas);
      i = sub.siguiente;
      continue;
    }

    // Item propio: su texto mas las lineas de continuacion
    const partes = [m[3]];
    i++;
    while (i < lineas.length) {
      const l = lineas[i];
      if (!l.trim()) break;
      if (RE_VINETA.test(l) || RE_NUMERO.test(l)) break;
      partes.push(l.trim());
      i++;
    }
    items.push({ bloques: [{ tipo: 'paragraph', hijos: analizarInline(partes.join(' ')) }] });
  }

  return { lista: { tipo: 'list', ordenada, items }, notas, siguiente: i };
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */

function analizar(texto) {
  const { frontmatter, cuerpo } = separarFrontmatter(texto);
  const { bloques, notas } = analizarBloques(cuerpo);
  return { frontmatter, propiedades: leerPropiedades(frontmatter), bloques, notas };
}

/** Texto plano de una lista de nodos inline (para titulos, alt, etc.). */
function aTextoPlano(nodos) {
  let s = '';
  for (const nodo of nodos || []) {
    if (nodo.tipo === 'texto' || nodo.tipo === 'code') s += nodo.valor;
    else if (nodo.tipo === 'wikilink') s += nodo.alias || nodo.destino;
    else if (nodo.tipo === 'salto') s += ' ';
    else if (nodo.hijos) s += aTextoPlano(nodo.hijos);
  }
  return s;
}

module.exports = {
  analizar,
  analizarInline,
  analizarBloques,
  separarFrontmatter,
  aTextoPlano,
  leerPropiedades,
  opcionesDeImagen,
  partirEnLineas,
  sinTildes,
};
