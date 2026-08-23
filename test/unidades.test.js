'use strict';

const test = require('node:test');
const assert = require('node:assert');

const TYPST = require('../src/typst.js');
const ULSS = require('../src/ulss.js');
const MD = require('../src/markdown.js');
const E = require('../src/ensamblado.js');
const METRICAS = require('../src/metricas.js');

test('geometría de página: A4 como la imprime Chromium', () => {
  // Universidad: márgenes de 25 mm por los cuatro costados
  const hoja = ULSS.cargar(`
document-settings { page-inset-top: 25mm; page-inset-inner: 25mm; page-inset-bottom: 25mm; page-inset-outer: 25mm }
defaults { font-size: 12pt; line-height: 18pt }`);
  const pagina = E.ajustesPagina(hoja, 'a4');
  const geo = TYPST.geometria(pagina);
  assert.strictEqual(geo.anchoPt, 594.96);
  assert.strictEqual(geo.altoPt, 841.92);
  assert.strictEqual(geo.anchoCont, 605); // 793 - 94 - 94
  assert.strictEqual(geo.altoCont, 934); // 1122 - 94 - 94
  assert.strictEqual(geo.margenes.izquierda, 71.25); // ceil(94.49) * 0.75
  assert.strictEqual(geo.margenes.superior, 70.5); // round(94.49) * 0.75
});

test('cuerpos truncados como Blink y FreeType', () => {
  assert.strictEqual(TYPST.cuerpoPx(11), 14.66); // 14.6667 -> centésimas truncadas
  assert.strictEqual(TYPST.cuerpoFreeType(14.66), 14.65625); // 1/64 truncado
  assert.strictEqual(TYPST.cuerpoPx(12), 16);
  assert.strictEqual(TYPST.cuerpoFreeType(16), 16);
});

test('caja de línea: reparto del sobrante con floor', () => {
  // Baskerville 14,66 px: asc 13, desc 4; línea de 28 px (21 pt)
  const caja = TYPST.cajaLinea({ asc: 13, desc: 4, hueco: 0 }, 28);
  assert.strictEqual(caja.ascL, 18); // floor(5,5) = 5 -> 13 + 5
  assert.strictEqual(caja.descL, 10);
  // Titular 45,328 px con asc 41, desc 11: mitad negativa floor(-3,336) = -4
  const grande = TYPST.cajaLinea({ asc: 41, desc: 11, hueco: 0 }, 45.328125);
  assert.strictEqual(grande.ascL, 37);
});

test('métricas Blink: redondeo del ascendente y descendente', () => {
  const cara = { ascendente: 1839, descendente: 504, huecoLinea: 0, upm: 2048 };
  const m = TYPST.metricasBlink(cara, 14.66);
  assert.strictEqual(m.asc, 13); // 13,164 -> 13
  assert.strictEqual(m.desc, 4); // 3,608 -> 4
  const optima = TYPST.metricasBlink({ ascendente: 919, descendente: 268, huecoLinea: 25, upm: 1000 }, 16);
  assert.deepStrictEqual([optima.asc, optima.desc, optima.hueco], [15, 4, 0]);
});

test('pilas de familias', () => {
  assert.deepStrictEqual(
    TYPST.familiasDePila('"Avenir Next", Avenir, sans-serif'),
    ['Avenir Next', 'Avenir', 'sans-serif']
  );
});

test('parser ulss: variables, mixins y herencia', () => {
  const hoja = ULSS.cargar(`
$gris = #777777
@code { font-weight: normal }
defaults { font-family: "Optima"; font-size: 12pt; line-height: 18pt }
heading-1 { font-size: 18pt; font-color: $gris }
block-code : @code { font-size: 9pt }
`);
  assert.strictEqual(hoja.familia('defaults', null), 'Optima');
  assert.strictEqual(hoja.puntos('heading-1', 'font-size', 12, null), 18);
  assert.strictEqual(hoja.color('heading-1', 'font-color', null), '#777777');
  assert.strictEqual(hoja.puntos('block-code', 'font-size', 12, null), 9);
});

test('markdown: diálogo, verso y notas', () => {
  const doc = MD.analizar(`# Título

Un párrafo normal[^1] con nota.

— ¿No vienes?
— ¡Voy!

[^1]: La nota al pie.
`);
  assert.strictEqual(doc.bloques[0].tipo, 'heading');
  const p = doc.bloques[1];
  assert.strictEqual(p.tipo, 'paragraph');
  assert.ok(doc.notas['1']);
  const dialogo = doc.bloques[2];
  assert.strictEqual(dialogo.lineas.length, 2);
  assert.ok(E.lineaEsDialogo(dialogo.lineas[0]));
});

test('emisor typst: documento mínimo compila la fuente esperada', () => {
  const hoja = ULSS.cargar(`
document-settings { page-inset-top: 15mm; page-inset-inner: 20mm; page-inset-bottom: 15mm; page-inset-outer: 25mm }
defaults { font-family: "Baskerville"; font-size: 11pt; line-height: 21pt; text-alignment: justified }
paragraph { first-line-indent: 22pt; margin-top: 12pt }
area-footer { content: page-number; text-alignment: center }
`);
  const doc = MD.analizar('Primer párrafo.\n\nSegundo párrafo con algo más de texto.\n');
  const r = TYPST.construirTypst(doc, hoja, { tamanoPagina: 'a4' });
  assert.match(r.fuente, /set page\(width: 594\.96pt, height: 841\.92pt/);
  assert.match(r.fuente, /overhang: false/);
  assert.match(r.fuente, /linebreaks: "simple"/);
  assert.match(r.fuente, /counter\(page\)/); // número de página
  assert.strictEqual(r.bloques.length, 2);
  // Sangría de primera línea en LayoutUnit: 22pt -> 29,328125 px
  assert.match(r.fuente, /first-line-indent: \(amount: 21\.98[0-9]*pt, all: true\)/);
});

test('ajuste de segunda pasada: clava la línea base en el píxel', () => {
  const geo = { altoCont: 1000, margenes: { superior: 42.75 } };
  const bloques = [
    { k: 0, pt: 3.78125, pb: 3.78125, ascL: 17, descL: 7, lh: 24, sticky: false },
    { k: 1, pt: 3.78125, pb: 0, ascL: 17, descL: 7, lh: 24, sticky: false },
  ];
  const PX = TYPST.PX;
  const posiciones = {
    0: { pagina: 1, yIni: 42.75 + (3.78125 + 17) * PX, paginaFin: 1, yFin: 42.75 + (3.78125 + 17) * PX },
    1: { pagina: 1, yIni: 42.75 + (3.78125 + 24 + 3.78125 + 3.78125 + 17) * PX, paginaFin: 1, yFin: 42.75 + (3.78125 + 24 + 3.78125 + 3.78125 + 17) * PX },
  };
  const ajuste = TYPST.calcularAjuste(bloques, posiciones, geo);
  // bloque 0: línea base fraccionaria 20,78 -> objetivo 21 -> delta +0,22
  assert.ok(Math.abs(ajuste[0].deltaPt - 0.21875) < 1e-6);
  // bloque 1: base 52,34 -> objetivo 52; arrastra +0,22 -> delta -0,56
  assert.ok(Math.abs(ajuste[1].deltaPt - (52 - 52.34375 - 0.21875)) < 1e-6);
});

test('lectura de fuentes: cara sintética', () => {
  // TTF mínimo de mentira: solo comprobamos que un fichero no reconocido lanza
  assert.throws(() => METRICAS.leerFuente(new Uint8Array([1, 2, 3, 4])));
});

test('verificación del compilador descargado', async () => {
  const MOTOR = require('../src/motor.js');
  // Ni siquiera es WebAssembly
  await assert.rejects(() => MOTOR.verificarCompilador(new Uint8Array([1, 2, 3, 4, 5])), /WebAssembly/);
  // Firma correcta pero tamaño que no cuadra
  const falso = new Uint8Array(1000);
  falso.set([0x00, 0x61, 0x73, 0x6d], 0);
  await assert.rejects(() => MOTOR.verificarCompilador(falso), /tamaño/);
  assert.match(MOTOR.SHA256_COMPILADOR, /^[0-9a-f]{64}$/);
});

test('tipografías de reserva: juego completo y coherente', () => {
  const MOTOR = require('../src/motor.js');
  assert.strictEqual(MOTOR.FUENTES_RESERVA.length, 12); // 3 familias × 4 variantes
  for (const f of MOTOR.FUENTES_RESERVA) {
    assert.match(f.nombre, /\.ttf$/);
    assert.match(f.url, /^https:\/\//);
  }
  // Las tres familias de reserva tienen que estar en las genéricas del
  // emisor, o «resolverFamilia» nunca las encontraría.
  const TYPST = require('../src/typst.js');
  const todas = Object.values(TYPST.GENERICAS).flat();
  for (const familia of ['Tinos', 'Arimo', 'Cousine']) assert.ok(todas.includes(familia), familia);
});

test('faltanGeneros detecta un catálogo incompleto', () => {
  const MOTOR = require('../src/motor.js');
  const vacio = { tieneFamilia: () => false };
  assert.strictEqual(MOTOR.faltanGeneros(vacio), true);
  const completo = { tieneFamilia: (f) => ['Tinos', 'Arimo', 'Cousine'].includes(f) };
  assert.strictEqual(MOTOR.faltanGeneros(completo), false);
  const soloSerif = { tieneFamilia: (f) => f === 'Tinos' };
  assert.strictEqual(MOTOR.faltanGeneros(soloSerif), true);
});
