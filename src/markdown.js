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
 *   {tipo:'figure', ruta, alt, titulo}
 *   {tipo:'comment', texto}          // %% ... %% de Obsidian
 *
 * Inline:
 *   {tipo:'texto', valor}
 *   {tipo:'strong'|'em'|'del'|'mark'|'code', hijos|valor}
 *   {tipo:'link', destino, hijos}
 *   {tipo:'wikilink', destino, alias}
 *   {tipo:'image', ruta, alt}
 *   {tipo:'footnote', id}
 *   {tipo:'salto'}
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

    // Imagen  ![alt](ruta)
    if (c === '!' && texto[i + 1] === '[') {
      const m = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(texto.slice(i));
      if (m) {
        volcar();
        nodos.push({ tipo: 'image', alt: m[1], ruta: m[2].trim() });
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
        nodos.push({
          tipo: 'image',
          ruta: (barra === -1 ? dentro : dentro.slice(0, barra)).trim(),
          alt: barra === -1 ? '' : dentro.slice(barra + 1).trim(),
        });
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
        bloques.push({ tipo: 'figure', ruta: unaImagen[0].ruta, alt: unaImagen[0].alt });
      } else {
        const conSaltos = [];
        const detalle = parrafo.map((l, idx) => {
          const hijos = analizarInline(l.texto);
          conSaltos.push(...hijos);
          if (idx < parrafo.length - 1) conSaltos.push({ tipo: 'salto' });
          return { hijos, tabs: l.tabs, espacios: l.espacios, texto: l.texto };
        });
        bloques.push({
          tipo: 'paragraph',
          hijos: conSaltos, // vista plana, con saltos duros
          lineas: detalle, // vista por lineas, con su sangria
        });
      }
    }
  }

  return { bloques, notas };
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
  return { frontmatter, bloques, notas };
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

module.exports = { analizar, analizarInline, analizarBloques, separarFrontmatter, aTextoPlano };
