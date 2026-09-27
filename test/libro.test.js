'use strict';

// Pruebas de la composición de libro: láminas, secciones, doble cara,
// poesía, conversaciones, epígrafes, raya y ajustes por nota.

const test = require('node:test');
const assert = require('node:assert');

const MD = require('../src/markdown.js');
const ULSS = require('../src/ulss.js');
const E = require('../src/ensamblado.js');
const TYPST = require('../src/typst.js');
const LIBRO = require('../src/libro.js');
const IMAGENES = require('../src/imagenes.js');

const A4 = { ancho: 595, alto: 842 };
const NOVELA = `
document-settings { page-inset-top: 15mm; page-inset-inner: 20mm; page-inset-bottom: 15mm; page-inset-outer: 25mm;
  section-break: heading-2; two-sided: yes; page-binding: left }
defaults { font-family: "Baskerville"; font-size: 11pt; line-height: 21pt; text-alignment: justified }
paragraph { first-line-indent: 22pt; margin-top: 12pt }
area-footer { content: page-number; text-alignment: center }
`;

/** Un PNG de mentira: solo la cabecera IHDR con su tamaño. */
function png(ancho, alto) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const v = new DataView(b.buffer);
  v.setUint32(16, ancho);
  v.setUint32(20, alto);
  return b;
}
const recursoPng = (ancho, alto) => ({
  datos: png(ancho, alto), extension: 'png', ancho: ancho * 0.75, alto: alto * 0.75, anchoPx: ancho, altoPx: alto,
});

/* ------------------------------------------------------------------ */

test('markdown: la cursiva que abarca varios versos se cierra en cada verso', () => {
  const doc = MD.analizar('_regresa\nsin haberse\nmovido_\n');
  const p = doc.bloques[0];
  assert.strictEqual(p.lineas.length, 3);
  for (const l of p.lineas) {
    assert.strictEqual(l.hijos.length, 1);
    assert.strictEqual(l.hijos[0].tipo, 'em');
  }
  assert.strictEqual(MD.aTextoPlano(p.lineas[2].hijos), 'movido');
  // Un asterisco suelto al final sigue siendo texto («que*»)
  const b = MD.analizar('**Ana** qué\n**Ana** que*\n').bloques[0];
  assert.strictEqual(MD.aTextoPlano(b.lineas[1].hijos), 'Ana que*');
});

test('markdown: opciones de imagen al estilo de Obsidian', () => {
  assert.deepStrictEqual(MD.opcionesDeImagen('300'), { alt: '', ancho: 300 });
  assert.deepStrictEqual(MD.opcionesDeImagen('300x200'), { alt: '', ancho: 300, alto: 200 });
  assert.deepStrictEqual(MD.opcionesDeImagen('Mapa de la casa|300'), { alt: 'Mapa de la casa', ancho: 300 });
  assert.deepStrictEqual(MD.opcionesDeImagen('página|girada'), { alt: '', lamina: 'si', orientacion: 'girada' });
  assert.deepStrictEqual(MD.opcionesDeImagen('Texto'), { alt: '', lamina: 'no' });
  const doc = MD.analizar('![[faro.png|apaisada]]\n\n![Pie|120](img/a b.png)\n');
  assert.strictEqual(doc.bloques[0].tipo, 'figure');
  assert.strictEqual(doc.bloques[0].orientacion, 'apaisada');
  assert.strictEqual(doc.bloques[1].ancho, 120);
  assert.strictEqual(doc.bloques[1].alt, 'Pie');
});

test('markdown: propiedades de la nota', () => {
  const doc = MD.analizar('---\nulysses-estilo: Novela\nulysses-epigrafes: true\netiquetas: [a, b]\nlista:\n  - uno\n---\nTexto.\n');
  assert.strictEqual(doc.propiedades['ulysses-estilo'], 'Novela');
  assert.strictEqual(doc.propiedades['ulysses-epigrafes'], true);
  assert.deepStrictEqual(doc.propiedades.etiquetas, ['a', 'b']);
  assert.deepStrictEqual(doc.propiedades.lista, ['uno']);
});

test('ajustes por nota: claves con o sin tildes y valores flexibles', () => {
  const a = LIBRO.ajustesDeNota({
    'ulysses-estilo': 'Novela',
    'Ulysses-Láminas': 'imprenta',
    'ulysses-doble-cara': false,
    'ulysses-epígrafes': 'sí',
    'ulysses-raya-pegada': 'no',
    'ulysses-tamaño-página': 'carta',
    'otra-cosa': 1,
  });
  assert.deepStrictEqual(a, {
    estilo: 'Novela', laminas: 'girada', dobleCara: 'no', epigrafes: true, rayaPegada: false, tamanoPagina: 'letter',
  });
});

/* ------------------------------------------------------------------ */

test('láminas: un A4 apaisado a 300 ppp lo es; una foto 4:3 o un icono, no', () => {
  const l = LIBRO.decidirLamina(recursoPng(3508, 2481), A4, {}, 'girada');
  assert.ok(l);
  assert.strictEqual(l.orientacion, 'girada');
  assert.strictEqual(l.encaje, 'cover');
  assert.strictEqual(l.imagenApaisada, true);
  assert.strictEqual(LIBRO.decidirLamina(recursoPng(4032, 3024), A4, {}, 'girada'), null);
  assert.strictEqual(LIBRO.decidirLamina(recursoPng(210, 297), A4, {}, 'girada'), null); // 25 ppp
  // Un A5 tiene la misma proporción que un A4
  assert.ok(LIBRO.decidirLamina(recursoPng(1748, 2480), { ancho: 420, alto: 595 }, {}, 'girada'));
  // Modo de la exportación y palabras de la imagen
  assert.strictEqual(LIBRO.decidirLamina(recursoPng(3508, 2481), A4, {}, 'apaisada').orientacion, 'apaisada');
  assert.strictEqual(LIBRO.decidirLamina(recursoPng(3508, 2481), A4, {}, 'no'), null);
  assert.strictEqual(LIBRO.decidirLamina(recursoPng(3508, 2481), A4, { lamina: 'no' }, 'girada'), null);
  const forzada = LIBRO.decidirLamina(recursoPng(4032, 3024), A4, { lamina: 'si' }, 'no');
  assert.strictEqual(forzada.encaje, 'contain');
  // Un SVG vale por su proporción
  const svg = { datos: new Uint8Array(1), extension: 'svg', anchoPx: 1122.5, altoPx: 793.7 };
  assert.ok(LIBRO.decidirLamina(svg, A4, {}, 'girada'));
});

test('láminas: el párrafo se parte donde está la imagen', () => {
  const doc = MD.analizar('…y el siguiente.![[faro.png]]\n\nOtro párrafo.\n\nAntes ![[faro.png]] después.\n');
  const hoja = ULSS.cargar(NOVELA);
  const opc = { tamanoPagina: 'a4', recursos: () => recursoPng(3508, 2481) };
  const r = LIBRO.preparar(doc, hoja, opc);
  const tipos = r.bloques.map((b) => b.tipo);
  assert.deepStrictEqual(tipos, ['paragraph', 'lamina', 'paragraph', 'paragraph', 'lamina', 'paragraph']);
  assert.strictEqual(MD.aTextoPlano(r.bloques[0].hijos), '…y el siguiente.');
  assert.ok(!r.bloques[2].continuacion);
  assert.strictEqual(MD.aTextoPlano(r.bloques[3].hijos), 'Antes');
  assert.strictEqual(MD.aTextoPlano(r.bloques[5].hijos), 'después.');
  assert.strictEqual(r.bloques[5].continuacion, true);
  // El documento de entrada no se toca
  assert.strictEqual(doc.bloques.length, 3);
});

/* ------------------------------------------------------------------ */

test('secciones: «heading-2» abre sección en los niveles 1 y 2', () => {
  const s = LIBRO.saltoDeSeccion('heading-2');
  assert.deepStrictEqual(s, { nivel: 2, divisor: false });
  assert.ok(LIBRO.abreSeccion(s, { tipo: 'heading', nivel: 1 }));
  assert.ok(LIBRO.abreSeccion(s, { tipo: 'heading', nivel: 2 }));
  assert.ok(!LIBRO.abreSeccion(s, { tipo: 'heading', nivel: 3 }));
  assert.deepStrictEqual(LIBRO.saltoDeSeccion('paragraph-divider'), { nivel: 0, divisor: true });
  assert.deepStrictEqual(LIBRO.saltoDeSeccion(null), { nivel: 0, divisor: false });
});

test('doble cara: la exportación manda sobre el estilo', () => {
  const pagina = E.ajustesPagina(ULSS.cargar(NOVELA), 'a4');
  assert.strictEqual(pagina.dosCaras, true);
  assert.strictEqual(pagina.encuadernacion, 'left');
  assert.strictEqual(LIBRO.dobleCara(pagina, {}), true);
  assert.strictEqual(LIBRO.dobleCara(pagina, { dobleCara: 'estilo' }), true);
  assert.strictEqual(LIBRO.dobleCara(pagina, { dobleCara: false }), false);
  assert.strictEqual(LIBRO.dobleCara(pagina, { dobleCara: 'no' }), false);
  assert.strictEqual(LIBRO.dobleCara({ dosCaras: false }, { dobleCara: 'si' }), true);
});

/* ------------------------------------------------------------------ */

const CHAT = `## Mensajes

_Marta ha iniciado sesión._

**Marta ♪** sigues despierta?

**~ Inés ~** sí

**Marta ♪** mira por la ventana

se ve el barco

~~se ve el barco~~

**~ Inés ~** no veo nada

Apagué la pantalla.
`;

test('conversaciones: un chat se detecta con sus avisos y borradores', () => {
  const doc = LIBRO.preparar(MD.analizar(CHAT), ULSS.cargar(NOVELA), {});
  const p = doc.bloques.filter((b) => b.tipo === 'paragraph');
  assert.deepStrictEqual(
    p.map((b) => (b.chat ? b.chat.tipo : null)),
    ['sistema', 'turno', 'turno', 'turno', 'borrador', 'borrador', 'turno', null]
  );
  assert.ok(p[0].chat.inicio);
  assert.ok(p[6].chat.fin);
});

test('conversaciones: los rótulos de unos apuntes no son un chat; el teatro sí', () => {
  const apuntes = '**Definición:** Evolución parcial\n\n**Causas:** Influencia culta\n\n**Definición:** Forma latina\n\n**Causas:** Otra\n';
  const a = LIBRO.preparar(MD.analizar(apuntes), ULSS.cargar(NOVELA), {});
  assert.ok(a.bloques.every((b) => !b.chat));
  const teatro = '**DON JUAN:** ¡Cuán gritan esos malditos!\n\n**CIUTTI:** ¡Buen agosto!\n\n**DON JUAN:** Pero hoy…\n';
  const t = LIBRO.preparar(MD.analizar(teatro), ULSS.cargar(NOVELA), {});
  assert.ok(t.bloques.every((b) => b.chat && b.chat.tipo === 'turno'));
  const sin = LIBRO.preparar(MD.analizar(CHAT), ULSS.cargar(NOVELA), { conversaciones: false });
  assert.ok(sin.bloques.every((b) => !b.chat));
});

/* ------------------------------------------------------------------ */

test('poesía: dentro de un poema, un verso suelto es verso', () => {
  const poema = '# Nueve segundos\n\nLa luz pasa\ny enciende el cuarto.\n\n_23:19_\n\nVuelve\ny lo trae entero.\n\nAsí toda la noche:\nuna casa que se va.\n\nDuermes.\n';
  const doc = LIBRO.preparar(MD.analizar(poema), ULSS.cargar(NOVELA), {});
  const p = doc.bloques.filter((b) => b.tipo === 'paragraph');
  assert.strictEqual(p[1].versoSuelto, true);
  assert.strictEqual(p[4].versoSuelto, true);
  assert.strictEqual(E.modoDeLineas(p[4], {}), 'verso');
  // Prosa entre estrofas sangradas: se queda en prosa
  const bateria = '## Un poema\n\n\tEn el medio del camino\n\t\tme detuve a mirar\n\n\tY en la orilla quedaron\n\t\ttres piedras\n\n' +
    'Prosa entre estrofas para verificar el retorno del modo verso al modo párrafo.\n\n\tOtro verso corto.\n\tY el último.\n';
  const d2 = LIBRO.preparar(MD.analizar(bateria), ULSS.cargar(NOVELA), {});
  assert.ok(d2.bloques.every((b) => !b.versoSuelto));
});

test('poesía: qué versos van pegados al siguiente', () => {
  assert.deepStrictEqual(LIBRO.versosPegados(1), [false]);
  assert.deepStrictEqual(LIBRO.versosPegados(3), [true, true, false]);
  assert.deepStrictEqual(LIBRO.versosPegados(4), [true, true, true, false]);
  assert.deepStrictEqual(LIBRO.versosPegados(6), [true, false, false, false, true, false]);
});

/* ------------------------------------------------------------------ */

test('epígrafes: solo si se piden, y solo la cita corta bajo un titular', () => {
  const texto = '# Faro\n\n> Todo faro repite la misma *pregunta*.\n\nTexto.\n\n> Una cita en mitad del texto.\n';
  const sin = LIBRO.preparar(MD.analizar(texto), ULSS.cargar(NOVELA), {});
  assert.ok(!sin.bloques[1].epigrafe);
  const con = LIBRO.preparar(MD.analizar(texto), ULSS.cargar(NOVELA), { epigrafes: true });
  assert.strictEqual(con.bloques[1].epigrafe, true);
  assert.ok(!con.bloques[3].epigrafe);
});

test('raya: pegada al parlamento, no en una enumeración', () => {
  const doc = LIBRO.preparar(MD.analizar('— ¿No vienes?\n– ¡Voy!\n\n— expresiva,\n— contenida.\n'), ULSS.cargar(NOVELA), {});
  const [dialogo, lista] = doc.bloques;
  assert.strictEqual(dialogo.lineas[0].texto, '—¿No vienes?');
  assert.strictEqual(MD.aTextoPlano(dialogo.lineas[1].hijos), '—¡Voy!');
  assert.strictEqual(MD.aTextoPlano(lista.lineas[0].hijos), '— expresiva,');
  const sin = LIBRO.preparar(MD.analizar('— ¿No vienes?\n'), ULSS.cargar(NOVELA), { rayaPegada: false });
  assert.strictEqual(MD.aTextoPlano(sin.bloques[0].hijos), '— ¿No vienes?');
});

/* ------------------------------------------------------------------ */

test('emisor typst: imágenes dentro de una caja (si no, Typst las descarta)', () => {
  const hoja = ULSS.cargar(NOVELA);
  const doc = MD.analizar('Texto con ![[icono.png]] en medio.\n\n![[mapa.png|300]]\n');
  const r = TYPST.construirTypst(doc, hoja, { tamanoPagina: 'a4', recursos: () => recursoPng(400, 300) });
  assert.match(r.fuente, /box\(image\("\/imagen1\.png", width: /);
  assert.match(r.fuente, /box\(image\("\/imagen2\.png", width: 224\.9/); // 300 px ≈ 225 pt
  // Un formato que Typst no lee no rompe la compilación: aviso
  const r2 = TYPST.construirTypst(MD.analizar('![[a.webp]]\n'), hoja, {
    tamanoPagina: 'a4', recursos: () => ({ datos: new Uint8Array(4), extension: 'webp', anchoPx: 10, altoPx: 10 }),
  });
  assert.doesNotMatch(r2.fuente, /image\(/);
  assert.ok(r2.avisos.some((a) => /WEBP/.test(a)));
});

test('emisor typst: lámina girada o en página apaisada', () => {
  const hoja = ULSS.cargar(NOVELA);
  const doc = MD.analizar('Antes.![[faro.png]]\n\nDespués.\n');
  const opc = { tamanoPagina: 'a4', recursos: () => recursoPng(3508, 2481) };
  const girada = TYPST.construirTypst(doc, hoja, opc).fuente;
  assert.match(girada, /#page\(width: 594\.96pt, height: 841\.92pt, margin: 0pt[^\n]*foreground: none[^\n]*rotate\(-90deg, reflow: true, image\("\/imagen1\.png", width: 841\.92pt, height: 594\.96pt, fit: "cover"\)/);
  const apaisada = TYPST.construirTypst(MD.analizar('Antes.![[faro.png]]\n'), hoja, Object.assign({ laminas: 'apaisada' }, opc)).fuente;
  assert.match(apaisada, /#page\(width: 841\.92pt, height: 594\.96pt, margin: 0pt/);
  assert.doesNotMatch(apaisada, /rotate\(/);
});

test('emisor typst: doble cara y secciones en página impar', () => {
  const hoja = ULSS.cargar(NOVELA);
  const doc = MD.analizar('# Libro\n\nUno.\n\n## Capítulo\n\nDos.\n\n### Apartado\n\nTres.\n');
  const r = TYPST.construirTypst(doc, hoja, { tamanoPagina: 'a4' });
  assert.match(r.fuente, /margin: \(inside: 57pt, [^)]*outside: 70\.1\d*pt[^)]*\), binding: left/);
  assert.strictEqual((r.fuente.match(/pagebreak\(weak: true, to: "odd"\)/g) || []).length, 1); // solo el capítulo
  assert.ok(r.necesitaPaginas);
  assert.ok(r.bloques.some((b) => b.seccion));
  const unaCara = TYPST.construirTypst(doc, hoja, { tamanoPagina: 'a4', dobleCara: false });
  assert.match(unaCara.fuente, /margin: \(left: 57pt/);
  assert.doesNotMatch(unaCara.fuente, /to: "odd"/);
  assert.match(unaCara.fuente, /#pagebreak\(weak: true\)\n#block/);
  // Con las páginas medidas, el folio se salta las blancas y va en espejo
  const conPaginas = TYPST.construirTypst(doc, hoja, { tamanoPagina: 'a4', paginas: { sinFolio: [2], primerasDeSeccion: [1, 3] } });
  assert.match(conPaginas.fuente, /if not \(2,\)\.contains\(here\(\)\.page\(\)\)/);
  assert.match(conPaginas.fuente, /calc\.even\(here\(\)\.page\(\)\)/);
});

test('medición de páginas: blancas y primeras de sección', () => {
  const bloques = [{ k: 0 }, { k: 1, seccion: true }, { k: 2 }];
  const posiciones = {
    0: { pagina: 1, paginaFin: 1 },
    1: { pagina: 3, paginaFin: 3 },
    2: { pagina: 3, paginaFin: 5 },
  };
  assert.deepStrictEqual(TYPST.paginasDeLaMedicion(bloques, posiciones), { sinFolio: [2], primerasDeSeccion: [1, 3] });
});

/* ------------------------------------------------------------------ */

function descomprimir(zip) {
  // El DOCX va almacenado sin comprimir: basta buscar el XML en claro.
  return Buffer.from(zip).toString('utf8');
}

test('DOCX: láminas en su sección, capítulos en impar y márgenes en espejo', () => {
  const hoja = ULSS.cargar(NOVELA);
  const doc = MD.analizar('# Libro\n\nUno.![[faro.png]]\n\nDos.\n\n## Capítulo\n\nTres ~~tachado~~.\n');
  const x = descomprimir(E.construirDocx(doc, hoja, { tamanoPagina: 'a4', recursos: () => recursoPng(3508, 2481) }));
  assert.match(x, /<w:mirrorMargins\/>/);
  assert.match(x, /<wp:anchor [^>]*behindDoc="1"/);
  assert.match(x, /<a:xfrm rot="16200000">/); // girada
  assert.match(x, /<w:type w:val="oddPage"\/>/);
  assert.match(x, /<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/); // la lámina, sin márgenes
  assert.match(x, /Tres <\/w:t>.*tachado/); // «~~tachado~~» se ve aunque Novela oculte las «deletions»
  const apaisada = descomprimir(E.construirDocx(doc, hoja, { tamanoPagina: 'a4', laminas: 'apaisada', recursos: () => recursoPng(3508, 2481) }));
  assert.match(apaisada, /w:orient="landscape"/);
  const unaCara = descomprimir(E.construirDocx(doc, hoja, { tamanoPagina: 'a4', dobleCara: false, recursos: () => null }));
  assert.doesNotMatch(unaCara, /mirrorMargins|oddPage/);
  assert.match(unaCara, /<w:pageBreakBefore\/>/);
});

test('HTML: lámina, conversación, epígrafe y secciones', () => {
  const hoja = ULSS.cargar(NOVELA);
  const doc = MD.analizar(CHAT + '\n## Faro\n\n> Una definición.\n\nUno.![[faro.png]]\n');
  const html = E.construirHtml(doc, hoja, { tamanoPagina: 'a4', epigrafes: true, recursos: () => recursoPng(3508, 2481) });
  assert.match(html, /class="lamina lamina-girada lamina-sangre"/);
  assert.match(html, /class="chat chat-turno/);
  assert.match(html, /<blockquote class="epigrafe">/);
  assert.match(html, /\.ulysses h1, \.ulysses h2 \{ break-before: right; \}/);
  assert.match(html, /@page :left \{ margin-left: 70\.866pt; margin-right: 56\.693pt; \}/);
});

test('imágenes: tamaño de un SVG por sus atributos o su viewBox', () => {
  const svg = (s) => IMAGENES.dimensiones(Buffer.from(s), 'svg');
  const a = svg('<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm">');
  assert.ok(Math.abs(a.ancho / a.alto - 297 / 210) < 1e-9);
  assert.deepStrictEqual(svg('<svg viewBox="0 0 842 595">'), { ancho: 842, alto: 595 });
  assert.deepStrictEqual(svg('<svg width="100%" viewBox="0,0,2480,3508">'), { ancho: 2480, alto: 3508 });
  assert.strictEqual(IMAGENES.extension('a/Foto.PNG'), 'png');
});

/* ------------------------------------------------------------------ *
 * Hallazgos de la revisión de la 2.1
 * ------------------------------------------------------------------ */

test('markdown: el guion bajo dentro de una palabra no abre cursiva, ni cruzando líneas', () => {
  const p = MD.analizar('Guarda mi_tesis.docx\ny abre notas_finales.md\n').bloques[0];
  assert.deepStrictEqual(p.lineas.map((l) => MD.aTextoPlano(l.hijos)), ['Guarda mi_tesis.docx', 'y abre notas_finales.md']);
  assert.ok(p.hijos.every((n) => n.tipo === 'texto' || n.tipo === 'salto'));
  const q = MD.analizarInline('abre _despacio_ la puerta');
  assert.strictEqual(q[1].tipo, 'em');
});

test('markdown: en «![alt](ruta)» el texto alternativo no es palabra clave', () => {
  const [a, b, c] = MD.analizar('![Página](scan.png)\n\n![Texto|300](x.png)\n\n![Pie|página](y.png)\n').bloques;
  assert.strictEqual(a.alt, 'Página');
  assert.strictEqual(a.lamina, undefined);
  assert.strictEqual(b.alt, 'Texto');
  assert.strictEqual(b.ancho, 300);
  assert.strictEqual(c.alt, 'Pie');
  assert.strictEqual(c.lamina, 'si');
});

test('DOCX: la figura respeta «|100»', () => {
  const doc = MD.analizar('![[mapa.png|100]]\n');
  const x = descomprimir(E.construirDocx(doc, ULSS.cargar(NOVELA), { tamanoPagina: 'a4', laminas: 'no', recursos: () => recursoPng(1600, 1200) }));
  assert.match(x, /<wp:extent cx="952500" cy="714375"\/>/); // 100 px = 75 pt
});

test('DOCX: tras una lámina el texto conserva el folio aunque el estilo quite el de la primera página', () => {
  const hoja = ULSS.cargar(NOVELA + '\narea-footer :first-page { content: none }\n');
  const doc = MD.analizar('# Libro\n\nUno.![[faro.png]]\n\nDos.\n');
  const x = descomprimir(E.construirDocx(doc, hoja, { tamanoPagina: 'a4', recursos: () => recursoPng(3508, 2481) }));
  const secciones = x.match(/<w:sectPr>.*?<\/w:sectPr>/g);
  assert.strictEqual(secciones.length, 3); // portada, lámina, continuación
  assert.match(secciones[0], /<w:titlePg\/>/);
  assert.doesNotMatch(secciones[2], /<w:titlePg\/>/);
});

test('DOCX: «heading-all + paragraph» solo justo tras el titular', () => {
  const hoja = ULSS.cargar(NOVELA + '\nheading-all + paragraph { first-line-indent: 0pt }\n');
  const x = descomprimir(E.construirDocx(MD.analizar('## Cap\n\n> Una cita.\n\nTexto tras la cita.\n'), hoja, { tamanoPagina: 'a4' }));
  const p = x.slice(x.lastIndexOf('<w:p>', x.indexOf('Texto tras la cita')), x.indexOf('Texto tras la cita'));
  assert.match(p, /w:firstLine="440"/); // 22 pt: la sangría normal
});

test('DOCX y HTML: el verso que sigue a una lámina conserva su sangría francesa', () => {
  const hoja = ULSS.cargar(NOVELA);
  const opc = { tamanoPagina: 'a4', recursos: () => recursoPng(3508, 2481) };
  const doc = MD.analizar('uno\ndos![[faro.png]]\ntres\ncuatro\n');
  const x = descomprimir(E.construirDocx(doc, hoja, opc));
  const p = x.slice(x.lastIndexOf('<w:p>', x.indexOf('>tres<')), x.indexOf('>tres<'));
  assert.match(p, /w:hanging="/);
  const html = E.construirHtml(MD.analizar('uno\ndos![[faro.png]]\ntres\ncuatro\n'), hoja, opc);
  assert.match(html, /\.ulysses p\.continuacion:not\(\.verso\) \{ text-indent: 0; \}/);
});

test('DOCX: encuadernación por la derecha a doble cara', () => {
  const hoja = ULSS.cargar(NOVELA.replace('page-binding: left', 'page-binding: right'));
  const x = descomprimir(E.construirDocx(MD.analizar('Texto.\n'), hoja, { tamanoPagina: 'a4' }));
  assert.match(x, /<w:pgMar w:top="850" w:right="1133" w:bottom="850" w:left="1417"/);
});

test('HTML: la sección del divisor gana al salto de página, y no dentro de una cita', () => {
  const hoja = ULSS.cargar(NOVELA.replace('section-break: heading-2', 'section-break: paragraph-divider'));
  const html = E.construirHtml(MD.analizar('Uno.\n\n***\n\nDos.\n\n> Cita\n>\n> ***\n>\n> sigue\n'), hoja, { tamanoPagina: 'a4' });
  assert.match(html, /\.ulysses \.salto-pagina\.salto-seccion \{ break-after: right; \}/);
  assert.strictEqual((html.match(/salto-seccion"/g) || []).length, 1);
});

test('poesía: una lámina a mitad del poema no lo corta', () => {
  const poema = 'La luz pasa\ny enciende el cuarto.\n\n![[faro.png]]\n\n_23:19_\n\nVuelve\ny lo trae entero.\n\nAsí toda la noche:\nuna casa que se va.\n';
  const doc = LIBRO.preparar(MD.analizar(poema), ULSS.cargar(NOVELA), { recursos: () => recursoPng(3508, 2481) });
  assert.ok(doc.bloques.some((b) => b.tipo === 'lamina'));
  assert.strictEqual(doc.bloques.find((b) => b.tipo === 'paragraph' && MD.aTextoPlano(b.hijos) === '23:19').versoSuelto, true);
});
