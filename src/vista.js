'use strict';

const DIALOGOS = require('./dialogos.js');
const DOCX = require('./docx.js');
const EDITOR = require('./editor.js');
const ENSAMBLADO = require('./ensamblado.js');
const FUENTES = require('./fuentes.js');
const MARKDOWN = require('./markdown.js');
const ULSS = require('./ulss.js');

/*
 * Editor de estilos como pestaña
 * ==============================
 *
 * Dos paneles: controles a la izquierda, la pagina compuesta a la
 * derecha, repintada en cada pulsacion. La idea es no editar a ciegas:
 * cambias el interlineado y lo ves moverse.
 *
 * Encima de esto sigue estando el motor probado de editor.js, que
 * reescribe el .ulss propiedad a propiedad sin tocar lo demas.
 */

const obsidian = require('obsidian');
const { ItemView, Notice, Modal, Setting } = obsidian;

const TIPO_VISTA = 'ulysses-editor-estilos';

const PESTANAS = [
  { id: 'basico', titulo: 'Básico' },
  { id: 'titulares', titulo: 'Titulares' },
  { id: 'bloques', titulo: 'Bloques' },
  { id: 'texto', titulo: 'Texto' },
  { id: 'pagina', titulo: 'Página y notas' },
  { id: 'extensiones', titulo: 'Extensiones' },
  { id: 'avanzado', titulo: 'Avanzado' },
  { id: 'biblioteca', titulo: 'Biblioteca' },
];

const MUESTRA_TIPOGRAFICA = 'Del rigor en la ciencia · 123';

const DOCUMENTO_MUESTRA = `# Titular de primer nivel

Primer párrafo tras el titular, que en muchos estilos va sin sangrar. Sirve para ver el cuerpo, el interlineado y la alineación del texto corrido, que es lo que ocupa la mayor parte de cualquier página.

Segundo párrafo, ya con la sangría de primera línea si el estilo la define. Conviene que sea largo para juzgar la mancha: la composición justificada reparte el espacio entre palabras y el guionado parte las esdrújulas, así que aquí se aprecia si la caja respira o va apretada.

## Titular de segundo nivel

> Una cita en bloque, con sus márgenes propios y su inclinación si el estilo la pide.

### Titular de tercer nivel

#### Titular de cuarto nivel

##### Titular de quinto nivel

###### Titular de sexto nivel

- Primer elemento de una lista
- Segundo elemento, algo más largo para ver cómo sangra la vuelta
  - Un elemento anidado

1. Elemento numerado
2. Otro más

Un párrafo con **negrita**, *cursiva*, un [enlace](https://example.org) y \`código en línea\`.

\`\`\`
def ejemplo(n):
    return n * 2
\`\`\`

----

Después del divisor.

	Una línea sangrada con un tabulador.

		Y otra con dos, para ver la escalera.

| Concepto | Valor |
|:---------|------:|
| Cuerpo   | 12 pt |
| Caja     | 160 mm |

## Bibliografía

Barthes, R. (2009). *Diario de duelo*. Barcelona: Paidós.

Derrida, J. (1998). *Espectros de Marx*. Madrid: Trotta.
`;

/* ------------------------------------------------------------------ *
 * La vista
 * ------------------------------------------------------------------ */

class VistaEstilos extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.texto = null;
    this.original = null;
    this.ruta = null;
    this.nombre = null;
    this.pestana = 'basico';
    this.busqueda = '';
    this.zoom = 0.62;
    this.guias = true;
    this.usarNota = false;
    this.fuentes = { lista: [], exacta: false };
    this.pila = [];
  }

  getViewType() { return TIPO_VISTA; }
  getDisplayText() { return this.nombre ? `Estilo: ${this.nombre}` : 'Editor de estilos'; }
  getIcon() { return 'pencil-ruler'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('ulx-vista');
    try {
      this.fuentes = await FUENTES.disponibles(this.plugin.fuentesConocidas());
    } catch (e) {
      console.error('[Ulysses Export] no se pudieron listar tipografías', e);
    }
    this.armazon();
    const inicial = this.plugin.estiloPendiente || null;
    this.plugin.estiloPendiente = null;
    const hojas = await this.plugin.listarEstilos();
    const elegida =
      (inicial && hojas.find((h) => h.ruta === inicial)) ||
      hojas.find((h) => h.nombre === this.plugin.ajustes.estiloPorDefecto) ||
      hojas[0];
    if (elegida) await this.cargar(elegida.ruta);
    else this.pintar();
  }

  async onClose() {
    if (this.sucio()) {
      // No bloqueamos el cierre, pero dejamos el trabajo a salvo.
      try {
        await this.plugin.guardarBorrador(this.ruta, this.texto);
        new Notice('Había cambios sin guardar: se ha dejado un borrador.');
      } catch (e) { /* si falla, no hay nada mas que hacer */ }
    }
  }

  sucio() { return this.original !== null && this.texto !== this.original; }

  /* --------------------------- armazon --------------------------- */

  armazon() {
    const raiz = this.contentEl;
    raiz.empty();

    this.cabecera = raiz.createDiv({ cls: 'ulx-cabecera' });
    this.barra = raiz.createDiv({ cls: 'ulx-pestanas' });
    const cuerpo = raiz.createDiv({ cls: 'ulx-cuerpo' });
    this.panel = cuerpo.createDiv({ cls: 'ulx-panel' });
    this.lateral = cuerpo.createDiv({ cls: 'ulx-previa' });

    const mandos = this.lateral.createDiv({ cls: 'ulx-previa-mandos' });
    this.mandosPrevia(mandos);
    this.marco = this.lateral.createEl('iframe', { cls: 'ulx-marco' });
    // Con «allow-scripts» corre el paginador; sin «allow-same-origin»
    // el marco queda en origen opaco y no toca nada de Obsidian.
    this.marco.setAttribute('sandbox', 'allow-scripts');
  }

  mandosPrevia(cont) {
    const zoom = cont.createEl('select', { cls: 'ulx-mini' });
    for (const z of [0.4, 0.5, 0.62, 0.8, 1]) {
      const op = zoom.createEl('option', { text: `${Math.round(z * 100)} %` });
      op.value = String(z);
      if (Math.abs(z - this.zoom) < 0.01) op.selected = true;
    }
    zoom.addEventListener('change', () => {
      this.zoom = parseFloat(zoom.value);
      this.aplicarZoom();
    });

    const guias = cont.createEl('button', { text: 'Guías', cls: 'ulx-mini' });
    guias.addEventListener('click', () => {
      this.guias = !this.guias;
      guias.toggleClass('ulx-activo', this.guias);
      this.previsualizar(true);
    });
    guias.toggleClass('ulx-activo', this.guias);

    const nota = cont.createEl('button', { text: 'Usar mi nota', cls: 'ulx-mini' });
    nota.addEventListener('click', () => {
      this.usarNota = !this.usarNota;
      nota.toggleClass('ulx-activo', this.usarNota);
      this.previsualizar(true);
    });

    cont.createDiv({ cls: 'ulx-espaciador' });
    this.aviso = cont.createDiv({ cls: 'ulx-aviso' });
  }

  /* --------------------------- carga --------------------------- */

  async cargar(ruta) {
    try {
      this.texto = await this.plugin.app.vault.adapter.read(ruta);
      this.original = this.texto;
      this.ruta = ruta;
      this.nombre = ruta.split('/').pop().replace(/\.ulss$/i, '');
      if (ruta.endsWith('/Style.ulss')) {
        const h = (await this.plugin.listarEstilos()).find((x) => x.ruta === ruta);
        if (h) this.nombre = h.nombre;
      }
      this.pila = [];
      this.pintar();
    } catch (e) {
      console.error('[Ulysses Export]', e);
      new Notice('No se pudo abrir el estilo.');
    }
  }

  /* --------------------------- pintado --------------------------- */

  pintar() {
    this.pintarCabecera();
    this.pintarPestanas();
    this.panel.empty();
    if (!this.texto) {
      this.panel.createEl('p', { text: 'No hay ningún estilo abierto.' });
      return;
    }
    try {
      const metodo = {
        basico: 'seccionBasico', titulares: 'seccionTitulares', bloques: 'seccionBloques',
        texto: 'seccionTexto', pagina: 'seccionPagina', extensiones: 'seccionExtensiones',
        avanzado: 'seccionAvanzado', biblioteca: 'seccionBiblioteca',
      }[this.pestana];
      if (this.busqueda && this.pestana !== 'biblioteca') this.seccionBusqueda(this.panel);
      else this[metodo](this.panel);
    } catch (e) {
      console.error('[Ulysses Export]', e);
      this.panel.createEl('p', { text: 'Error al pintar: ' + (e && e.message ? e.message : e) });
    }
    this.previsualizar();
  }

  pintarCabecera() {
    const c = this.cabecera;
    c.empty();

    const izq = c.createDiv({ cls: 'ulx-cab-izq' });
    this.selector = izq.createEl('select', { cls: 'ulx-selector' });
    this.rellenarSelector();

    const marca = izq.createSpan({ cls: 'ulx-marca' });
    marca.setText(this.sucio() ? '· sin guardar' : '');

    const der = c.createDiv({ cls: 'ulx-cab-der' });
    const boton = (texto, cls, fn) => {
      const b = der.createEl('button', { text: texto });
      if (cls) b.addClass(cls);
      b.addEventListener('click', fn);
      return b;
    };
    boton('Deshacer', '', () => this.deshacer());
    boton('Ver cambios', '', () => this.verCambios());
    boton('Guardar como…', '', () => this.guardarComo());
    boton('Guardar', 'mod-cta', () => this.guardar(this.ruta));
  }

  async rellenarSelector() {
    const hojas = await this.plugin.listarEstilos();
    this.selector.empty();
    for (const h of hojas) {
      const op = this.selector.createEl('option', { text: h.nombre });
      op.value = h.ruta;
      if (h.ruta === this.ruta) op.selected = true;
    }
    const nuevo = this.selector.createEl('option', { text: '— Crear uno nuevo —' });
    nuevo.value = '__nuevo__';
    this.selector.onchange = async () => {
      if (this.selector.value === '__nuevo__') { this.crearNuevo(); return; }
      if (this.sucio()) {
        const seguir = await DIALOGOS.confirmar(this.plugin.app, {
          titulo: 'Hay cambios sin guardar',
          descripcion: 'Si cambias de estilo se pierden. ¿Continuar?',
          aceptar: 'Cambiar igualmente',
          peligro: true,
        });
        if (!seguir) { this.rellenarSelector(); return; }
      }
      await this.cargar(this.selector.value);
    };
  }

  pintarPestanas() {
    this.barra.empty();
    for (const p of PESTANAS) {
      const b = this.barra.createEl('button', { text: p.titulo, cls: 'ulx-pestana' });
      if (p.id === this.pestana) b.addClass('ulx-activo');
      b.addEventListener('click', () => { this.pestana = p.id; this.busqueda = ''; this.pintar(); });
    }
    const buscador = this.barra.createEl('input', { cls: 'ulx-buscar' });
    buscador.type = 'search';
    buscador.placeholder = 'Buscar en todos los ajustes…';
    buscador.value = this.busqueda;
    buscador.addEventListener('input', () => {
      this.busqueda = buscador.value.trim();
      this.pintar();
      const nuevo = this.barra.querySelector('.ulx-buscar');
      if (nuevo) { nuevo.focus(); nuevo.setSelectionRange(nuevo.value.length, nuevo.value.length); }
    });
  }

  /* --------------------------- previsualizacion --------------------------- */

  previsualizar(inmediato) {
    if (this.temporizador) window.clearTimeout(this.temporizador);
    const hacer = async () => {
      if (!this.texto || !this.marco) return;
      try {
        const hoja = ULSS.cargar(this.texto);
        let fuente = DOCUMENTO_MUESTRA;
        if (this.usarNota) {
          const f = this.plugin.app.workspace.getActiveFile();
          if (f && f.extension === 'md') fuente = await this.plugin.app.vault.cachedRead(f);
        }
        const doc = MARKDOWN.analizar(fuente);
        const html = ENSAMBLADO.construirHtml(doc, hoja, {
          tamanoPagina: this.plugin.ajustes.tamanoPagina,
          idioma: 'es',
          previsualizacion: true,
          guias: this.guias,
          modoLineas: this.plugin.ajustes.modoLineas,
          anchoTabuladorEm: this.plugin.ajustes.anchoTabuladorEm || 0,
          sangriaVersoEm: this.plugin.ajustes.sangriaVersoEm,
          encabezadosBibliografia: this.plugin.ajustes.encabezadosBibliografia,
          numeroInicial: this.plugin.ajustes.numeroInicial,
          desdePagina: this.plugin.ajustes.desdePagina,
        });
        this.marco.srcdoc = html;
        this.aplicarZoom();
        this.aviso.setText('');
        this.aviso.removeClass('ulx-error');
      } catch (e) {
        this.aviso.setText('La hoja no compila: ' + (e && e.message ? e.message : e));
        this.aviso.addClass('ulx-error');
      }
    };
    if (inmediato) hacer();
    else this.temporizador = window.setTimeout(hacer, 160);
  }

  aplicarZoom() {
    if (!this.marco) return;
    this.marco.style.transform = `scale(${this.zoom})`;
    this.marco.style.width = `${100 / this.zoom}%`;
    this.marco.style.height = `${100 / this.zoom}%`;
  }

  /* --------------------------- controles --------------------------- */

  /** Escribe una propiedad y refresca lo que haga falta. */
  aplicar(selector, propiedad, valor, repintar) {
    this.pila.push(this.texto);
    if (this.pila.length > 60) this.pila.shift();
    const limpio = valor === null || valor === undefined ? null : String(valor).trim();
    this.texto = EDITOR.escribirPropiedad(this.texto, selector, propiedad, limpio === '' ? null : limpio);
    this.pintarCabecera();
    if (repintar) this.pintar();
    else this.previsualizar();
  }

  deshacer() {
    if (!this.pila.length) { new Notice('No hay nada que deshacer.'); return; }
    this.texto = this.pila.pop();
    this.pintar();
  }

  /** La hoja ya resuelta, para saber que valor se aplica de verdad. */
  hojaResuelta() {
    if (this.hojaCache && this.hojaCacheDe === this.texto) return this.hojaCache;
    try { this.hojaCache = ULSS.cargar(this.texto); }
    catch (e) { this.hojaCache = null; }
    this.hojaCacheDe = this.texto;
    return this.hojaCache;
  }

  cuerpoBase() {
    try { return ULSS.cargar(this.texto).puntos('defaults', 'font-size', 12, 12); }
    catch (e) { return 12; }
  }

  /** Fila generica: etiqueta, control y boton de revertir si cambió. */
  fila(cont, campo) {
    const f = cont.createDiv({ cls: 'ulx-fila' });
    const izq = f.createDiv({ cls: 'ulx-fila-txt' });
    izq.createDiv({ cls: 'ulx-etiqueta', text: campo.etiqueta });
    const pista = izq.createDiv({ cls: 'ulx-pista' });

    const derecha = f.createDiv({ cls: 'ulx-fila-ctl' });

    const actual = EDITOR.leerPropiedad(this.texto, campo.selector, campo.propiedad);
    const inicial = this.original === null ? actual : EDITOR.leerPropiedad(this.original, campo.selector, campo.propiedad);
    if (actual !== inicial) {
      f.addClass('ulx-cambiado');
      const rev = derecha.createEl('button', { text: '↺', cls: 'ulx-revertir' });
      rev.title = `Volver a ${inicial === null ? '(sin definir)' : inicial}`;
      rev.addEventListener('click', () => this.aplicar(campo.selector, campo.propiedad, inicial, true));
    }

    // De donde sale el valor que se aplica: propio, heredado o variable.
    const info = EDITOR.explicar(this.hojaResuelta(), this.texto, campo.selector, campo.propiedad);
    const base = campo.ayuda ? campo.ayuda : `${campo.selector} · ${campo.propiedad}`;
    pista.setText(info.nota ? `${info.nota} · ${base}` : base);
    if (info.nota) f.addClass('ulx-heredado');

    return { fila: f, control: derecha, pista, actual, info };
  }

  control(cont, campo) {
    if (campo.propiedad === 'font-family') return this.ctlFuente(cont, campo);
    if (campo.tipo === 'opcion') return this.ctlOpcion(cont, campo);
    if (campo.tipo === 'color') return this.ctlColor(cont, campo);
    if (campo.tipo === 'longitud') return this.ctlMedida(cont, campo);
    return this.ctlTexto(cont, campo);
  }

  ctlMedida(cont, campo) {
    const { control, pista, actual, info } = this.fila(cont, campo);
    const m = EDITOR.parsearMedida(actual);
    const ctx = this.cuerpoBase();

    const num = control.createEl('input', { cls: 'ulx-num' });
    num.type = 'number';
    num.step = '0.5';
    num.value = m ? String(m.numero) : '';
    // Si no lo declara, el marcador enseña lo que se aplica igualmente.
    const heredado = EDITOR.parsearMedida(info && info.marcador);
    num.placeholder = heredado ? String(heredado.numero) : '—';

    const uni = control.createEl('select', { cls: 'ulx-uni' });
    for (const u of EDITOR.UNIDADES) {
      const op = uni.createEl('option', { text: u });
      op.value = u;
      if (m && m.unidad === u) op.selected = true;
      else if (!m && heredado && heredado.unidad === u) op.selected = true;
    }
    if (m && !m.unidad) {
      const op = uni.createEl('option', { text: '(sin unidad)' });
      op.value = ''; op.selected = true;
    }

    const refrescarPista = () => {
      const v = num.value === '' ? null : EDITOR.formatearMedida(parseFloat(num.value), uni.value);
      pista.setText(
        (v ? EDITOR.equivalencia(v, ctx) + ' · ' : '') + `${campo.selector} · ${campo.propiedad}`
      );
    };
    refrescarPista();

    const emitir = () => {
      if (num.value === '') { this.aplicar(campo.selector, campo.propiedad, null); refrescarPista(); return; }
      const n = parseFloat(num.value);
      if (!Number.isFinite(n)) return;
      this.aplicar(campo.selector, campo.propiedad, EDITOR.formatearMedida(n, uni.value));
      refrescarPista();
    };
    num.addEventListener('input', emitir);
    uni.addEventListener('change', () => {
      // Al cambiar de unidad se conserva el tamaño, no el número.
      const anterior = EDITOR.parsearMedida(EDITOR.leerPropiedad(this.texto, campo.selector, campo.propiedad));
      if (anterior && anterior.unidad && uni.value && anterior.unidad !== uni.value) {
        const convertido = EDITOR.convertir(anterior.numero, anterior.unidad, uni.value, ctx);
        num.value = String(Math.round(convertido * 1000) / 1000);
      }
      emitir();
    });
  }

  ctlFuente(cont, campo) {
    const { control, pista, actual, info } = this.fila(cont, campo);
    const efectiva = (info && info.marcador ? info.marcador : '').replace(/^["']|["']$/g, '');
    const limpio = String(actual || '').replace(/^["']|["']$/g, '') || efectiva;

    const sel = control.createEl('select', { cls: 'ulx-fuente' });
    const vacio = sel.createEl('option', {
      text: efectiva ? `(hereda ${efectiva})` : '(heredada)',
    });
    vacio.value = '';
    if (actual === null) vacio.selected = true;

    const usadas = this.plugin.fuentesConocidas();
    const instaladas = this.fuentes.lista;
    const grupo = (etiqueta, familias) => {
      if (!familias.length) return;
      const g = sel.createEl('optgroup');
      g.label = etiqueta;
      for (const f of familias) {
        const op = g.createEl('option', { text: f });
        op.value = f;
        op.style.fontFamily = `"${f}"`;
        if (f === limpio) op.selected = true;
      }
    };
    grupo('En tus estilos', usadas.filter((f) => instaladas.includes(f)));
    grupo('Instaladas', instaladas.filter((f) => !usadas.includes(f)));
    const ausentes = usadas.filter((f) => !instaladas.includes(f));
    grupo('No instaladas (se sustituirán)', ausentes);
    if (limpio && !instaladas.includes(limpio) && !usadas.includes(limpio)) {
      const op = sel.createEl('option', { text: `${limpio} (no instalada)` });
      op.value = limpio; op.selected = true;
    }

    const muestra = control.createDiv({ cls: 'ulx-muestra' });
    const refrescar = (familia) => {
      muestra.style.fontFamily = familia ? `"${familia}"` : 'inherit';
      muestra.setText(familia ? MUESTRA_TIPOGRAFICA : '');
      if (familia && !FUENTES.comprobar(familia)) {
        pista.setText(`No está instalada: se compondrá con otra. · ${campo.selector}`);
        pista.addClass('ulx-error');
      } else {
        pista.setText(`${campo.selector} · ${campo.propiedad}`);
        pista.removeClass('ulx-error');
      }
    };
    refrescar(limpio);

    sel.addEventListener('change', () => {
      const v = sel.value;
      this.aplicar(campo.selector, campo.propiedad, v ? `"${v}"` : null);
      refrescar(v);
    });
  }

  ctlOpcion(cont, campo) {
    const { control, actual, info } = this.fila(cont, campo);
    const sel = control.createEl('select', { cls: 'ulx-opcion' });
    let encaja = false;
    for (const [v, etiqueta] of campo.opciones) {
      // La opcion vacia dice que se hereda, en vez de «(heredada)» a secas.
      const texto =
        v === '' && info && info.marcador ? `(${info.marcador})` : etiqueta;
      const op = sel.createEl('option', { text: texto });
      op.value = v;
      if (v === actual) { op.selected = true; encaja = true; }
    }
    if (actual !== null && !encaja) {
      const op = sel.createEl('option', { text: `${actual} (actual)` });
      op.value = actual; op.selected = true;
    }
    sel.addEventListener('change', () => this.aplicar(campo.selector, campo.propiedad, sel.value || null));
  }

  ctlColor(cont, campo) {
    const { control, actual } = this.fila(cont, campo);
    const color = control.createEl('input', { cls: 'ulx-color' });
    color.type = 'color';
    color.value = /^#[0-9a-f]{6}$/i.test(actual || '') ? actual : '#000000';
    const texto = control.createEl('input', { cls: 'ulx-txt' });
    texto.value = actual === null ? '' : actual;
    texto.placeholder = '#333333';
    color.addEventListener('input', () => {
      texto.value = color.value;
      this.aplicar(campo.selector, campo.propiedad, color.value);
    });
    texto.addEventListener('input', () => this.aplicar(campo.selector, campo.propiedad, texto.value || null));
  }

  ctlTexto(cont, campo) {
    const { control, actual, info } = this.fila(cont, campo);
    const input = control.createEl('input', { cls: 'ulx-txt' });
    input.value = actual === null ? '' : actual;
    input.placeholder = (info && info.marcador) || campo.ayuda || '';
    input.addEventListener('input', () => this.aplicar(campo.selector, campo.propiedad, input.value || null));
  }

  /* --------------------------- secciones --------------------------- */

  grupo(cont, titulo, descripcion) {
    const g = cont.createDiv({ cls: 'ulx-grupo' });
    g.createEl('h3', { text: titulo });
    if (descripcion) g.createEl('p', { cls: 'ulx-desc', text: descripcion });
    return g;
  }

  buscar(selector, propiedad) {
    const de = (s) => EDITOR.SECCIONES.flatMap((x) => x.campos).find(
      (c) => c.selector === s && c.propiedad === propiedad
    );
    return de(selector) || { selector, propiedad, etiqueta: propiedad, tipo: 'texto' };
  }

  seccionBasico(cont) {
    const g = this.grupo(cont, 'Lo esencial', 'Las decisiones que definen el estilo. Todo lo demás hereda de aquí.');
    for (const [sel, prop] of [
      ['defaults', 'font-family'], ['defaults', 'font-size'], ['defaults', 'line-height'],
      ['defaults', 'text-alignment'], ['defaults', 'hyphenation'], ['defaults', 'orphans-and-widows'],
    ]) this.control(g, this.buscar(sel, prop));

    const m = this.grupo(cont, 'Márgenes de página');
    for (const p of ['page-inset-top', 'page-inset-bottom', 'page-inset-inner', 'page-inset-outer']) {
      this.control(m, this.buscar('document-settings', p));
    }

    const s = this.grupo(cont, 'Sangría del texto');
    for (const [sel, prop] of [
      ['paragraph', 'first-line-indent'], ['paragraph :first', 'first-line-indent'],
      ['heading-all + paragraph', 'first-line-indent'],
      ['paragraph', 'margin-top'], ['paragraph', 'margin-bottom'],
    ]) this.control(s, this.buscar(sel, prop));

    this.atajos(cont);
  }

  atajos(cont) {
    const g = this.grupo(cont, 'Atajos', 'Cambios que tocan todo el estilo de una vez.');
    const barra = g.createDiv({ cls: 'ulx-botonera' });

    const escalar = (delta) => {
      this.pila.push(this.texto);
      this.texto = EDITOR.escalarCuerpos(this.texto, delta);
      this.pintar();
      new Notice(`Cuerpos ${delta > 0 ? 'aumentados' : 'reducidos'} un punto.`);
    };
    barra.createEl('button', { text: 'Cuerpo +1 pt' }).addEventListener('click', () => escalar(1));
    barra.createEl('button', { text: 'Cuerpo −1 pt' }).addEventListener('click', () => escalar(-1));

    const cambiar = barra.createEl('button', { text: 'Cambiar todas las tipografías…' });
    cambiar.addEventListener('click', async () => {
      const usadas = EDITOR.selectoresCon(this.texto, 'font-family');
      const nueva = await DIALOGOS.pedirTexto(this.plugin.app, {
        titulo: 'Cambiar todas las tipografías',
        descripcion: `Afecta a ${usadas.length} bloques: ${usadas.join(', ')}.`,
        etiqueta: 'Nueva familia',
        valor: this.fuentes.lista[0] || 'Times New Roman',
      });
      if (!nueva) return;
      this.pila.push(this.texto);
      this.texto = EDITOR.reemplazarFuentes(this.texto, nueva);
      this.pintar();
    });
  }

  seccionTitulares(cont) {
    this.grupo(cont, 'Titulares', 'Cada fila se muestra tal y como quedará. Pulsa para ajustarla.');
    let hoja = null;
    try { hoja = ULSS.cargar(this.texto); } catch (e) { /* ya avisa la previa */ }
    const base = hoja ? DOCX.atributosBase(hoja) : null;

    for (let n = 1; n <= 6; n++) {
      const det = cont.createEl('details', { cls: 'ulx-titular' });
      const sum = det.createEl('summary');
      const muestra = sum.createDiv({ cls: 'ulx-titular-muestra' });
      muestra.setText(`Titular de nivel ${n}`);
      const datos = sum.createDiv({ cls: 'ulx-titular-datos' });

      if (hoja && base) {
        const a = DOCX.atributos(hoja, ['heading-all', `heading-${n}`], Object.assign({}, base));
        const fam = (a.familia || base.familia || '').split(',')[0].replace(/^["']|["']$/g, '');
        muestra.style.fontFamily = fam ? `"${fam}"` : 'inherit';
        muestra.style.fontSize = `${Math.min(a.tamano || 12, 34)}pt`;
        muestra.style.fontWeight = a.negrita ? '700' : '400';
        muestra.style.fontStyle = a.cursiva ? 'italic' : 'normal';
        muestra.style.textDecoration = a.subrayado ? 'underline' : 'none';
        muestra.style.textAlign = a.alineacion === 'both' ? 'justify' : a.alineacion || 'left';
        datos.setText(
          `${Math.round((a.tamano || 0) * 10) / 10} pt` +
            (a.interlineado ? ` / ${Math.round(a.interlineado * 10) / 10}` : '') +
            (a.negrita ? ' · negrita' : '') +
            (a.cursiva ? ' · cursiva' : '')
        );
      }

      const dentro = det.createDiv({ cls: 'ulx-titular-campos' });
      const seccion = EDITOR.SECCIONES.find((s) => s.titulo === `Titular de nivel ${n}`);
      for (const campo of seccion.campos) this.control(dentro, campo);
    }
  }

  seccionBloques(cont) {
    for (const titulo of ['Cita en bloque', 'Bloque de código', 'Listas', 'Divisor', 'Tablas']) {
      const seccion = EDITOR.SECCIONES.find((s) => s.titulo === titulo);
      if (!seccion) continue;
      const g = this.grupo(cont, titulo);
      for (const campo of seccion.campos) this.control(g, campo);
    }
  }

  seccionTexto(cont) {
    const seccion = EDITOR.SECCIONES.find((s) => s.titulo === 'Estilos de texto');
    const g = this.grupo(cont, 'Estilos de texto', 'Cómo se ven la negrita, la cursiva, los enlaces y el código.');
    for (const campo of seccion.campos) this.control(g, campo);
  }

  seccionPagina(cont) {
    for (const titulo of ['Página', 'Pie de página y notas', 'Párrafo']) {
      const seccion = EDITOR.SECCIONES.find((s) => s.titulo === titulo);
      if (!seccion) continue;
      const g = this.grupo(cont, titulo);
      for (const campo of seccion.campos) this.control(g, campo);
    }
  }

  /** Control para un ajuste del plugin (no de la hoja). */
  ajustePlugin(cont, etiqueta, ayuda, clave, tipo, opciones) {
    const f = cont.createDiv({ cls: 'ulx-fila' });
    const izq = f.createDiv({ cls: 'ulx-fila-txt' });
    izq.createDiv({ cls: 'ulx-etiqueta', text: etiqueta });
    izq.createDiv({ cls: 'ulx-pista', text: ayuda });
    const der = f.createDiv({ cls: 'ulx-fila-ctl' });

    const guardar = async (valor) => {
      this.plugin.ajustes[clave] = valor;
      await this.plugin.saveData(this.plugin.ajustes);
      this.previsualizar();
    };

    if (tipo === 'opcion') {
      const sel = der.createEl('select', { cls: 'ulx-opcion' });
      for (const [v, e] of opciones) {
        const op = sel.createEl('option', { text: e });
        op.value = v;
        if (v === this.plugin.ajustes[clave]) op.selected = true;
      }
      sel.addEventListener('change', () => guardar(sel.value));
    } else if (tipo === 'numero') {
      const num = der.createEl('input', { cls: 'ulx-num' });
      num.type = 'number';
      num.value = String(this.plugin.ajustes[clave]);
      num.addEventListener('input', () => {
        const n = parseFloat(num.value);
        if (Number.isFinite(n)) guardar(n);
      });
    } else if (tipo === 'lineas') {
      const area = der.createEl('textarea', { cls: 'ulx-crudo' });
      area.rows = 4;
      area.value = (this.plugin.ajustes[clave] || []).join('\n');
      area.addEventListener('input', () =>
        guardar(area.value.split('\n').map((x) => x.trim()).filter(Boolean))
      );
    }
    return f;
  }

  seccionExtensiones(cont) {
    const intro = this.grupo(
      cont, 'Extensiones del plugin',
      'Cosas que Ulysses no sabe hacer y este plugin sí. Al exportar desde ' +
        'Ulysses el resultado será distinto: es a propósito.'
    );
    void intro;

    const bib = this.grupo(
      cont, 'Bibliografía',
      'El formato .ulss no tiene selector de bibliografía, así que Ulysses no ' +
        'puede dar sangría francesa a las referencias. Aquí sí.'
    );
    this.ajustePlugin(
      bib, 'Títulos que la activan',
      'Uno por línea. Los párrafos bajo un titular con alguno de estos nombres llevan sangría francesa.',
      'encabezadosBibliografia', 'lineas'
    );
    for (const prop of ['first-line-indent', 'margin-left']) {
      this.control(bib, this.buscar('paragraph-bibliography', prop));
    }
    bib.createEl('p', {
      cls: 'ulx-desc',
      text:
        'Si el estilo no define «paragraph-bibliography», se usan 12,5 mm de ' +
        'sangría francesa, que es la norma APA.',
    });

    const verso = this.grupo(
      cont, 'Verso y sangría',
      'Ulysses une las líneas seguidas y pierde las estrofas. Aquí se puede elegir.'
    );
    this.ajustePlugin(
      verso, 'Líneas dentro de un párrafo', 'Qué hacer con varias líneas seguidas.',
      'modoLineas', 'opcion',
      [
        ['auto', 'Automático (verso si hay sangría o líneas cortas)'],
        ['verso', 'Siempre verso: cada línea, un párrafo'],
        ['salto', 'Salto de línea dentro del mismo párrafo'],
        ['parrafo', 'Unir en un solo párrafo'],
      ]
    );
    this.ajustePlugin(
      verso, 'Ancho del tabulador',
      'En cuadratines. Con 0 se usa el «default-tab-interval» del estilo, y si no lo declara, 4em.',
      'anchoTabuladorEm', 'numero'
    );
    this.ajustePlugin(
      verso, 'Sangría francesa del verso',
      'En cuadratines. La vuelta del verso que no cabe se sangra para no confundirla con otro verso. 0 lo desactiva.',
      'sangriaVersoEm', 'numero'
    );

    const num = this.grupo(
      cont, 'Numeración de páginas',
      'Para portadas y preliminares: qué página empieza a contar y con qué número.'
    );
    this.ajustePlugin(
      num, 'Primera página numerada',
      'Página física a partir de la cual se muestra el número. Con 2, la primera no lleva nada.',
      'desdePagina', 'numero'
    );
    this.ajustePlugin(
      num, 'Número que le corresponde',
      'Qué número lleva esa página. Con «primera numerada = 2» y «número = 1», la segunda hoja es la página 1.',
      'numeroInicial', 'numero'
    );
    num.createEl('p', {
      cls: 'ulx-desc',
      text:
        'El estilo puede además ocultar el pie de la primera página con ' +
        '«area-footer :first-page { content: none }». Aviso: Word solo sabe ' +
        'distinguir la primera página, así que un valor mayor que 2 se ve ' +
        'bien aquí pero no se traslada entero al DOCX.',
    });

    const com = this.grupo(cont, 'Comentarios');
    this.ajustePlugin(
      com, 'Incluir los comentarios %% %%',
      'El estilo manda: si declara «block-comment { visibility: visible }» salen igualmente.',
      'incluirComentarios', 'opcion', [[true, 'Sí'], [false, 'No']]
    );
  }

  seccionAvanzado(cont) {
    const g = this.grupo(
      cont, 'Todas las propiedades',
      'La rejilla completa, agrupada como en el fichero .ulss.'
    );
    for (const seccion of EDITOR.SECCIONES) {
      const det = g.createEl('details');
      det.createEl('summary', { text: seccion.titulo });
      const dentro = det.createDiv();
      for (const campo of seccion.campos) this.control(dentro, campo);
    }

    const crudo = this.grupo(cont, 'Fichero .ulss', 'Para lo que la interfaz no cubre. Se valida al aplicar.');
    const area = crudo.createEl('textarea', { cls: 'ulx-crudo' });
    area.value = this.texto;
    area.rows = 18;
    const botones = crudo.createDiv({ cls: 'ulx-botonera' });
    botones.createEl('button', { text: 'Aplicar', cls: 'mod-cta' }).addEventListener('click', () => {
      try {
        ULSS.cargar(area.value);
        this.pila.push(this.texto);
        this.texto = area.value;
        this.pintar();
        new Notice('Aplicado.');
      } catch (e) {
        new Notice('No se aplica: ' + (e && e.message ? e.message : e));
      }
    });
  }

  seccionBusqueda(cont) {
    const aguja = this.busqueda.toLowerCase();
    const g = this.grupo(cont, `Resultados para «${this.busqueda}»`);
    let n = 0;
    for (const seccion of EDITOR.SECCIONES) {
      for (const campo of seccion.campos) {
        const heno = `${campo.etiqueta} ${campo.selector} ${campo.propiedad} ${seccion.titulo} ${campo.ayuda || ''}`.toLowerCase();
        if (!heno.includes(aguja)) continue;
        this.control(g, campo);
        n++;
      }
    }
    if (!n) g.createEl('p', { text: 'Nada coincide.' });
  }

  /* --------------------------- biblioteca --------------------------- */

  async seccionBiblioteca(cont) {
    const g = this.grupo(
      cont, 'Biblioteca de estilos',
      'Los que estén marcados son los que aparecen al exportar. El resto siguen instalados.'
    );
    const hojas = await this.plugin.listarEstilos();
    const visibles = this.plugin.ajustes.estilosVisibles || [];

    const lista = g.createDiv({ cls: 'ulx-biblioteca' });
    for (const h of hojas) {
      const fila = lista.createDiv({ cls: 'ulx-bib-fila' });

      const check = fila.createEl('input', { cls: 'ulx-bib-check' });
      check.type = 'checkbox';
      check.checked = visibles.includes(h.nombre);
      check.addEventListener('change', async () => {
        const actuales = new Set(this.plugin.ajustes.estilosVisibles || []);
        if (check.checked) actuales.add(h.nombre); else actuales.delete(h.nombre);
        this.plugin.ajustes.estilosVisibles = Array.from(actuales);
        await this.plugin.saveData(this.plugin.ajustes);
      });

      const txt = fila.createDiv({ cls: 'ulx-bib-txt' });
      const titulo = txt.createDiv({ cls: 'ulx-bib-nombre' });
      titulo.setText(h.nombre);
      if (h.nombre === this.plugin.ajustes.estiloPorDefecto) {
        titulo.createSpan({ cls: 'ulx-etiqueta-mini', text: 'por defecto' });
      }
      const sub = txt.createDiv({ cls: 'ulx-pista' });
      try {
        const hoja = ULSS.cargar(await this.plugin.app.vault.adapter.read(h.ruta));
        sub.setText(EDITOR.resumen(hoja));
      } catch (e) {
        sub.setText('no se pudo leer');
      }

      const acciones = fila.createDiv({ cls: 'ulx-bib-acc' });
      const boton = (t, fn) => acciones.createEl('button', { text: t, cls: 'ulx-mini' }).addEventListener('click', fn);
      boton('Editar', () => this.cargar(h.ruta));
      boton('Duplicar', () => this.duplicar(h));
      boton('Predeterminado', async () => {
        this.plugin.ajustes.estiloPorDefecto = h.nombre;
        await this.plugin.saveData(this.plugin.ajustes);
        this.pintar();
      });
      boton('Borrar', () => this.borrar(h));
    }

    const barra = g.createDiv({ cls: 'ulx-botonera' });
    barra.createEl('button', { text: 'Crear un estilo…', cls: 'mod-cta' })
      .addEventListener('click', () => this.crearNuevo());
    barra.createEl('button', { text: 'Marcar todos' }).addEventListener('click', async () => {
      this.plugin.ajustes.estilosVisibles = hojas.map((h) => h.nombre);
      await this.plugin.saveData(this.plugin.ajustes);
      this.pintar();
    });
    barra.createEl('button', { text: 'Desmarcar todos' }).addEventListener('click', async () => {
      this.plugin.ajustes.estilosVisibles = [];
      await this.plugin.saveData(this.plugin.ajustes);
      this.pintar();
    });
  }

  async duplicar(h) {
    const nombre = await DIALOGOS.pedirTexto(this.plugin.app, {
      titulo: 'Duplicar estilo', etiqueta: 'Nombre de la copia', valor: h.nombre + ' (copia)',
    });
    if (!nombre) return;
    try {
      const texto = await this.plugin.app.vault.adapter.read(h.ruta);
      const destino = `${this.plugin.carpetaDeEstilosEscribible()}/${nombre.trim()}.ulss`;
      await this.plugin.escribirEstilo(destino, texto);
      new Notice('Copia creada.');
      await this.cargar(destino);
    } catch (e) {
      new Notice('No se pudo duplicar: ' + (e && e.message ? e.message : e));
    }
  }

  async borrar(h) {
    const seguro = await DIALOGOS.confirmar(this.plugin.app, {
      titulo: `¿Borrar «${h.nombre}»?`,
      descripcion: 'No se puede deshacer.',
      aceptar: 'Borrar', peligro: true,
    });
    if (!seguro) return;
    try {
      await this.plugin.app.vault.adapter.remove(h.ruta);
      this.plugin.cacheHojas.clear();
      if (this.ruta === h.ruta) { this.texto = null; this.original = null; this.ruta = null; this.nombre = null; }
      new Notice('Estilo borrado.');
      this.pintar();
    } catch (e) {
      new Notice('No se pudo borrar: ' + (e && e.message ? e.message : e));
    }
  }

  async crearNuevo() {
    const nombre = await DIALOGOS.pedirTexto(this.plugin.app, {
      titulo: 'Crear un estilo', etiqueta: 'Nombre', valor: 'Mi estilo',
    });
    if (!nombre) { this.rellenarSelector(); return; }
    const destino = `${this.plugin.carpetaDeEstilosEscribible()}/${nombre.trim()}.ulss`;
    try {
      await this.plugin.escribirEstilo(destino, EDITOR.plantilla(nombre.trim()));
      await this.cargar(destino);
      new Notice('Estilo creado.');
    } catch (e) {
      new Notice('No se pudo crear: ' + (e && e.message ? e.message : e));
    }
  }

  /* --------------------------- guardar --------------------------- */

  verCambios() {
    const campos = EDITOR.SECCIONES.flatMap((s) => s.campos);
    const difs = EDITOR.diferencias(this.original || '', this.texto, campos);
    new ModalCambios(this.plugin.app, this.nombre, difs).open();
  }

  async guardar(destino) {
    if (!destino) { this.guardarComo(); return; }
    try { ULSS.cargar(this.texto); }
    catch (e) {
      new Notice('No se guarda: la hoja tiene un error. ' + (e && e.message ? e.message : e));
      return;
    }
    try {
      await this.plugin.escribirEstilo(destino, this.texto, this.original);
      this.original = this.texto;
      this.ruta = destino;
      this.nombre = destino.split('/').pop().replace(/\.ulss$/i, '');
      this.pintarCabecera();
      new Notice(`Guardado en ${destino}`);
    } catch (e) {
      new Notice('No se pudo guardar: ' + (e && e.message ? e.message : e));
    }
  }

  async guardarComo() {
    const nombre = await DIALOGOS.pedirTexto(this.plugin.app, {
      titulo: 'Guardar como', etiqueta: 'Nombre', valor: (this.nombre || 'Mi estilo') + ' (copia)',
    });
    if (!nombre) return;
    this.guardar(`${this.plugin.carpetaDeEstilosEscribible()}/${nombre}.ulss`);
  }
}

/* ------------------------------------------------------------------ *
 * Modal con el resumen de cambios
 * ------------------------------------------------------------------ */

class ModalCambios extends Modal {
  constructor(app, nombre, difs) {
    super(app);
    this.nombre = nombre;
    this.difs = difs;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: `Cambios en ${this.nombre}` });
    if (!this.difs.length) {
      contentEl.createEl('p', { text: 'No hay ninguno.' });
      return;
    }
    const tabla = contentEl.createEl('table', { cls: 'ulx-tabla-cambios' });
    const cab = tabla.createEl('tr');
    for (const t of ['Selector', 'Propiedad', 'Antes', 'Ahora']) cab.createEl('th', { text: t });
    for (const d of this.difs) {
      const fila = tabla.createEl('tr');
      fila.createEl('td', { text: d.selector });
      fila.createEl('td', { text: d.propiedad });
      fila.createEl('td', { text: d.antes === null ? '—' : d.antes });
      fila.createEl('td', { text: d.despues === null ? '—' : d.despues });
    }
  }

  onClose() { this.contentEl.empty(); }
}

module.exports = { VistaEstilos, ModalCambios, TIPO_VISTA, DOCUMENTO_MUESTRA, PESTANAS };
