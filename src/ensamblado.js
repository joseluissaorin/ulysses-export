'use strict';

/*
 * Ensamblado final: del arbol de markdown + hoja .ulss a DOCX y a HTML/PDF.
 */

const D = require('./docx.js');
const MD = require('./markdown.js');
const ULSS = require('./ulss.js');

const MM = 72 / 25.4;
// Ulysses redondea A4 a puntos enteros: 595 x 842 pt (11900 x 16840
// twips), no los 595,276 x 841,89 que salen de 210 x 297 mm.
const PAGINAS = {
  a4: { ancho: 595, alto: 842 },
  letter: { ancho: 612, alto: 792 },
  legal: { ancho: 612, alto: 1008 },
};

/* ------------------------------------------------------------------ *
 * Ajustes de pagina leidos de document-settings
 * ------------------------------------------------------------------ */

function ajustesPagina(hoja, tamano) {
  const preajuste = PAGINAS[(tamano || 'a4').toLowerCase()] || PAGINAS.a4;
  const s = 'document-settings';

  // Si la hoja declara su propio tamano manda ella, no el preajuste:
  // Keynote 16:9 son 288 x 162 mm apaisados y APA o Filmscript son Carta.
  const anchoHoja = hoja.puntos(s, 'page-width', 12, null);
  const altoHoja = hoja.puntos(s, 'page-height', 12, null);
  const pagina = {
    ancho: anchoHoja !== null ? anchoHoja : preajuste.ancho,
    alto: altoHoja !== null ? altoHoja : preajuste.alto,
  };

  return {
    ancho: pagina.ancho,
    alto: pagina.alto,
    propiaDeLaHoja: anchoHoja !== null || altoHoja !== null,
    superior: hoja.puntos(s, 'page-inset-top', 12, 25 * MM),
    inferior: hoja.puntos(s, 'page-inset-bottom', 12, 25 * MM),
    interior: hoja.puntos(s, 'page-inset-inner', 12, 25 * MM),
    exterior: hoja.puntos(s, 'page-inset-outer', 12, 25 * MM),
    dosCaras: hoja.bandera(s, 'two-sided', false),
    saltoSeccion: hoja.palabra(s, 'section-break', null),
    columnas: Math.max(1, Math.round(hoja.puntos(s, 'column-count', 12, 1))),
    separacionColumnas: hoja.puntos(s, 'column-spacing-width', 12, 0),
    piePagina: hoja.palabra('area-footer', 'content', 'none'),
    alineacionPie: hoja.palabra('area-footer', 'text-alignment', 'center'),
    // Distancia del borde al pie: «bottom-spacing» de area-footer.
    distanciaPie: hoja.puntos('area-footer', 'bottom-spacing', 12, 35.4),
    distanciaEncabezado: hoja.puntos('area-header', 'top-spacing', 12, 0),
    piePrimeraPagina: hoja.palabra('area-footer :first-page', 'content', null),
    encabezado: hoja.palabra('area-header', 'content', 'none'),
    alineacionEncabezado: hoja.palabra('area-header', 'text-alignment', 'center'),
    notaFormato: hoja.palabra(s, 'footnote-style', 'decimal'),
    notaColocacion: hoja.palabra(s, 'footnote-placement', 'end-of-page'),
    notaEnumeracion: hoja.palabra(s, 'footnote-enumeration', 'per-section'),
  };
}

const ENCABEZADOS_BIBLIOGRAFIA = [
  'bibliografía', 'bibliografia', 'referencias', 'referencias bibliográficas',
  'obras citadas', 'fuentes', 'works cited', 'references', 'bibliography',
];

/** Sangria francesa por defecto cuando la hoja no dice nada: 1,25 cm (APA). */
const SANGRIA_BIBLIOGRAFIA = 12.5 * MM; // 1,25 cm, la sangria francesa de APA

/**
 * Marca los parrafos que caen bajo un titular de bibliografia.
 *
 * OJO: esto es una EXTENSION del plugin, no algo que Ulysses haga. El
 * formato .ulss no tiene selector de bibliografia, asi que Ulysses no
 * puede dar sangria francesa a las referencias. Si la hoja define
 * «paragraph-bibliography» se usa; si no, se aplica el valor por defecto.
 */
function marcarBibliografia(bloques, encabezados) {
  const titulos = (encabezados && encabezados.length ? encabezados : ENCABEZADOS_BIBLIOGRAFIA).map(
    (t) => String(t).trim().toLowerCase()
  );
  let dentro = false;
  let nivelSeccion = 0;

  for (const b of bloques || []) {
    if (b.tipo === 'heading') {
      const texto = MD.aTextoPlano(b.hijos).trim().toLowerCase().replace(/[.:]$/, '');
      const coincide = titulos.some((t) => texto === t || texto.startsWith(t + ' '));
      if (coincide) {
        dentro = true;
        nivelSeccion = b.nivel;
      } else if (dentro && b.nivel <= nivelSeccion) {
        dentro = false;
      }
      continue;
    }
    if (dentro && (b.tipo === 'paragraph' || b.tipo === 'list')) b.bibliografia = true;
  }
  return bloques;
}

/**
 * Ancho de un tabulador, en puntos. Manda el ajuste del usuario; si no,
 * «default-tab-interval» de la hoja; si tampoco, 4em (el valor que usan
 * casi todas las hojas de Ulysses para el codigo).
 */
function anchoTabulador(hoja, base, opc) {
  if (opc && opc.anchoTabuladorEm) return opc.anchoTabuladorEm * 0.6 * (base.tamano || 12);
  const ctx = base.tamano || 12;
  const v =
    hoja.puntos('paragraph', 'default-tab-interval', ctx, null) !== null
      ? hoja.puntos('paragraph', 'default-tab-interval', ctx, null)
      : hoja.puntos('defaults', 'default-tab-interval', ctx, null);
  return v !== null ? v : 4 * 0.6 * ctx;
}

/** Sangria de una linea concreta: tabuladores mas espacios sueltos. */
function sangriaDeLinea(linea, unidad) {
  if (!linea) return 0;
  return (linea.tabs || 0) * unidad + (linea.espacios || 0) * (unidad / 4);
}

/**
 * Decide como tratar un parrafo de varias lineas.
 *   verso   -> cada linea es un parrafo con su propia sangria
 *   salto   -> un parrafo con saltos duros dentro
 *   parrafo -> las lineas se unen (markdown clasico)
 *   auto    -> verso si hay sangria o si las lineas son cortas
 */
function modoDeLineas(bloque, opc) {
  const modo = (opc && opc.modoLineas) || 'auto';
  const lineas = bloque.lineas || [];
  if (lineas.length <= 1) return 'parrafo';
  if (modo !== 'auto') return modo;
  const haySangria = lineas.some((l) => l.tabs || l.espacios);
  const todasCortas = lineas.every((l) => (l.texto || '').length <= 60);
  return haySangria || todasCortas ? 'verso' : 'salto';
}

/** Nombre del estilo de Word: manda «style-title» de la hoja si lo hay. */
function nombreEstilo(hoja, selectores, porDefecto) {
  for (let i = selectores.length - 1; i >= 0; i--) {
    const t = hoja.palabra(selectores[i], 'style-title', null);
    if (t) return t;
  }
  return porDefecto;
}

/*
 * Dialogo con raya
 * ================
 *
 * En castellano el dialogo se marca con raya al principio de linea. Hay
 * dos maneras de escribirlo y las dos tienen que salir igual:
 *
 *   - Texto     una lista de markdown. El estilo la convierte en dialogo
 *               con «list-unordered { enumeration-format: "—" }».
 *   — Texto     la raya escrita directamente.
 *
 * La segunda caia en parrafo normal y se llevaba la sangria de primera
 * linea, que en un dialogo no pinta nada. Aqui se le da la MISMA
 * geometria que a la lista: raya al margen y el texto sangrado detras,
 * de modo que la vuelta de linea alinea bajo la primera palabra.
 */
const RAYA_DIALOGO = /^[\u2014\u2013\u2015]/;

function lineaEsDialogo(linea) {
  return RAYA_DIALOGO.test(String((linea && linea.texto) || '').trim());
}

function bloqueEsDialogo(bloque, opc) {
  if (opc && opc.dialogos === false) return false;
  if (!bloque || bloque.tipo !== 'paragraph') return false;
  const lineas = bloque.lineas || [];
  if (!lineas.length) return false;
  return lineas.every(lineaEsDialogo);
}

/** Geometria del dialogo: la de la lista sin numerar del estilo. */
function sangriaDialogo(hoja, base) {
  const s = sangriaNivel(hoja, base, false, 0);
  const izquierda = s.izquierda;
  const colgante = Math.max(0, izquierda - (s.marcador || 0));
  return { izquierda, colgante };
}

/** Nombre del estilo de parrafo de Word para cada tipo de bloque. */
function estiloDe(bloque) {
  switch (bloque.tipo) {
    case 'heading':
      return `Encabezamiento ${bloque.nivel}`;
    case 'blockquote':
      return 'Bloque de cita';
    case 'code':
      return 'Bloque de código';
    case 'list':
      return bloque.ordenada ? 'Lista numerada' : 'Lista';
    case 'comment':
      return 'Bloque de comentario';
    case 'divider':
      return 'Separador';
    default:
      return null;
  }
}

/** Selectores que aplican a cada tipo de bloque, del generico al concreto. */
function selectoresDe(bloque, indice) {
  switch (bloque.tipo) {
    case 'heading':
      return ['heading-all', `heading-${bloque.nivel}`];
    case 'paragraph': {
      // «paragraph :first» solo en el primerisimo bloque del documento.
      // Medido contra Ulysses: a todo parrafo, incluido el que sigue a un
      // titular, a una lista o a un divisor, le aplica «paragraph» a secas.
      const sels =
        indice > 0
          ? ['paragraph', 'paragraph + paragraph']
          : bloque.primeroDelDocumento
            ? ['paragraph', 'paragraph :first']
            : ['paragraph'];
      // Novela usa «heading-all + paragraph» para quitar la sangria al
      // primer parrafo despues de cualquier titular.
      if (bloque.trasTitular) sels.push('heading-all + paragraph');
      if (bloque.bibliografia) sels.push('paragraph-bibliography');
      return sels;
    }
    case 'blockquote':
      return ['block-all', 'block-quote'];
    case 'code':
      return ['block-all', 'block-code'];
    case 'figure':
      return ['paragraph', 'paragraph-figure'];
    case 'divider':
      return ['paragraph', 'paragraph-divider'];
    case 'list':
      // La sangria de la lista la pone numbering.xml; la de primera linea
      // del parrafo no debe sumarse (Ulysses la deja en cero). Y los
      // margenes verticales salen de «list-all paragraph», no de
      // «paragraph»: Universidad pide 1mm arriba y 0 abajo.
      return [
        'paragraph', 'list-all', 'list-all paragraph',
        bloque.ordenada ? 'list-ordered' : 'list-unordered',
      ];
    default:
      return ['paragraph'];
  }
}

/* ------------------------------------------------------------------ *
 * DOCX
 * ------------------------------------------------------------------ */

function construirDocx(documento, hoja, opciones) {
  const opc = opciones || {};
  const pagina = ajustesPagina(hoja, opc.tamanoPagina);
  const base = D.atributosBase(hoja);

  const relaciones = [];
  const medios = [];
  const notas = [];
  let siguienteRel = 10;
  let siguienteNota = 2; // 0 y 1 los reserva Word

  const ctx = {
    hoja,
    base,
    atributos: base,
    enlace(destino) {
      const id = `rId${siguienteRel++}`;
      relaciones.push({
        id,
        tipo: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
        destino,
        externo: true,
      });
      return id;
    },
    notaAlPie(idNota) {
      const contenido = documento.notas ? documento.notas[idNota] : null;
      if (!contenido) return null;
      const num = siguienteNota++;
      notas.push({ num, contenido });
      return num;
    },
    imagen(ruta, alt) {
      if (!opc.recursos) return null;
      const recurso = opc.recursos(ruta);
      if (!recurso || !recurso.datos) return null;

      const id = `rId${siguienteRel++}`;
      const nombre = `media/imagen${medios.length + 1}.${recurso.extension || 'png'}`;
      medios.push({ nombre, datos: recurso.datos, extension: recurso.extension || 'png' });
      relaciones.push({
        id,
        tipo: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
        destino: nombre,
        externo: false,
      });

      const anchoUtil = pagina.ancho - pagina.interior - pagina.exterior;
      let ancho = recurso.ancho || anchoUtil;
      let alto = recurso.alto || anchoUtil * 0.75;
      if (ancho > anchoUtil) {
        alto = (alto * anchoUtil) / ancho;
        ancho = anchoUtil;
      }
      const cx = Math.round(ancho * D.PT_A_EMU);
      const cy = Math.round(alto * D.PT_A_EMU);
      const n = medios.length;

      return (
        `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
        `<wp:extent cx="${cx}" cy="${cy}"/>` +
        `<wp:docPr id="${n}" name="Imagen ${n}" descr="${D.esc(alt || '')}"/>` +
        `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
        `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:nvPicPr><pic:cNvPr id="${n}" name="Imagen ${n}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
        `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
      );
    },
  };

  const cuerpo = [];

  function parrafo(nodos, atrs, extra) {
    const pPr = D.propiedadesParrafo(atrs, base, extra);
    const ctxLocal = Object.assign({}, ctx, { atributos: atrs });
    const runs = D.corridas(nodos, ctxLocal, null);
    cuerpo.push(`<w:p>${pPr}${runs.join('')}</w:p>`);
  }

  let hayContenido = false;

  // Una instancia de numeracion por lista de primer nivel: si se comparte,
  // la segunda lista numerada continua en 3 en vez de reiniciar en 1.
  const numeraciones = [];
  function registrarLista(ordenada) {
    numeraciones.push({ numId: numeraciones.length + 1, ordenada });
    return numeraciones[numeraciones.length - 1].numId;
  }

  function emitirLista(bloque, nivel, atrs, numIdHeredado) {
    const numId = nivel === 0 ? registrarLista(bloque.ordenada) : numIdHeredado;
    bloque.items.forEach((item) => {
      item.bloques.forEach((sub) => {
        if (sub.tipo === 'list') {
          emitirLista(sub, Math.min(nivel + 1, 8), atrs, numId);
          return;
        }
        if (sub.tipo !== 'paragraph') {
          emitir([sub], 0, false);
          return;
        }
        const atrsItem = Object.assign({}, atrs, { sangriaPrimera: 0, margenIzquierdo: 0 });
        parrafo(sub.hijos, atrsItem, {
          numeracion: { numId, nivel },
          pStyle: bloque.ordenada ? 'Lista numerada' : 'Lista',
        });
      });
    });
  }

  const unidadTab = anchoTabulador(hoja, base, opc);
  // Sangria francesa del verso que desborda, en em de cuerpo entero.
  const sangriaVerso =
    opc.sangriaVersoEm === undefined || opc.sangriaVersoEm === null
      ? 2 * (base.tamano || 12)
      : opc.sangriaVersoEm * (base.tamano || 12);

  function emitir(bloques, sangriaExtra, dentroDeCita) {
    let indiceParrafo = 0;
    let trasTitular = false;

    bloques.forEach((bloque) => {
      if (bloque.tipo === 'paragraph') bloque.trasTitular = trasTitular;
      const sels = selectoresDe(bloque, bloque.tipo === 'paragraph' ? indiceParrafo : 0);
      const atrs = D.atributos(hoja, sels, Object.assign({}, base));

      // Bibliografia sin selector en la hoja: sangria francesa por defecto.
      if (bloque.bibliografia && !hoja.bloque('paragraph-bibliography')) {
        const colgante = SANGRIA_BIBLIOGRAFIA;
        atrs.margenIzquierdo = (atrs.margenIzquierdo || 0) + colgante;
        atrs.sangriaPrimera = -colgante;
      }
      if (sangriaExtra) {
        atrs.margenIzquierdo = (atrs.margenIzquierdo || 0) + sangriaExtra;
      }

      switch (bloque.tipo) {
        case 'heading': {
          // «section-break: heading-1» hace que cada titular de ese nivel
          // arranque en pagina nueva, salvo el que abre el documento.
          const abreSeccion =
            pagina.saltoSeccion === `heading-${bloque.nivel}` && hayContenido && !dentroDeCita;
          if (abreSeccion) atrs.saltoPagina = 'before';
          parrafo(bloque.hijos, atrs, {
            keepNext: true,
            pStyle: nombreEstilo(hoja, sels, estiloDe(bloque)),
          });
          hayContenido = true;
          indiceParrafo = 0;
          trasTitular = true;
          break;
        }

        case 'paragraph': {
          const lineas = bloque.lineas || [{ hijos: bloque.hijos, tabs: 0, espacios: 0 }];
          const modo = modoDeLineas(bloque, opc);
          const nombre = nombreEstilo(hoja, sels, null);

          // Dialogo con raya: cada replica es un parrafo, sin sangria de
          // primera linea y con la vuelta alineada tras la raya.
          if (bloqueEsDialogo(bloque, opc)) {
            const g = sangriaDialogo(hoja, base);
            const atrsDia = D.atributos(
              hoja, ['paragraph', 'list-all', 'list-unordered'], Object.assign({}, base)
            );
            lineas.forEach((linea, k) => {
              const a = Object.assign({}, atrsDia, {
                margenIzquierdo: (atrs.margenIzquierdo || 0) + g.izquierda,
                sangriaPrimera: -g.colgante,
              });
              if (k > 0) a.margenSuperior = 0;
              if (k < lineas.length - 1) a.margenInferior = 0;
              parrafo(linea.hijos, a, nombre ? { pStyle: nombre } : null);
            });
            hayContenido = true;
            indiceParrafo++;
            trasTitular = false;
            break;
          }

          const conSangria = (a, linea, primera, ultima, esVerso) => {
            const b = Object.assign({}, a);
            const sangria = sangriaDeLinea(linea, unidadTab);
            if (sangria > 0) {
              b.margenIzquierdo = (b.margenIzquierdo || 0) + sangria;
              // Una linea sangrada con tabuladores no lleva ademas sangria
              // de primera linea: se sumarian y la escalera saldria torcida.
              b.sangriaPrimera = 0;
            }

            // Modo poema: el verso que no cabe continua sangrado, para que
            // la vuelta no se confunda con un verso nuevo. La sangria se
            // SUMA a la posicion de partida, no la sustituye: el verso
            // arranca donde arrancaria de todos modos.
            if (esVerso && sangriaVerso > 0) {
              const partida = (b.margenIzquierdo || 0) + (b.sangriaPrimera || 0);
              b.margenIzquierdo = partida + sangriaVerso;
              b.sangriaPrimera = -sangriaVerso;
            }

            if (!primera) b.margenSuperior = 0;
            if (!ultima) b.margenInferior = 0;
            return b;
          };

          if (modo === 'verso' && lineas.length > 1) {
            lineas.forEach((linea, k) => {
              parrafo(
                linea.hijos,
                conSangria(atrs, linea, k === 0, k === lineas.length - 1, true),
                nombre ? { pStyle: nombre } : null
              );
            });
          } else if (modo === 'parrafo') {
            const planos = [];
            lineas.forEach((l, k) => {
              planos.push(...l.hijos);
              if (k < lineas.length - 1) planos.push({ tipo: 'texto', valor: ' ' });
            });
            parrafo(planos, conSangria(atrs, lineas[0], true, true), nombre ? { pStyle: nombre } : null);
          } else {
            parrafo(
              bloque.hijos,
              conSangria(atrs, lineas[0], true, true),
              nombre ? { pStyle: nombre } : null
            );
          }

          hayContenido = true;
          indiceParrafo++;
          trasTitular = false;
          break;
        }

        case 'figure': {
          const nodo = { tipo: 'image', ruta: bloque.ruta, alt: bloque.alt };
          parrafo([nodo], atrs, null);
          if (bloque.alt) {
            const pie = D.atributos(hoja, ['paragraph', 'figure-caption'], Object.assign({}, base));
            parrafo([{ tipo: 'texto', valor: bloque.alt }], pie, { pStyle: 'Pie de imagen' });
          }
          indiceParrafo = 0;
          break;
        }

        case 'divider': {
          const salto = hoja.palabra('paragraph-divider', 'page-break', null);
          const visible = hoja.palabra('paragraph-divider', 'visibility', 'visible') !== 'hidden';
          const piezas = hoja.prop('paragraph-divider', 'content');
          const texto =
            piezas && piezas.length && piezas[0].tipo === 'cadena' ? piezas[0].valor : null;

          if (salto === 'after' || salto === 'before') {
            cuerpo.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
          }
          if (visible && texto) {
            // Novela imprime «*****» centrado en vez de una linea.
            const atrsDiv = D.atributos(hoja, ['paragraph', 'paragraph-divider'], Object.assign({}, base));
            atrsDiv.sangriaPrimera = 0;
            parrafo([{ tipo: 'texto', valor: texto }], atrsDiv, {
              pStyle: nombreEstilo(hoja, ['paragraph-divider'], 'Separador'),
            });
          } else if (!texto && salto !== 'after' && salto !== 'before') {
            cuerpo.push(
              `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>`
            );
          }
          indiceParrafo = 0;
          trasTitular = false;
          break;
        }

        case 'code': {
          const lineas = String(bloque.texto || '').split('\n');
          lineas.forEach((linea) => {
            parrafo([{ tipo: 'code', valor: linea || ' ' }], atrs, { pStyle: 'Bloque de código' });
          });
          indiceParrafo = 0;
          break;
        }

        case 'blockquote': {
          // Ulysses aplica el estilo de cita a cada parrafo de dentro
          // (cursiva y ambos margenes), no una sangria suelta.
          // «paragraph» va primero: en el PDF de Ulysses la cita conserva
          // la sangria de primera linea del parrafo (15mm de margen + 12,5
          // de sangria = 27,5mm en la primera linea).
          const atrsCita = D.atributos(
            hoja,
            ['paragraph', 'block-all', 'block-quote', 'block-quote paragraph'],
            Object.assign({}, base)
          );
          if (sangriaExtra) atrsCita.margenIzquierdo = (atrsCita.margenIzquierdo || 0) + sangriaExtra;
          bloque.bloques.forEach((sub) => {
            if (sub.tipo === 'paragraph') parrafo(sub.hijos, atrsCita, { pStyle: 'Bloque de cita' });
            else emitir([sub], (atrsCita.margenIzquierdo || 0), true);
          });
          indiceParrafo = 0;
          break;
        }

        case 'list':
          // Numeracion nativa de Word (numbering.xml), como hace Ulysses,
          // en vez de escribir la marca como texto del parrafo.
          emitirLista(bloque, 0, atrs);
          hayContenido = true;
          indiceParrafo = 0;
          break;

        case 'table':
          cuerpo.push(tablaDocx(bloque, hoja, base, ctx));
          indiceParrafo = 0;
          break;

        case 'comment': {
          // La hoja decide si los comentarios salen: Universidad los pone
          // visibles y en gris. El ajuste del plugin solo fuerza el «si».
          const visibleEnHoja = hoja.palabra('block-comment', 'visibility', 'hidden') === 'visible';
          if (visibleEnHoja || opc.incluirComentarios) {
            const atrsCom = D.atributos(hoja, ['paragraph', 'block-comment'], Object.assign({}, base));
            parrafo([{ tipo: 'texto', valor: bloque.texto }], atrsCom, { pStyle: 'Bloque de comentario' });
          }
          break;
        }

        default:
          break;
      }
    });
  }

  marcarBibliografia(documento.bloques, opc.encabezadosBibliografia);
  if (documento.bloques.length) documento.bloques[0].primeroDelDocumento = true;
  emitir(documento.bloques, 0, false);

  /* --- seccion --- */
  const cols =
    pagina.columnas > 1
      ? `<w:cols w:num="${pagina.columnas}" w:space="${D.twips(pagina.separacionColumnas)}"/>`
      : '<w:cols w:space="708"/>';

  // Numeracion: si la primera numerada es la 2 con el numero 1, la
  // primera hoja tiene que llevar el 0 y quedar oculta con «titlePg».
  const desde = Math.max(1, Math.round(opc.desdePagina || 1));
  const inicial = opc.numeroInicial === undefined ? 1 : Math.round(opc.numeroInicial);
  // Word solo sabe distinguir la PRIMERA pagina, y no admite numeros
  // negativos: con «desde» mayor que 2 el DOCX no puede reproducirlo del
  // todo, aunque la previsualizacion si.
  const arranque = Math.max(0, inicial - (desde - 1));
  const primeraDistinta = desde > 1 || pagina.piePrimeraPagina === 'none';

  const sectPr =
    `<w:sectPr>` +
    (pagina.piePagina === 'page-number'
      ? `<w:footerReference w:type="default" r:id="rId7"/>` +
        (primeraDistinta ? `<w:footerReference w:type="first" r:id="rId9"/>` : '')
      : '') +
    (primeraDistinta ? '<w:titlePg/>' : '') +
    `<w:pgSz w:w="${D.twips(pagina.ancho)}" w:h="${D.twips(pagina.alto)}"/>` +
    `<w:pgMar w:top="${D.twips(pagina.superior)}" w:right="${D.twips(pagina.exterior)}"` +
    ` w:bottom="${D.twips(pagina.inferior)}" w:left="${D.twips(pagina.interior)}"` +
    ` w:header="${D.twips(pagina.distanciaEncabezado)}"` +
    ` w:footer="${D.twips(pagina.distanciaPie)}" w:gutter="0"/>` +
    cols +
    `<w:pgNumType w:start="${arranque}"/>` +
    `</w:sectPr>`;

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document ${ESPACIOS_NOMBRES}><w:body>${cuerpo.join('')}${sectPr}</w:body></w:document>`;

  /* --- ficheros del paquete --- */
  const zip = new D.Zip();

  const tiposImagen = new Set(medios.map((m) => m.extension.toLowerCase()));
  const defectos = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>'];
  for (const ext of tiposImagen) {
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/png';
    defectos.push(`<Default Extension="${ext}" ContentType="${mime}"/>`);
  }

  zip.anadir(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      defectos.join('') +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>` +
      `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>` +
      `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>` +
      `<Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>` +
      `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
      `</Types>`
  );

  zip.anadir(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`
  );

  const relsDoc = [
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>`,
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>`,
    `<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`,
    `<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`,
    `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>`,
  ];
  for (const r of relaciones) {
    relsDoc.push(
      `<Relationship Id="${r.id}" Type="${r.tipo}" Target="${D.esc(r.destino)}"${r.externo ? ' TargetMode="External"' : ''}/>`
    );
  }
  zip.anadir(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsDoc.join('')}</Relationships>`
  );

  zip.anadir('word/document.xml', documentXml);
  zip.anadir('word/styles.xml', estilosXml(hoja, base));
  zip.anadir('word/settings.xml', ajustesXml(hoja, pagina));
  zip.anadir('word/footnotes.xml', notasXml(notas, hoja, base, ctx));
  zip.anadir('word/footer1.xml', pieXml(pagina, base));
  // Pie de la primera pagina: vacio, para portadas y preliminares.
  zip.anadir(
    'word/footer2.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${ESPACIOS_NOMBRES}><w:p/></w:ftr>`
  );
  zip.anadir('word/numbering.xml', numeracionXml(hoja, base, numeraciones));

  for (const m of medios) zip.anadir('word/' + m.nombre, m.datos);

  return zip.generar();
}

const ESPACIOS_NOMBRES =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

function tablaDocx(bloque, hoja, base, ctx) {
  const atrsCelda = D.atributos(hoja, ['table-cell'], Object.assign({}, base));
  // Los grosores de OOXML van en octavos de punto.
  const octavos = (pt, pordefecto) =>
    Math.max(2, Math.round((pt === null ? pordefecto : pt) * 8));

  const superior = octavos(hoja.puntos('table', 'border-top-width', 12, null), 1);
  const inferior = octavos(hoja.puntos('table', 'border-bottom-width', 12, null), 1);
  const estiloSup = hoja.palabra('table', 'border-top-style', 'solid');
  const estiloInf = hoja.palabra('table', 'border-bottom-style', 'solid');
  const val = (e) => (e === 'none' ? 'none' : e === 'double' ? 'double' : e === 'dashed' ? 'dashed' : 'single');

  // Separador bajo la fila de cabecera: la hoja lo declara en
  // «table-cell :header» o en «table-cell :header-row-boundary».
  const sepEstilo =
    hoja.palabra('table-cell :header-row-boundary', 'row-separator-style', null) ||
    hoja.palabra('table-cell :header', 'row-separator-style', null) ||
    hoja.palabra('table-cell :header-row', 'row-separator-style', null);
  const sepAncho =
    hoja.puntos('table-cell :header-row-boundary', 'row-separator-width', 12, null) ||
    hoja.puntos('table-cell :header', 'row-separator-width', 12, null) ||
    hoja.puntos('table-cell :header-row', 'row-separator-width', 12, null);
  const sepColor =
    hoja.color('table-cell :header-row-boundary', 'row-separator-color', null) ||
    hoja.color('table-cell :header', 'row-separator-color', null) ||
    hoja.color('table-cell :header-row', 'row-separator-color', null) ||
    '#000000';

  const padSup = hoja.puntos('table-cell', 'padding-top', 12, 0);
  const padInf = hoja.puntos('table-cell', 'padding-bottom', 12, 0);
  const padDer = hoja.puntos('table-cell', 'padding-right', 12, 0);
  const padIzq = hoja.puntos('table-cell', 'padding-left', 12, 0);

  const margenesCelda =
    `<w:tblCellMar>` +
    `<w:top w:w="${D.twips(padSup)}" w:type="dxa"/>` +
    `<w:left w:w="${D.twips(padIzq)}" w:type="dxa"/>` +
    `<w:bottom w:w="${D.twips(padInf)}" w:type="dxa"/>` +
    `<w:right w:w="${D.twips(padDer)}" w:type="dxa"/>` +
    `</w:tblCellMar>`;

  const fila = (celdas, cabecera) => {
    const atrs = cabecera
      ? D.atributos(hoja, ['table-cell', 'table-cell :header'], Object.assign({}, base))
      : atrsCelda;
    const bordeInferior =
      cabecera && sepEstilo && sepEstilo !== 'none'
        ? `<w:tcBorders><w:bottom w:val="${val(sepEstilo)}" w:sz="${octavos(sepAncho, 1)}"` +
          ` w:space="0" w:color="${D.esc(String(sepColor).replace('#', ''))}"/></w:tcBorders>`
        : '';
    const tds = celdas.map((nodos, i) => {
      const alineacion = bloque.alineaciones[i] || 'left';
      const local = Object.assign({}, atrs, { alineacion: D.ALINEACION[alineacion] || alineacion });
      const pPr = D.propiedadesParrafo(local, base, null);
      const runs = D.corridas(nodos, Object.assign({}, ctx, { atributos: local }), null);
      return `<w:tc><w:tcPr>${bordeInferior}</w:tcPr><w:p>${pPr}${runs.join('')}</w:p></w:tc>`;
    });
    return `<w:tr>${cabecera ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${tds.join('')}</w:tr>`;
  };

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="${val(estiloSup)}" w:sz="${superior}" w:space="0" w:color="auto"/>` +
    `<w:bottom w:val="${val(estiloInf)}" w:sz="${inferior}" w:space="0" w:color="auto"/>` +
    `</w:tblBorders>${margenesCelda}</w:tblPr>` +
    fila(bloque.cabecera, true) +
    bloque.filas.map((f) => fila(f, false)).join('') +
    `</w:tbl><w:p/>`
  );
}

/**
 * Genera styles.xml con estilos con nombre, como hace Ulysses: los
 * parrafos referencian «Encabezamiento 2» o «Bloque de cita», y el texto
 * «Fuerte» o «Enlace». Asi el DOCX es reestilizable en Word en vez de
 * llevar el formato incrustado en cada corrida.
 */
function estilosXml(hoja, base) {
  const fuente = (familia) => {
    const f = D.esc((familia || 'Times New Roman').split(',')[0].trim());
    return `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}" w:eastAsia="${f}"/>`;
  };

  // Propiedades que viven en el estilo (no varian por instancia).
  // «soloTexto» para los estilos de caracter: un <w:pPr> ahi no es valido.
  const cuerpoDeEstilo = (a, soloTexto) => {
    const pPr = [];
    if (a.mantenerJunto) pPr.push('<w:keepNext/>');
    if (a.interlineado) {
      pPr.push(`<w:spacing w:line="${D.twips(a.interlineado)}" w:lineRule="atLeast"/>`);
    }
    if (a.alineacion && a.alineacion !== 'left') pPr.push(`<w:jc w:val="${a.alineacion}"/>`);
    if (a.viudas === false) pPr.push('<w:widowControl w:val="false"/>');

    const rPr = [];
    if (a.familia) rPr.push(fuente(a.familia));
    if (a.tamano) rPr.push(`<w:sz w:val="${D.medioPunto(a.tamano)}"/><w:szCs w:val="${D.medioPunto(a.tamano)}"/>`);
    if (a.negrita) rPr.push('<w:b/>');
    if (a.cursiva) rPr.push('<w:i/>');
    if (a.subrayado) rPr.push('<w:u w:val="single"/>');
    if (a.tachado) rPr.push('<w:strike/>');
    if (a.fondo) rPr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${D.esc(String(a.fondo).replace('#', ''))}"/>`);
    if (a.color) rPr.push(`<w:color w:val="${D.esc(String(a.color).replace('#', ''))}"/>`);

    // Tambien aqui manda el orden del esquema.
    return (!soloTexto && pPr.length ? `<w:pPr>${D.ordenar(pPr, D.ORDEN_PPR).join('')}</w:pPr>` : '') +
      (rPr.length ? `<w:rPr>${D.ordenar(rPr, D.ORDEN_RPR).join('')}</w:rPr>` : '');
  };

  const estilos = [];

  estilos.push(
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:name w:val="Normal"/>${cuerpoDeEstilo(base)}</w:style>`
  );

  const parrafos = [
    ['Encabezamiento 1', ['heading-all', 'heading-1']],
    ['Encabezamiento 2', ['heading-all', 'heading-2']],
    ['Encabezamiento 3', ['heading-all', 'heading-3']],
    ['Encabezamiento 4', ['heading-all', 'heading-4']],
    ['Encabezamiento 5', ['heading-all', 'heading-5']],
    ['Encabezamiento 6', ['heading-all', 'heading-6']],
    ['Bloque de cita', ['block-all', 'block-quote', 'block-quote paragraph']],
    ['Bloque de código', ['block-all', 'block-code']],
    ['Bloque de comentario', ['paragraph', 'block-comment']],
    ['Separador', ['paragraph', 'paragraph-divider']],
    ['Pie de imagen', ['paragraph', 'figure-caption']],
    ['Lista', ['paragraph', 'list-all']],
    ['Lista numerada', ['paragraph', 'list-all', 'list-ordered']],
  ];

  for (const [nombre, selectores] of parrafos) {
    const a = D.atributos(hoja, selectores, Object.assign({}, base));
    estilos.push(
      `<w:style w:type="paragraph" w:styleId="${D.esc(nombre)}">` +
        `<w:name w:val="${D.esc(nombre)}"/><w:basedOn w:val="Normal"/>` +
        cuerpoDeEstilo(a) +
        `</w:style>`
    );
  }

  for (const clave of Object.keys(D.ESTILOS_INLINE)) {
    const def = D.ESTILOS_INLINE[clave];
    const a = D.atributos(hoja, [def.selector], Object.assign({}, base));
    const conDefecto = Object.assign({}, a);
    for (const [k, v] of Object.entries(def.porDefecto || {})) {
      if (conDefecto[k] === null || conDefecto[k] === undefined) conDefecto[k] = v;
    }
    // La familia solo se declara si difiere de la del documento.
    if (conDefecto.familia === base.familia) conDefecto.familia = null;
    estilos.push(
      `<w:style w:type="character" w:styleId="${D.esc(def.nombre)}">` +
        `<w:name w:val="${D.esc(def.nombre)}"/><w:basedOn w:val="Normal"/>` +
        cuerpoDeEstilo(conDefecto, true) +
        `</w:style>`
    );
  }

  const familia = D.esc((base.familia || 'Times New Roman').split(',')[0].trim());
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles ${ESPACIOS_NOMBRES}><w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="${familia}" w:hAnsi="${familia}" w:cs="${familia}" w:eastAsia="${familia}"/>` +
    `<w:sz w:val="${D.medioPunto(base.tamano || 12)}"/>` +
    `<w:szCs w:val="${D.medioPunto(base.tamano || 12)}"/>` +
    `</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>` +
    `<w:spacing w:after="0" w:line="${D.twips(base.interlineado || 0)}" w:lineRule="atLeast"/>` +
    (base.alineacion && base.alineacion !== 'left' ? `<w:jc w:val="${base.alineacion}"/>` : '') +
    `</w:pPr></w:pPrDefault></w:docDefaults>` +
    estilos.join('') +
    `</w:styles>`
  );
}

// Formatos de numeracion de nota al pie de Ulysses -> los de OOXML.
const FORMATO_NOTA = {
  decimal: 'decimal',
  roman: 'lowerRoman',
  'roman-upper': 'upperRoman',
  alpha: 'lowerLetter',
  'alpha-upper': 'upperLetter',
  symbol: 'chicago',
  asterisk: 'chicago',
};

function ajustesXml(hoja, pagina) {
  const guionado = hoja.bandera('defaults', 'hyphenation', false);
  const formato = FORMATO_NOTA[(pagina && pagina.notaFormato) || 'decimal'] || 'decimal';
  const posicion =
    pagina && pagina.notaColocacion === 'end-of-document' ? 'sectEnd' : 'pageBottom';
  const reinicio =
    pagina && pagina.notaEnumeracion === 'per-section' ? 'eachSect' : 'continuous';
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:settings ${ESPACIOS_NOMBRES}>` +
    (guionado ? '<w:autoHyphenation w:val="true"/>' : '') +
    `<w:footnotePr><w:footnotePosition w:val="${posicion}"/>` +
    `<w:numFmt w:val="${formato}"/><w:numRestart w:val="${reinicio}"/></w:footnotePr>` +
    `</w:settings>`
  );
}

function notasXml(notas, hoja, base, ctx) {
  const atrs = D.atributos(hoja, ['area-footnotes'], Object.assign({}, base));
  const cuerpos = notas.map((n) => {
    const pPr = D.propiedadesParrafo(atrs, base, null);
    const runs = D.corridas(n.contenido, Object.assign({}, ctx, { atributos: atrs }), null);
    return `<w:footnote w:id="${n.num}"><w:p>${pPr}<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>${runs.join('')}</w:p></w:footnote>`;
  });
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:footnotes ${ESPACIOS_NOMBRES}>` +
    `<w:footnote w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="1"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    cuerpos.join('') +
    `</w:footnotes>`
  );
}

/**
 * Traduce el formato de numeracion de Ulysses al de OOXML.
 *   «%d»  -> el numero de este nivel        -> %N
 *   «%*»  -> el texto del nivel padre       -> se expande en cascada
 * Cualquier otro caracter es literal («-», «*», «.»).
 */
function formatoNivel(hoja, ordenada, nivel) {
  const cadena = (n) => {
    const sel = new Array(n + 1).fill(ordenada ? 'list-ordered' : 'list-unordered').join(' ');
    return hoja.palabra(sel, 'enumeration-format', null);
  };

  const expandir = (n) => {
    let f = cadena(n);
    if (f === null) f = ordenada ? '%d.' : '-';
    if (f.includes('%*')) {
      const padre = n > 0 ? expandir(n - 1) : '';
      f = f.split('%*').join(padre);
    }
    // El «%d» de este nivel pasa a ser «%N» de OOXML (1-indexado)
    let indice = 0;
    return f.replace(/%d/g, () => {
      indice++;
      return `%${n + 1}`;
    });
  };

  return expandir(nivel);
}

/**
 * Sangria de cada nivel de lista, calibrada contra el PDF de Ulysses:
 *
 *   marcador nivel 0 -> 14 pt    texto nivel 1 -> 76 pt
 *   marcador nivel 1 -> 28 pt    texto nivel 2 -> 114 pt
 *   marcador nivel 2 -> 42 pt
 *
 * De ahi salen dos reglas que no estaban en la documentacion:
 *   1. El «margin-left» de list-all se ACUMULA en cada nivel de anidado
 *      (5mm = 14,17pt -> 14 / 28 / 42).
 *   2. «text-inset» mide en em de 1,0 x cuerpo, no en los 0,6 que usan
 *      los margenes: 4em -> 48pt y 6em -> 72pt sobre un cuerpo de 12pt.
 */
function sangriaNivel(hoja, base, ordenada, nivel) {
  const ctx = base.tamano || 12;

  const cadena = (n, palabra) => new Array(n + 1).fill(palabra).join(' ');

  // Margen acumulado: cada nivel vuelve a aplicar el de list-all.
  let marcador = 0;
  for (let k = 0; k <= nivel; k++) {
    let v = hoja.puntos(cadena(k, 'list-all'), 'margin-left', ctx, null);
    if (v === null) v = hoja.puntos('list-all', 'margin-left', ctx, null);
    marcador += v === null ? 18 : v;
  }

  // text-inset: em de cuerpo entero, con respaldo en el nivel anterior.
  const selLista = cadena(nivel, ordenada ? 'list-ordered' : 'list-unordered');
  let piezas = hoja.prop(selLista, 'text-inset');
  for (let k = nivel - 1; k >= 0 && !piezas; k--) {
    piezas = hoja.prop(cadena(k, ordenada ? 'list-ordered' : 'list-unordered'), 'text-inset');
  }
  let inset = null;
  if (piezas && piezas.length) {
    const v = piezas[0];
    inset = v.unidad === 'em' ? v.numero * ctx : ULSS.aPuntos(v, ctx);
  }
  if (inset === null) inset = 18;

  return { izquierda: marcador + inset, colgante: inset, marcador };
}

function numeracionXml(hoja, base, numeraciones) {
  const familia = D.esc((base.familia || 'Times New Roman').split(',')[0].trim());

  const niveles = (ordenada) => {
    let out = '';
    for (let i = 0; i < 9; i++) {
      const texto = formatoNivel(hoja, ordenada, i);
      const { izquierda, colgante } = sangriaNivel(hoja, base, ordenada, i);
      const esNumero = /%\d/.test(texto);
      out +=
        `<w:lvl w:ilvl="${i}"><w:start w:val="1"/>` +
        `<w:numFmt w:val="${esNumero ? 'decimal' : 'bullet'}"/>` +
        `<w:lvlText w:val="${D.esc(texto)}"/><w:lvlJc w:val="left"/>` +
        `<w:pPr><w:ind w:left="${D.twips(izquierda)}" w:hanging="${D.twips(colgante)}"/></w:pPr>` +
        `<w:rPr><w:rFonts w:ascii="${familia}" w:hAnsi="${familia}"/></w:rPr></w:lvl>`;
    }
    return out;
  };

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:numbering ${ESPACIOS_NOMBRES}>` +
    `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${niveles(false)}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${niveles(true)}</w:abstractNum>` +
    (numeraciones && numeraciones.length
      ? numeraciones
          .map((n) => `<w:num w:numId="${n.numId}"><w:abstractNumId w:val="${n.ordenada ? 1 : 0}"/></w:num>`)
          .join('')
      : `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
        `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>`) +
    `</w:numbering>`
  );
}

function pieXml(pagina, base) {
  const jc = D.ALINEACION[pagina.alineacionPie] || 'center';
  const familia = D.esc((base.familia || 'Times New Roman').split(',')[0].trim());
  if (pagina.piePagina !== 'page-number') {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${ESPACIOS_NOMBRES}><w:p/></w:ftr>`;
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:ftr ${ESPACIOS_NOMBRES}><w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="${familia}" w:hAnsi="${familia}"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`
  );
}

/* ------------------------------------------------------------------ *
 * CSS / HTML (para PDF por impresion)
 * ------------------------------------------------------------------ */

const SUSTITUTOS = {
  'avenir next': '"Avenir Next", Avenir, "Nimbus Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
  avenir: 'Avenir, "Nimbus Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
  optima: 'Optima, "URW Classico", Candara, "Gill Sans", "Gill Sans MT", sans-serif',
  baskerville: 'Baskerville, "Libre Baskerville", Baskervville, "Nimbus Roman", "Liberation Serif", "Times New Roman", serif',
  'hoefler text': '"Hoefler Text", "Playfair Display", Georgia, "Liberation Serif", "Times New Roman", serif',
  'times new roman': '"Times New Roman", "Liberation Serif", "Nimbus Roman", Times, serif',
  'courier new': '"Courier New", "Liberation Mono", "Nimbus Mono PS", Courier, monospace',
  'helvetica neue': '"Helvetica Neue", "Nimbus Sans", "Liberation Sans", Helvetica, Arial, sans-serif',
  'gill sans': '"Gill Sans", "Gill Sans MT", "URW Classico", Calibri, sans-serif',
  palatino: 'Palatino, "URW Palladio L", "Palatino Linotype", "Liberation Serif", serif',
};

/** Convierte la familia de la hoja en una pila con alternativas reales. */
function pilaTipografica(familia) {
  if (!familia) return null;
  const primera = familia.split(',')[0].trim().replace(/^["']|["']$/g, '');
  const sustituto = SUSTITUTOS[primera.toLowerCase()];
  if (sustituto) return sustituto;
  return `"${primera}", serif`;
}

const pt = (v) => `${Math.round((v || 0) * 1000) / 1000}pt`;

function reglasDe(hoja, selectores, base, selectorCss) {
  const a = D.atributos(hoja, selectores, Object.assign({}, base));
  const decl = [];
  const pila = pilaTipografica(a.familia);
  if (pila && a.familia !== base.familia) decl.push(`font-family: ${pila}`);
  // Ojo con el cero: «font-size: 0pt» es como Filmscript esconde un
  // titular, y con una comprobacion de verdad/falsedad se perdia.
  if (a.tamano !== null && a.tamano !== undefined) decl.push(`font-size: ${pt(a.tamano)}`);
  if (a.interlineado !== null && a.interlineado !== undefined) {
    decl.push(`line-height: ${pt(a.interlineado)}`);
  }
  if (a.negrita !== null) decl.push(`font-weight: ${a.negrita ? 'bold' : 'normal'}`);
  if (a.cursiva !== null) decl.push(`font-style: ${a.cursiva ? 'italic' : 'normal'}`);
  if (a.alineacion) decl.push(`text-align: ${a.alineacion === 'both' ? 'justify' : a.alineacion}`);
  // Relleno, no margen: en CSS los margenes verticales de bloques
  // contiguos COLAPSAN al mayor, mientras que Word los SUMA. Con margen,
  // dos parrafos de 1mm arriba y 1mm abajo quedaban a 1mm en vez de 2.
  decl.push(`padding-top: ${pt(a.margenSuperior || 0)}`);
  decl.push(`padding-bottom: ${pt(a.margenInferior || 0)}`);
  decl.push('margin-top: 0', 'margin-bottom: 0');
  if (a.margenIzquierdo) decl.push(`margin-left: ${pt(a.margenIzquierdo)}`);
  if (a.margenDerecho) decl.push(`margin-right: ${pt(a.margenDerecho)}`);
  // Un cero explicito importa: «paragraph :first» suele pedir 0 y hay que
  // decirlo, no dejarlo a que lo herede otra regla.
  if (a.sangriaPrimera !== null && a.sangriaPrimera !== undefined) {
    decl.push(`text-indent: ${pt(a.sangriaPrimera)}`);
  }
  if (a.saltoPagina === 'before') decl.push('break-before: page');
  if (a.saltoPagina === 'after') decl.push('break-after: page');
  if (a.mantenerJunto) decl.push('break-after: avoid');
  if (a.color) decl.push(`color: ${a.color}`);
  return `${selectorCss} { ${decl.join('; ')} }`;
}

/**
 * Traduce el formato de numeracion a un «content» de CSS.
 *   «%1.»      -> counter(ulxo0) "."
 *   «%1.%2»    -> counter(ulxo0) "." counter(ulxo1)
 *   «-»        -> "-"
 */
function contenidoMarcador(formato, ordenada) {
  if (!ordenada) return JSON.stringify(String(formato));
  const partes = [];
  const re = /%(\d)/g;
  let ultimo = 0;
  let m;
  while ((m = re.exec(formato))) {
    const literal = formato.slice(ultimo, m.index);
    if (literal) partes.push(JSON.stringify(literal));
    partes.push(`counter(ulxo${Number(m[1]) - 1})`);
    ultimo = m.index + m[0].length;
  }
  const cola = formato.slice(ultimo);
  if (cola) partes.push(JSON.stringify(cola));
  return partes.length ? partes.join(' ') : '""';
}

function construirCss(hoja, opciones) {
  const opc = opciones || {};
  const pagina = ajustesPagina(hoja, opc.tamanoPagina);
  const base = D.atributosBase(hoja);
  const pilaBase = pilaTipografica(base.familia) || 'serif';
  const guionado = hoja.bandera('defaults', 'hyphenation', false);

  const reglas = [];

  reglas.push(
    `@page { size: ${pt(pagina.ancho)} ${pt(pagina.alto)}; ` +
      `margin: ${pt(pagina.superior)} ${pt(pagina.exterior)} ${pt(pagina.inferior)} ${pt(pagina.interior)}; }`
  );

  // La familia va tambien en html/body: si no, Chromium incrusta su
  // Times-Roman por defecto para el contenido que quede fuera de
  // «.ulysses», y aparece una tipografia de reserva en el PDF.
  reglas.push(
    `html, body { margin: 0; padding: 0; background: #fff; color: #000; ` +
      `font-family: ${pilaBase}; }`
  );
  reglas.push(
    `.ulysses { font-family: ${pilaBase}; font-size: ${pt(base.tamano)}; ` +
      (base.interlineado ? `line-height: ${pt(base.interlineado)}; ` : '') +
      `text-align: ${base.alineacion === 'both' ? 'justify' : base.alineacion || 'left'}; ` +
      `hyphens: ${guionado ? 'auto' : 'manual'}; -webkit-hyphens: ${guionado ? 'auto' : 'manual'}; ` +
      // Ultimo recurso para lo que no se puede partir: una racha de
      // espacios duros o una URL larga desbordan la caja, y entonces el
      // motor de impresion encoge TODO el documento para que quepa, lo
      // que altera interlineado, espacios y numero de paginas.
      `overflow-wrap: break-word; ` +
      `orphans: 2; widows: 2; }`
  );

  if (pagina.columnas > 1) {
    reglas.push(
      `.ulysses { column-count: ${pagina.columnas}; column-gap: ${pt(pagina.separacionColumnas)}; }`
    );
  }

  for (let n = 1; n <= 6; n++) {
    reglas.push(reglasDe(hoja, ['heading-all', `heading-${n}`], base, `.ulysses h${n}`));
  }
  if (pagina.saltoSeccion === 'heading-1') {
    reglas.push(`.ulysses h1 { break-before: page; }`);
    reglas.push(`.ulysses h1:first-child { break-before: avoid; }`);
  }

  // El primer parrafo de cada tramo lleva «paragraph :first»; los que van
  // detras de otro parrafo, «paragraph + paragraph». Es la misma logica
  // que aplica el emisor de DOCX: sin esto, la prosa inicial salia
  // sangrada aunque el estilo dijera que no.
  reglas.push(reglasDe(hoja, ['paragraph'], base, '.ulysses p'));
  if (hoja.bloque('paragraph :first')) {
    reglas.push(reglasDe(hoja, ['paragraph', 'paragraph :first'], base, '.ulysses > p:first-child'));
  }
  reglas.push(reglasDe(hoja, ['paragraph', 'paragraph + paragraph'], base, '.ulysses p + p'));
  if (hoja.bloque('heading-all + paragraph')) {
    const trasTitular = [1, 2, 3, 4, 5, 6].map((n) => `.ulysses h${n} + p`).join(', ');
    reglas.push(reglasDe(hoja, ['paragraph', 'heading-all + paragraph'], base, trasTitular));
  }
  // Misma cadena que usa el emisor de DOCX, o los margenes no coinciden.
  reglas.push(
    reglasDe(hoja, ['paragraph', 'block-all', 'block-quote'], base, '.ulysses blockquote')
  );
  reglas.push(reglasDe(hoja, ['paragraph', 'block-all', 'block-code'], base, '.ulysses pre'));
  reglas.push(reglasDe(hoja, ['paragraph', 'paragraph-figure'], base, '.ulysses figure'));
  reglas.push(reglasDe(hoja, ['paragraph', 'figure-caption'], base, '.ulysses figcaption'));

  const citaParrafo = hoja.bloque('block-quote paragraph');
  if (citaParrafo) {
    reglas.push(reglasDe(hoja, ['block-quote paragraph'], base, '.ulysses blockquote p'));
  }

  // La familia del codigo se resuelve por la cadena, igual que en el DOCX:
  // «hoja.familia('block-code')» devuelve null cuando la hereda, y acabar
  // en «monospace» contradice al estilo (Novela usa Baskerville).
  const atrsCodigo = D.atributos(hoja, ['block-all', 'block-code'], Object.assign({}, base));
  const familiaCodigo = pilaTipografica(atrsCodigo.familia) || 'monospace';
  reglas.push(`.ulysses pre, .ulysses code { font-family: ${familiaCodigo}; white-space: pre-wrap; }`);

  const anchoBorde = hoja.puntos('table', 'border-top-width', 12, 1);
  reglas.push(
    `.ulysses table { width: 100%; border-collapse: collapse; ` +
      `border-top: ${pt(anchoBorde)} solid #000; border-bottom: ${pt(anchoBorde)} solid #000; }`
  );
  const padSup = hoja.puntos('table-cell', 'padding-top', 12, 4);
  const padInf = hoja.puntos('table-cell', 'padding-bottom', 12, 4);
  reglas.push(`.ulysses th, .ulysses td { padding: ${pt(padSup)} 6pt ${pt(padInf)} 0; text-align: left; }`);
  reglas.push(`.ulysses th { font-weight: bold; }`);

  // Bibliografia (extension del plugin, ver marcarBibliografia)
  if (hoja.bloque('paragraph-bibliography')) {
    reglas.push(reglasDe(hoja, ['paragraph', 'paragraph-bibliography'], base, '.ulysses p.bibliografia'));
  } else {
    reglas.push(
      `.ulysses p.bibliografia { margin-left: ${pt(SANGRIA_BIBLIOGRAFIA)}; ` +
        `text-indent: -${pt(SANGRIA_BIBLIOGRAFIA)}; }`
    );
  }

  // Los versos van juntos, sin el espacio entre parrafos de la prosa.
  {
    const sv =
      opc.sangriaVersoEm === undefined || opc.sangriaVersoEm === null ? 2 : opc.sangriaVersoEm;
    const pts = sv * (base.tamano || 12);
    // Ojo: el margen se quita ENTRE versos, no en el primero de cada
    // estrofa, o las estrofas se pegan unas a otras.
    reglas.push(
      `.ulysses p.verso { padding-bottom: 0; break-inside: avoid; ` +
        `padding-left: ${pt(pts)}; text-indent: -${pt(pts)}; }`
    );
    // El margen se quita ENTRE versos de la misma estrofa: el primero de
    // cada estrofa lleva «verso-ini» y conserva el suyo.
    reglas.push(`.ulysses p.verso + p.verso:not(.verso-ini) { padding-top: 0; }`);
  }


  reglas.push(`.ulysses img { max-width: 100%; height: auto; }`);
  reglas.push(`.ulysses hr { border: none; border-top: 0.5pt solid #000; }`);
  reglas.push(reglasDe(hoja, ['paragraph', 'paragraph-divider'], base, '.ulysses p.divisor'));
  reglas.push(`.ulysses p.divisor { text-indent: 0; }`);
  // Un bloque vacio de altura cero puede no generar corte, asi que el
  // salto se pide tambien sobre el elemento siguiente.
  reglas.push(`.ulysses .salto-pagina { display: block; height: 0; break-after: page; }`);
  reglas.push(`.ulysses .salto-pagina + * { break-before: page; }`);
  if (hoja.bloque('block-comment')) {
    reglas.push(reglasDe(hoja, ['paragraph', 'block-comment'], base, '.ulysses p.comentario'));
  }
  reglas.push(`.ulysses a { color: inherit; text-decoration: none; }`);
  // Las listas siguen la hoja: marca de «enumeration-format» y sangria de
  // «text-inset», igual que en el D. Antes se dejaban al navegador.
  reglas.push(`.ulysses ul, .ulysses ol { margin: 0; padding-top: 0; padding-bottom: 0; }`);
  reglas.push(reglasDe(hoja, ['paragraph', 'list-all', 'list-all paragraph'], base, '.ulysses li'));
  reglas.push(`.ulysses li { text-indent: 0; }`);
  reglas.push(`.ulysses li > p { margin: 0; padding: 0; text-indent: 0; }`);
  {
    // El dialogo con raya, con la misma geometria que la lista del estilo.
    const g = sangriaDialogo(hoja, base);
    reglas.push(
      reglasDe(hoja, ['paragraph', 'list-all', 'list-unordered'], base, '.ulysses p.dialogo')
    );
    reglas.push(
      `.ulysses p.dialogo { margin-left: ${pt(g.izquierda)}; ` +
        `text-indent: -${pt(g.colgante)}; padding-bottom: 0; }`
    );
    reglas.push(`.ulysses p.dialogo + p.dialogo:not(.dialogo-ini) { padding-top: 0; }`);
  }
  reglas.push(`.ulysses li > ul, .ulysses li > ol { margin-top: 0; }`);
  for (let n = 0; n < 3; n++) {
    for (const ordenada of [false, true]) {
      const etiqueta = ordenada ? 'ol' : 'ul';
      const sel = '.ulysses ' + `${etiqueta} `.repeat(n + 1).trim().split(' ').join(' ');
      const { izquierda, colgante } = sangriaNivel(hoja, base, ordenada, n);
      // En CSS los rellenos se acumulan al anidar, asi que a partir del
      // segundo nivel se aplica solo la diferencia con el anterior.
      const previa = n === 0 ? 0 : sangriaNivel(hoja, base, ordenada, n - 1).izquierda;
      const relleno = Math.max(0, izquierda - previa);
      const formato = formatoNivel(hoja, ordenada, n);
      const contador = `ulx${ordenada ? 'o' : 'u'}${n}`;

      reglas.push(
        `${sel} { list-style: none; padding-left: ${pt(relleno)}; ` +
          (ordenada ? `counter-reset: ${contador}; ` : '') +
          `}`
      );
      reglas.push(
        `${sel} > li { text-indent: -${pt(colgante)}; ` +
          (ordenada ? `counter-increment: ${contador}; ` : '') +
          `}`
      );
      reglas.push(
        `${sel} > li::before { content: ${contenidoMarcador(formato, ordenada)}; ` +
          `display: inline-block; width: ${pt(colgante)}; text-indent: 0; }`
      );
    }
  }

  const marca = hoja.variables && hoja.variables['mark-color'];
  reglas.push(`.ulysses mark { background: ${marca ? '#FEFDD5' : '#FEFDD5'}; }`);

  const tamNota = hoja.puntos('area-footnotes', 'font-size', 12, 9);
  const interNota = hoja.puntos('area-footnotes', 'line-height', tamNota, 12);
  reglas.push(
    `.ulysses .notas { font-size: ${pt(tamNota)}; line-height: ${pt(interNota)}; ` +
      `margin-top: 24pt; border-top: 0.5pt solid #000; padding-top: 8pt; }`
  );
  reglas.push(`.ulysses sup a { text-decoration: none; }`);

  if (pagina.piePagina === 'page-number') {
    reglas.push(`@page { @bottom-${pagina.alineacionPie === 'right' ? 'right' : 'center'} { content: counter(page); } }`);
  }

  // Previsualizacion en pantalla: el @page solo existe al imprimir, asi
  // que montamos la hoja de papel a mano. El texto se pagina de verdad
  // con columnas (una columna = una pagina) y se muestra de una en una.
  if (opc.previsualizacion) {
    const utilAncho = pagina.ancho - pagina.interior - pagina.exterior;
    const utilAlto = pagina.alto - pagina.superior - pagina.inferior;
    const tamPie = hoja.puntos('area-footer', 'font-size', base.tamano || 12, 9);
    const tamCab = hoja.puntos('area-header', 'font-size', base.tamano || 12, 9);
    const aliPie = { center: 'center', right: 'right', left: 'left', justified: 'justify' }[
      pagina.alineacionPie
    ] || 'center';
    const aliCab = { center: 'center', right: 'right', left: 'left', justified: 'justify' }[
      pagina.alineacionEncabezado
    ] || 'center';

    reglas.push(
      `html { background: #8a8a8a; }`,
      `body { padding: 14pt; display: flex; flex-direction: column; align-items: center; gap: 10pt; }`,
      `.visor { width: ${pt(pagina.ancho)}; height: ${pt(pagina.alto)}; background: #fff; ` +
        `position: relative; overflow: hidden; box-shadow: 0 2pt 18pt rgba(0,0,0,.4); flex: 0 0 auto; }`,
      `.ventana { position: absolute; left: ${pt(pagina.interior)}; top: ${pt(pagina.superior)}; ` +
        `width: ${pt(utilAncho)}; height: ${pt(utilAlto)}; overflow: hidden; }`,
      `.ulysses { columns: ${pt(utilAncho)}; column-gap: 60pt; column-fill: auto; ` +
        `height: ${pt(utilAlto)}; width: auto; }`,
      // Dentro de columnas, un salto de pagina es un salto de columna.
      `.ulysses .salto-pagina { break-after: column; }`,
      `.ulysses .salto-pagina + * { break-before: column; }`,
      // Y el divisor de texto se ve tal cual, centrado como pida la hoja.
      `.ulysses p.divisor { break-inside: avoid; }`,
      `.pie { position: absolute; left: ${pt(pagina.interior)}; width: ${pt(utilAncho)}; ` +
        `bottom: ${pt(Math.max(4, pagina.distanciaPie))}; text-align: ${aliPie}; ` +
        `font-size: ${pt(tamPie)}; color: #000; }`,
      `.cabecera { position: absolute; left: ${pt(pagina.interior)}; width: ${pt(utilAncho)}; ` +
        `top: ${pt(Math.max(4, pagina.distanciaEncabezado))}; text-align: ${aliCab}; ` +
        `font-size: ${pt(tamCab)}; color: #000; }`,
      `.guias .ventana { outline: 1px dashed rgba(0,120,255,.45); }`,
      `.mandos { display: flex; align-items: center; gap: 10pt; color: #fff; ` +
        `font: 10pt/1.4 -apple-system, system-ui, sans-serif; }`,
      `.mandos button { font: inherit; padding: 2pt 9pt; border: 0; border-radius: 4pt; ` +
        `background: rgba(255,255,255,.9); cursor: pointer; }`,
      `.mandos button:disabled { opacity: .35; cursor: default; }`
    );
  }

  return reglas.join('\n');
}

/* ------------------------------------------------------------------ *
 * HTML
 * ------------------------------------------------------------------ */

function escHtml(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineHtml(nodos, opc) {
  let s = '';
  for (const nodo of nodos || []) {
    switch (nodo.tipo) {
      case 'texto':
        s += escHtml(nodo.valor);
        break;
      case 'salto':
        s += '<br/>';
        break;
      case 'strong':
        s += `<strong>${inlineHtml(nodo.hijos, opc)}</strong>`;
        break;
      case 'em':
        s += `<em>${inlineHtml(nodo.hijos, opc)}</em>`;
        break;
      case 'del':
        s += `<del>${inlineHtml(nodo.hijos, opc)}</del>`;
        break;
      case 'mark':
        s += `<mark>${inlineHtml(nodo.hijos, opc)}</mark>`;
        break;
      case 'code':
        s += `<code>${escHtml(nodo.valor)}</code>`;
        break;
      case 'link':
        s += `<a href="${escHtml(nodo.destino)}">${inlineHtml(nodo.hijos, opc)}</a>`;
        break;
      case 'wikilink':
        s += escHtml(nodo.alias || nodo.destino);
        break;
      case 'footnote':
        s += `<sup><a href="#nota-${escHtml(nodo.id)}" id="ref-${escHtml(nodo.id)}">${escHtml(nodo.id)}</a></sup>`;
        break;
      case 'image': {
        const src = opc && opc.recursoUrl ? opc.recursoUrl(nodo.ruta) : nodo.ruta;
        s += `<img src="${escHtml(src)}" alt="${escHtml(nodo.alt || '')}"/>`;
        break;
      }
      default:
        if (nodo.hijos) s += inlineHtml(nodo.hijos, opc);
    }
  }
  return s;
}

function bloquesHtml(bloques, opc) {
  let s = '';
  for (const b of bloques || []) {
    switch (b.tipo) {
      case 'heading':
        s += `<h${b.nivel}>${inlineHtml(b.hijos, opc)}</h${b.nivel}>`;
        break;
      case 'paragraph': {
        const clase = b.bibliografia ? ' class="bibliografia"' : '';
        const lineas = b.lineas || [{ hijos: b.hijos, tabs: 0, espacios: 0 }];
        const modo = modoDeLineas(b, opc);

        // Sin envoltorio: un <div> alrededor rompe «p + p», y el parrafo
        // que viene detras pierde su sangria de primera linea.
        if (opc && opc.esDialogo && opc.esDialogo(b)) {
          lineas.forEach((l, k) => {
            const c = k === 0 ? 'dialogo dialogo-ini' : 'dialogo';
            s += `<p class="${c}">${inlineHtml(l.hijos, opc)}</p>`;
          });
          break;
        }
        const unidad = (opc && opc.unidadTabPt) || 0;
        const estilo = (l) => {
          const sang = sangriaDeLinea(l, unidad);
          return sang > 0
            ? ` style="margin-left:${Math.round(sang * 100) / 100}pt;text-indent:0"`
            : '';
        };
        if (modo === 'verso' && lineas.length > 1) {
          lineas.forEach((l, k) => {
            const c = k === 0 ? 'verso verso-ini' : 'verso';
            const cl = clase ? clase.replace('"', `"${c} `) : ` class="${c}"`;
            s += `<p${cl}${estilo(l)}>${inlineHtml(l.hijos, opc)}</p>`;
          });
        } else {
          s += `<p${clase}${estilo(lineas[0])}>${inlineHtml(b.hijos, opc)}</p>`;
        }
        break;
      }
      case 'blockquote':
        s += `<blockquote>${bloquesHtml(b.bloques, opc)}</blockquote>`;
        break;
      case 'code':
        s += `<pre><code>${escHtml(b.texto)}</code></pre>`;
        break;
      case 'divider': {
        // El divisor lo define la hoja: puede ser un texto («*****» en
        // Novela), un salto de pagina (Swiss Knife, Universidad) o una
        // linea. Antes aqui salia siempre <hr/>, que no es ninguno de los
        // tres salvo por casualidad.
        const d = (opc && opc.divisor) || { tipo: 'linea' };
        if (d.tipo === 'salto') s += '<div class="salto-pagina"></div>';
        else if (d.tipo === 'texto') s += `<p class="divisor">${escHtml(d.texto)}</p>`;
        else if (d.tipo !== 'oculto') s += '<hr/>';
        break;
      }
      case 'figure': {
        const src = opc && opc.recursoUrl ? opc.recursoUrl(b.ruta) : b.ruta;
        s += `<figure><img src="${escHtml(src)}" alt="${escHtml(b.alt || '')}"/>`;
        if (b.alt) s += `<figcaption>${escHtml(b.alt)}</figcaption>`;
        s += '</figure>';
        break;
      }
      case 'list': {
        const et = b.ordenada ? 'ol' : 'ul';
        s += `<${et}>`;
        for (const item of b.items) {
          // El primer parrafo del elemento se emite en linea. Envuelto en
          // <p>, que es de bloque, la marca de la lista caia en una linea
          // y el texto en la siguiente.
          const bloquesItem = item.bloques || [];
          let dentro = '';
          bloquesItem.forEach((sub, k) => {
            if (k === 0 && sub.tipo === 'paragraph') dentro += inlineHtml(sub.hijos, opc);
            else dentro += bloquesHtml([sub], opc);
          });
          s += `<li>${dentro}</li>`;
        }
        s += `</${et}>`;
        break;
      }
      case 'table': {
        s += '<table><thead><tr>';
        b.cabecera.forEach((c, i) => {
          s += `<th style="text-align:${b.alineaciones[i] || 'left'}">${inlineHtml(c, opc)}</th>`;
        });
        s += '</tr></thead><tbody>';
        for (const fila of b.filas) {
          s += '<tr>';
          fila.forEach((c, i) => {
            s += `<td style="text-align:${b.alineaciones[i] || 'left'}">${inlineHtml(c, opc)}</td>`;
          });
          s += '</tr>';
        }
        s += '</tbody></table>';
        break;
      }
      case 'comment':
        if (opc && opc.comentariosVisibles) s += `<p class="comentario">${escHtml(b.texto)}</p>`;
        else if (opc && opc.incluirComentarios) s += `<!-- ${escHtml(b.texto)} -->`;
        break;
      default:
        break;
    }
  }
  return s;
}

/*
 * Paginador de la previsualizacion. Va dentro del iframe: mide cuantas
 * columnas ha generado el navegador (una por pagina), desplaza el texto
 * para mostrar la que toca y dibuja el pie con su numero.
 */
const GUION_PAGINADOR = `
(function () {
  var cfg = __AJUSTES__;
  var art = document.querySelector('.ulysses');
  var pie = document.querySelector('.pie');
  var cab = document.querySelector('.cabecera');
  var cuenta = document.querySelector('.cuenta');
  var paso = cfg.anchoColumna + cfg.hueco;
  var actual = 0;
  var total = 1;

  function medir() {
    total = Math.max(1, Math.round(art.scrollWidth / paso));
    if (actual >= total) actual = total - 1;
  }

  function pintar() {
    art.style.transform = 'translateX(' + (-actual * paso) + 'pt)';
    var fisica = actual + 1;
    var numero = cfg.numeroInicial + (fisica - cfg.desdePagina);
    var mostrar = cfg.hayPie && fisica >= cfg.desdePagina && (fisica > 1 || cfg.pieEnPrimera);
    pie.textContent = mostrar ? String(numero) : '';
    cab.textContent = cfg.encabezado && (fisica > 1 || cfg.pieEnPrimera) ? cfg.encabezado : '';
    cuenta.textContent = 'Página ' + fisica + ' de ' + total + (mostrar ? ' · nº ' + numero : '');
    document.querySelector('[data-ir="-1"]').disabled = actual === 0;
    document.querySelector('[data-ir="1"]').disabled = actual >= total - 1;
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-ir]'), function (b) {
    b.addEventListener('click', function () {
      actual = Math.min(total - 1, Math.max(0, actual + parseInt(b.dataset.ir, 10)));
      pintar();
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { actual = Math.min(total - 1, actual + 1); pintar(); }
    if (e.key === 'ArrowLeft') { actual = Math.max(0, actual - 1); pintar(); }
  });

  medir();
  pintar();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { medir(); pintar(); });
  }
  window.addEventListener('load', function () { medir(); pintar(); });
})();
`;

function construirHtml(documento, hoja, opciones) {
  let opc = opciones || {};
  const base = D.atributosBase(hoja);

  // Se resuelve una sola vez que clase de divisor pide la hoja.
  const saltoDiv = hoja.palabra('paragraph-divider', 'page-break', null);
  const visibleDiv = hoja.palabra('paragraph-divider', 'visibility', 'visible') !== 'hidden';
  const piezasDiv = hoja.prop('paragraph-divider', 'content');
  const textoDiv =
    piezasDiv && piezasDiv.length && piezasDiv[0].tipo === 'cadena' ? piezasDiv[0].valor : null;
  const divisor =
    saltoDiv === 'after' || saltoDiv === 'before'
      ? { tipo: 'salto' }
      : visibleDiv && textoDiv
        ? { tipo: 'texto', texto: textoDiv }
        : visibleDiv
          ? { tipo: 'linea' }
          : { tipo: 'oculto' };

  const opcConTab = Object.assign({}, opc, {
    esDialogo: (b) => bloqueEsDialogo(b, opc),
    unidadTabPt: anchoTabulador(hoja, base, opc),
    divisor,
    comentariosVisibles:
      hoja.palabra('block-comment', 'visibility', 'hidden') === 'visible' ||
      !!(opc && opc.incluirComentarios),
  });
  opc = opcConTab;
  const css = construirCss(hoja, opc);
  marcarBibliografia(documento.bloques, opc.encabezadosBibliografia);
  let cuerpo = bloquesHtml(documento.bloques, opc);

  const ids = Object.keys(documento.notas || {});
  if (ids.length) {
    let notas = '<div class="notas"><ol>';
    for (const id of ids) {
      notas += `<li id="nota-${escHtml(id)}">${inlineHtml(documento.notas[id], opc)} <a href="#ref-${escHtml(id)}">&#8617;</a></li>`;
    }
    notas += '</ol></div>';
    cuerpo += notas;
  }

  const cabeza =
    `<!DOCTYPE html><html lang="${opc.idioma || 'es'}"><head><meta charset="utf-8"/>` +
    `<title>${escHtml(opc.titulo || 'Documento')}</title>` +
    `<style>\n${css}\n</style></head>`;

  if (!opc.previsualizacion) {
    return cabeza + `<body><article class="ulysses">${cuerpo}</article></body></html>`;
  }

  const pagina = ajustesPagina(hoja, opc.tamanoPagina);
  const ajustesJs = JSON.stringify({
    numeroInicial: opc.numeroInicial === undefined ? 1 : opc.numeroInicial,
    desdePagina: opc.desdePagina === undefined ? 1 : opc.desdePagina,
    hayPie: pagina.piePagina === 'page-number',
    // «area-footer :first-page { content: none }» oculta el pie de la primera.
    pieEnPrimera: pagina.piePrimeraPagina !== 'none',
    encabezado: pagina.encabezado && pagina.encabezado !== 'none' ? pagina.encabezado : null,
    anchoColumna: pagina.ancho - pagina.interior - pagina.exterior,
    hueco: 60,
  });

  return (
    cabeza +
    `<body class="${opc.guias === false ? '' : 'guias'}">` +
    `<div class="visor">` +
    `<div class="cabecera"></div>` +
    `<div class="ventana"><article class="ulysses">${cuerpo}</article></div>` +
    `<div class="pie"></div>` +
    `</div>` +
    `<div class="mandos"><button data-ir="-1">◀</button>` +
    `<span class="cuenta">…</span><button data-ir="1">▶</button></div>` +
    `<script>${GUION_PAGINADOR.replace('__AJUSTES__', ajustesJs)}<\/script>` +
    `</body></html>`
  );
}

module.exports = {
  ajustesPagina,
  selectoresDe,
  construirDocx,
  construirCss,
  contenidoMarcador,
  marcarBibliografia,
  anchoTabulador,
  sangriaDeLinea,
  modoDeLineas,
  bloqueEsDialogo,
  sangriaDialogo,
  lineaEsDialogo,
  nombreEstilo,
  ENCABEZADOS_BIBLIOGRAFIA,
  SANGRIA_BIBLIOGRAFIA,
  formatoNivel,
  sangriaNivel,
  construirHtml,
  pilaTipografica,
  PAGINAS,
  SUSTITUTOS,
};
