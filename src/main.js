'use strict';

/*
 * Ulysses Export para Obsidian
 * ============================
 * Lee hojas .ulss REALES y exporta a PDF, DOCX y HTML.
 */

const ULSS = require('./ulss.js');
const MARKDOWN = require('./markdown.js');
const DOCX = require('./docx.js');
const ENSAMBLADO = require('./ensamblado.js');
const EDITOR = require('./editor.js');
const FUENTES = require('./fuentes.js');
const DIALOGOS = require('./dialogos.js');
const VISTA = require('./vista.js');
const MOTOR = require('./motor.js');
const TYPSTEMISOR = require('./typst.js');
/*
 * Ulysses Export — pegamento con Obsidian.
 * Lee hojas .ulss reales y exporta a PDF, DOCX y HTML.
 */

const obsidian = require('obsidian');
const { Plugin, PluginSettingTab, Setting, Notice, Modal, TFile } = obsidian;
// «Platform» no existe en versiones antiguas: se consulta con cuidado.
const enMovil = () => !!(obsidian.Platform && obsidian.Platform.isMobile);

const DEFECTOS = {
  estiloPorDefecto: 'Universidad',
  estilosVisibles: ['Universidad', 'Novela'],
  mostrarTodos: false,
  tamanoPagina: 'a4',
  carpetaSalida: 'Exportaciones',
  incluirComentarios: false,
  carpetaEstilos: '',
  carpetaFuentes: 'Tipografías',
  modoLineas: 'auto',
  anchoTabuladorEm: 0,
  sangriaVersoEm: 2,
  numeroInicial: 1,
  desdePagina: 1,
  encabezadosBibliografia: [
    'Bibliografía',
    'Referencias',
    'Referencias bibliográficas',
    'Obras citadas',
  ],
};

const MIMES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

/* ------------------------------------------------------------------ *
 * Dimensiones de imagen (sin decodificar el bitmap entero)
 * ------------------------------------------------------------------ */

function dimensiones(bytes, extension) {
  try {
    const b = new Uint8Array(bytes);
    const ext = (extension || '').toLowerCase();

    if (ext === 'png' && b.length > 24) {
      const v = new DataView(b.buffer, b.byteOffset);
      return { ancho: v.getUint32(16), alto: v.getUint32(20) };
    }

    if ((ext === 'jpg' || ext === 'jpeg') && b.length > 4) {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xff) {
          i++;
          continue;
        }
        const marca = b[i + 1];
        // SOF0..SOF15, saltando DHT/DAC/RST
        if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
          const v = new DataView(b.buffer, b.byteOffset);
          return { alto: v.getUint16(i + 5), ancho: v.getUint16(i + 7) };
        }
        const largo = (b[i + 2] << 8) | b[i + 3];
        i += 2 + largo;
      }
    }

    if (ext === 'gif' && b.length > 10) {
      return { ancho: b[6] | (b[7] << 8), alto: b[8] | (b[9] << 8) };
    }
  } catch (e) {
    /* si no se puede, se escala al ancho util */
  }
  return null;
}

function aBase64(buffer) {
  if (obsidian.arrayBufferToBase64) return obsidian.arrayBufferToBase64(buffer);
  const b = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

/* ------------------------------------------------------------------ *
 * Plugin
 * ------------------------------------------------------------------ */

class UlyssesExport extends Plugin {
  async onload() {
    this.ajustes = Object.assign({}, DEFECTOS, await this.loadData());
    this.cacheHojas = new Map();

    this.addCommand({
      id: 'exportar-con-estilo',
      name: 'Exportar con un estilo de Ulysses…',
      checkCallback: (comprobando) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!comprobando) new DialogoExportar(this.app, this, file).open();
        return true;
      },
    });

    this.registerView(VISTA.TIPO_VISTA, (leaf) => new VISTA.VistaEstilos(leaf, this));

    this.addCommand({
      id: 'editar-estilo',
      name: 'Crear o editar un estilo de exportación…',
      callback: () => this.abrirEditorDeEstilos(),
    });

    this.addCommand({
      id: 'preparar-sin-conexion',
      name: 'Preparar para usar sin conexión (motor y tipografías)',
      callback: async () => {
        const aviso = new Notice('Preparando…', 0);
        try {
          const pasos = await MOTOR.prepararSinConexion(this.entornoMotor(), (m) => new Notice(m));
          new Notice('Listo: ' + pasos.join('; '), 8000);
        } catch (e) {
          console.error('[Ulysses Export]', e);
          new Notice(`No se pudo preparar: ${e && e.message ? e.message : e}`, 8000);
        } finally {
          aviso.hide();
        }
      },
    });

    this.addCommand({
      id: 'recargar-estilos',
      name: 'Recargar las hojas de estilo',
      callback: async () => {
        this.cacheHojas.clear();
        const hojas = await this.listarEstilos();
        new Notice(`${hojas.length} hojas de estilo encontradas.`);
      },
    });

    this.addSettingTab(new AjustesExport(this.app, this));
  }

  /* --- localizacion de las hojas --- */

  carpetasDeEstilos() {
    const carpetas = [`${this.manifest.dir}/estilos`];
    if (this.ajustes.carpetaEstilos) carpetas.push(this.ajustes.carpetaEstilos.replace(/^\/+|\/+$/g, ''));
    return carpetas;
  }

  /**
   * Saca el nombre legible de un paquete .ulstyle leyendo su Info.plist,
   * que es XML plano. Asi un estilo instalado en Ulysses aparece con su
   * nombre («Universidad») y no con el identificador hexadecimal.
   */
  async nombreDePaquete(carpeta) {
    try {
      const plist = await this.app.vault.adapter.read(carpeta + '/Info.plist');
      const m = /<key>displayName<\/key>\s*<string>([^<]*)<\/string>/.exec(plist);
      if (m && m[1].trim()) return m[1].trim();
    } catch (e) {
      /* sin Info.plist legible, nos quedamos con el nombre de la carpeta */
    }
    return carpeta.split('/').pop().replace(/\._?ulstyle$/i, '');
  }

  /**
   * Abre el editor como pestaña. Si ya hay una, la reutiliza: asi no se
   * acumulan pestañas cada vez que se pulsa el boton del menu de exportar.
   */
  async abrirEditorDeEstilos(ruta) {
    this.estiloPendiente = ruta || null;
    const existentes = this.app.workspace.getLeavesOfType(VISTA.TIPO_VISTA);
    if (existentes.length) {
      const hoja = existentes[0];
      this.app.workspace.revealLeaf(hoja);
      if (ruta && hoja.view && hoja.view.cargar) await hoja.view.cargar(ruta);
      return;
    }
    const hoja = this.app.workspace.getLeaf('tab');
    await hoja.setViewState({ type: VISTA.TIPO_VISTA, active: true });
    this.app.workspace.revealLeaf(hoja);
  }

  /** Escribe un .ulss dejando antes una copia de seguridad del anterior. */
  async escribirEstilo(destino, texto, respaldar) {
    const carpeta = destino.slice(0, destino.lastIndexOf('/'));
    if (carpeta && !(await this.app.vault.adapter.exists(carpeta))) {
      await this.app.vault.adapter.mkdir(carpeta);
    }
    if (respaldar && (await this.app.vault.adapter.exists(destino))) {
      try {
        await this.app.vault.adapter.write(destino + '.bak', respaldar);
      } catch (e) {
        console.error('[Ulysses Export] no se pudo respaldar', e);
      }
    }
    await this.app.vault.adapter.write(destino, texto);
    this.cacheHojas.clear();
  }

  /** Salvavidas si se cierra la pestaña con cambios sin guardar. */
  async guardarBorrador(ruta, texto) {
    if (!ruta || !texto) return;
    await this.app.vault.adapter.write(ruta + '.borrador', texto);
  }

  /** Donde se guardan los estilos nuevos: la carpeta del vault si la hay. */
  carpetaDeEstilosEscribible() {
    if (this.ajustes.carpetaEstilos) return this.ajustes.carpetaEstilos.replace(/^\/+|\/+$/g, '');
    return `${this.manifest.dir}/estilos`;
  }

  /** Tipografias que aparecen en los estilos instalados, para sugerirlas. */
  fuentesConocidas() {
    const vistas = new Set();
    for (const f of this.fuentesDeclaradas || []) vistas.add(f);
    for (const hoja of this.cacheHojas.values()) {
      for (const sel of hoja.selectores()) {
        const f = hoja.familia(sel, null);
        if (f) vistas.add(f.split(',')[0].trim());
      }
    }
    for (const f of [
      'Optima', 'Baskerville', 'Avenir Next', 'Hoefler Text', 'Helvetica Neue',
      'Gill Sans', 'Times New Roman', 'Courier New', 'Georgia', 'Palatino',
    ]) vistas.add(f);
    return Array.from(vistas).sort((a, b) => a.localeCompare(b, 'es'));
  }

  async listarEstilos() {
    let encontradas = [];
    const vistas = new Set();

    for (const carpeta of this.carpetasDeEstilos()) {
      let listado;
      try {
        listado = await this.app.vault.adapter.list(carpeta);
      } catch (e) {
        continue; // la carpeta puede no existir: no es un error
      }

      // Hojas sueltas
      for (const ruta of listado.files || []) {
        if (!ruta.toLowerCase().endsWith('.ulss')) continue;
        if (vistas.has(ruta)) continue;
        vistas.add(ruta);
        encontradas.push({ ruta, nombre: ruta.split('/').pop().replace(/\.ulss$/i, '') });
      }

      // Paquetes .ulstyle: una carpeta con Style.ulss dentro
      for (const sub of listado.folders || []) {
        const dentro = sub + '/Style.ulss';
        let existe = false;
        try {
          existe = await this.app.vault.adapter.exists(dentro);
        } catch (e) {
          existe = false;
        }
        if (!existe || vistas.has(dentro)) continue;
        vistas.add(dentro);
        encontradas.push({ ruta: dentro, nombre: await this.nombreDePaquete(sub), paquete: true });
      }
    }

    // Un mismo estilo puede estar en la carpeta del plugin y en la del
    // vault (que es la que se sincroniza con el móvil). Se muestra una
    // sola vez, y manda la del vault: es la que el usuario edita y la
    // única que viaja al teléfono.
    const porNombre = new Map();
    for (const h of encontradas) {
      const previa = porNombre.get(h.nombre);
      const esDelPlugin = h.ruta.startsWith(`${this.manifest.dir}/`);
      if (!previa || (previa.ruta.startsWith(`${this.manifest.dir}/`) && !esDelPlugin)) {
        porNombre.set(h.nombre, h);
      }
    }
    encontradas = Array.from(porNombre.values());

    encontradas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    // De paso apuntamos las tipografias que declaran, para sugerirlas en
    // el editor aunque la hoja no este cargada todavia.
    if (!this.fuentesDeclaradas) {
      this.fuentesDeclaradas = new Set();
      for (const h of encontradas) {
        try {
          const texto = await this.app.vault.adapter.read(h.ruta);
          for (const m of texto.matchAll(/font-family\s*:\s*"([^"]+)"/g)) {
            this.fuentesDeclaradas.add(m[1].trim());
          }
        } catch (e) { /* si una no se lee, seguimos */ }
      }
    }

    return encontradas;
  }

  /**
   * Los que se ofrecen en el dialogo de exportar. Por defecto solo los
   * que el usuario usa de verdad; el resto siguen instalados y se ven
   * activando «mostrar todos» en los ajustes.
   */
  async estilosOfrecidos() {
    const todas = await this.listarEstilos();
    if (this.ajustes.mostrarTodos) return todas;
    const visibles = this.ajustes.estilosVisibles || [];
    if (!visibles.length) return todas;
    const filtradas = todas.filter((h) => visibles.includes(h.nombre));
    return filtradas.length ? filtradas : todas;
  }

  async cargarHoja(ruta) {
    if (this.cacheHojas.has(ruta)) return this.cacheHojas.get(ruta);
    const texto = await this.app.vault.adapter.read(ruta);
    const hoja = ULSS.cargar(texto);
    this.cacheHojas.set(ruta, hoja);
    return hoja;
  }

  /* --- recursos --- */

  resolverImagen(ruta, origen) {
    if (!ruta) return null;
    let file = this.app.metadataCache.getFirstLinkpathDest(ruta, origen);
    if (!file) {
      const nombre = ruta.split('/').pop();
      file = this.app.vault.getFiles().find((f) => f.name === nombre) || null;
    }
    return file;
  }

  async recursosDe(documento, origen) {
    const mapa = new Map();
    const rutas = new Set();

    const recorrer = (bloques) => {
      for (const b of bloques || []) {
        if (b.tipo === 'figure' && b.ruta) rutas.add(b.ruta);
        if (b.bloques) recorrer(b.bloques);
        if (b.items) for (const it of b.items) recorrer(it.bloques);
        const inline = (nodos) => {
          for (const n of nodos || []) {
            if (n.tipo === 'image' && n.ruta) rutas.add(n.ruta);
            if (n.hijos) inline(n.hijos);
          }
        };
        if (b.hijos) inline(b.hijos);
        if (b.cabecera) b.cabecera.forEach(inline);
        if (b.filas) b.filas.forEach((f) => f.forEach(inline));
      }
    };
    recorrer(documento.bloques);

    for (const ruta of rutas) {
      const file = this.resolverImagen(ruta, origen);
      if (!file) continue;
      try {
        const datos = await this.app.vault.readBinary(file);
        const extension = (file.extension || 'png').toLowerCase();
        const dim = dimensiones(datos, extension);
        mapa.set(ruta, {
          datos: new Uint8Array(datos),
          extension,
          mime: MIMES[extension] || 'image/png',
          // px a pt a 96 ppp, que es como se comportan las capturas
          ancho: dim ? dim.ancho * 0.75 : null,
          alto: dim ? dim.alto * 0.75 : null,
          base64: null,
        });
      } catch (e) {
        console.error('[Ulysses Export] no se pudo leer la imagen', ruta, e);
      }
    }

    return mapa;
  }

  /* --- exportacion --- */

  async preparar(file) {
    const texto = await this.app.vault.cachedRead(file);
    const documento = MARKDOWN.analizar(texto);
    const recursos = await this.recursosDe(documento, file.path);
    return { documento, recursos };
  }

  opcionesComunes(file, recursos) {
    return {
      titulo: file.basename,
      tamanoPagina: this.ajustes.tamanoPagina,
      incluirComentarios: this.ajustes.incluirComentarios,
      encabezadosBibliografia: this.ajustes.encabezadosBibliografia,
      modoLineas: this.ajustes.modoLineas,
      anchoTabuladorEm: this.ajustes.anchoTabuladorEm || 0,
      sangriaVersoEm: this.ajustes.sangriaVersoEm,
      numeroInicial: this.ajustes.numeroInicial,
      desdePagina: this.ajustes.desdePagina,
      recursos: (ruta) => recursos.get(ruta) || null,
      recursoUrl: (ruta) => {
        const r = recursos.get(ruta);
        if (!r) return ruta;
        if (!r.base64) r.base64 = aBase64(r.datos.buffer.slice(r.datos.byteOffset, r.datos.byteOffset + r.datos.byteLength));
        return `data:${r.mime};base64,${r.base64}`;
      },
    };
  }

  async exportarDocx(file, rutaHoja) {
    const hoja = await this.cargarHoja(rutaHoja);
    const { documento, recursos } = await this.preparar(file);
    const bytes = ENSAMBLADO.construirDocx(documento, hoja, this.opcionesComunes(file, recursos));
    const destino = await this.guardar(file.basename + '.docx', bytes);
    new Notice(`DOCX guardado en ${destino}`);
  }

  async exportarHtml(file, rutaHoja) {
    const hoja = await this.cargarHoja(rutaHoja);
    const { documento, recursos } = await this.preparar(file);
    const html = ENSAMBLADO.construirHtml(documento, hoja, this.opcionesComunes(file, recursos));
    const destino = await this.guardar(file.basename + '.html', html);
    new Notice(`HTML guardado en ${destino}`);
  }

  /**
   * PDF compuesto por el propio plugin con Typst (WebAssembly): idéntico
   * en escritorio y en el móvil, sin diálogo de impresión.
   */
  async exportarPdf(file, rutaHoja) {
    const hoja = await this.cargarHoja(rutaHoja);
    const { documento, recursos } = await this.preparar(file);
    const { compilador, catalogo } = await MOTOR.prepararMotor(
      this.entornoMotor(),
      hoja,
      DOCX,
      ENSAMBLADO,
      (m) => new Notice(m)
    );
    const opciones = Object.assign(this.opcionesComunes(file, recursos), { catalogo });
    const { pdf, avisos } = MOTOR.compilarPdf(compilador, documento, hoja, opciones);
    const destino = await this.guardar(file.basename + '.pdf', pdf);
    for (const a of avisos) new Notice(a);
    new Notice(`PDF guardado en ${destino}`);
  }

  /** PDF por el diálogo de impresión del sistema (solo escritorio). */
  async exportarPdfImprimiendo(file, rutaHoja) {
    const hoja = await this.cargarHoja(rutaHoja);
    const { documento, recursos } = await this.preparar(file);
    const html = ENSAMBLADO.construirHtml(documento, hoja, this.opcionesComunes(file, recursos));
    await this.imprimir(html);
  }

  /** Cómo lee, escribe y descarga el motor Typst dentro de Obsidian. */
  entornoMotor() {
    const adapter = this.app.vault.adapter;
    const dir = this.manifest.dir;
    const rutaWasm = `${dir}/${MOTOR.FICHERO_COMPILADOR}`;
    const rutaIndice = `${dir}/fuentes-indice.json`;

    const carpetasVault = [`${dir}/fuentes`];
    if (this.ajustes.carpetaFuentes) carpetasVault.push(this.ajustes.carpetaFuentes.replace(/^\/+|\/+$/g, ''));

    const esFuente = (nombre) => /\.(ttf|otf|ttc)$/i.test(nombre);

    return {
      leerWasm: async () => {
        try {
          if (await adapter.exists(rutaWasm)) return new Uint8Array(await adapter.readBinary(rutaWasm));
        } catch (e) { /* no está: se descargará */ }
        return null;
      },
      guardarWasm: async (bytes) => {
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        await adapter.writeBinary(rutaWasm, ab);
      },
      descargar: async (url) => {
        const r = await obsidian.requestUrl({ url });
        return new Uint8Array(r.arrayBuffer);
      },
      listarFuentes: async () => {
        const candidatos = [];
        // Carpetas dentro del vault (funcionan también en el móvil)
        for (const carpeta of carpetasVault) {
          try {
            const lista = await adapter.list(carpeta);
            for (const ruta of lista.files || []) {
              if (!esFuente(ruta)) continue;
              const st = await adapter.stat(ruta);
              candidatos.push({ ruta: `vault:${ruta}`, mtime: (st && st.mtime) || 0 });
            }
          } catch (e) { /* la carpeta puede no existir */ }
        }
        // Tipografías del sistema (solo escritorio)
        if (!enMovil()) {
          try {
            const fs = require('fs');
            const path = require('path');
            const os = require('os');
            const pila = MOTOR.carpetasDelSistema(process.platform, os.homedir());
            while (pila.length) {
              const carpeta = pila.pop();
              let entradas;
              try {
                entradas = fs.readdirSync(carpeta, { withFileTypes: true });
              } catch (e) { continue; }
              for (const e of entradas) {
                const ruta = path.join(carpeta, e.name);
                if (e.isDirectory()) pila.push(ruta);
                else if (esFuente(e.name)) {
                  try {
                    candidatos.push({ ruta: `fs:${ruta}`, mtime: Math.floor(fs.statSync(ruta).mtimeMs) });
                  } catch (err) { /* ilegible */ }
                }
              }
            }
          } catch (e) { /* sin acceso al sistema de ficheros */ }
        }
        return candidatos;
      },
      leerFuente: async (ruta) => {
        if (ruta.startsWith('fs:')) {
          const fs = require('fs');
          return new Uint8Array(fs.readFileSync(ruta.slice(3)));
        }
        return new Uint8Array(await adapter.readBinary(ruta.replace(/^vault:/, '')));
      },
      leerCacheIndice: async () => {
        try {
          if (await adapter.exists(rutaIndice)) return await adapter.read(rutaIndice);
        } catch (e) { /* sin caché */ }
        return null;
      },
      guardarCacheIndice: async (texto) => {
        try { await adapter.write(rutaIndice, texto); } catch (e) { /* no pasa nada */ }
      },
      // Las tipografías de reserva viven en «<plugin>/fuentes», que es la
      // primera carpeta que mira «listarFuentes».
      existeFuente: async (nombre) => {
        try { return await adapter.exists(`${dir}/fuentes/${nombre}`); } catch (e) { return false; }
      },
      guardarFuente: async (nombre, bytes) => {
        if (!(await adapter.exists(`${dir}/fuentes`))) await adapter.mkdir(`${dir}/fuentes`);
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        await adapter.writeBinary(`${dir}/fuentes/${nombre}`, ab);
      },
      crearCompilador: async (wasmBytes, fuentes) => {
        const glue = require('@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler.mjs');
        if (!this.wasmListo) {
          // Compilación asíncrona: en el hilo principal de Electron no se
          // permite WebAssembly síncrono de más de 8 MB.
          const iniciar = glue.default || glue.__wbg_init;
          if (iniciar) await iniciar({ module_or_path: wasmBytes });
          else glue.initSync({ module: wasmBytes });
          this.wasmListo = true;
        }
        const b = new glue.TypstCompilerBuilder();
        b.set_dummy_access_model();
        for (const f of fuentes) await b.add_raw_font(f);
        return b.build();
      },
    };
  }

  /**
   * Abre el dialogo de impresion del sistema con el documento ya compuesto.
   * Desde ahi se elige «Guardar como PDF».
   */
  imprimir(html) {
    return new Promise((resolve) => {
      const marco = document.createElement('iframe');
      marco.setAttribute('aria-hidden', 'true');
      marco.style.position = 'fixed';
      marco.style.right = '0';
      marco.style.bottom = '0';
      marco.style.width = '1px';
      marco.style.height = '1px';
      marco.style.opacity = '0';
      marco.style.border = '0';
      document.body.appendChild(marco);

      const limpiar = () => {
        window.setTimeout(() => {
          if (marco.parentNode) marco.parentNode.removeChild(marco);
          resolve();
        }, 1500);
      };

      marco.onload = () => {
        try {
          const ventana = marco.contentWindow;
          // Esperamos a las fuentes para que no imprima con la de reserva
          const seguir = () => {
            ventana.focus();
            ventana.print();
            limpiar();
          };
          if (ventana.document.fonts && ventana.document.fonts.ready) {
            ventana.document.fonts.ready.then(seguir).catch(seguir);
          } else {
            window.setTimeout(seguir, 300);
          }
        } catch (e) {
          console.error('[Ulysses Export] fallo al imprimir', e);
          new Notice('No se pudo abrir el diálogo de impresión.');
          limpiar();
        }
      };

      const doc = marco.contentWindow.document;
      doc.open();
      doc.write(html);
      doc.close();
    });
  }

  async guardar(nombre, contenido) {
    const carpeta = (this.ajustes.carpetaSalida || 'Exportaciones').replace(/^\/+|\/+$/g, '');
    if (carpeta && !this.app.vault.getAbstractFileByPath(carpeta)) {
      try {
        await this.app.vault.createFolder(carpeta);
      } catch (e) {
        /* si ya existe, seguimos */
      }
    }

    let destino = carpeta ? `${carpeta}/${nombre}` : nombre;
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(destino)) {
      const punto = nombre.lastIndexOf('.');
      const base = punto === -1 ? nombre : nombre.slice(0, punto);
      const ext = punto === -1 ? '' : nombre.slice(punto);
      destino = carpeta ? `${carpeta}/${base} ${n}${ext}` : `${base} ${n}${ext}`;
      n++;
    }

    if (typeof contenido === 'string') {
      await this.app.vault.create(destino, contenido);
    } else {
      const ab = contenido.buffer.slice(contenido.byteOffset, contenido.byteOffset + contenido.byteLength);
      await this.app.vault.createBinary(destino, ab);
    }
    return destino;
  }
}

/* ------------------------------------------------------------------ *
 * Dialogo de exportacion
 * ------------------------------------------------------------------ */

class DialogoExportar extends Modal {
  constructor(app, plugin, file) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.seleccion = null;
    this.verTodos = false;
  }

  async onOpen() {
    await this.pintar();
  }

  /** Se repinta al alternar la lista o al volver del editor. */
  async pintar() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Exportar con un estilo de Ulysses' });
    contentEl.createEl('p', { text: this.file.basename, cls: 'mod-muted' });

    const todas = await this.plugin.listarEstilos();
    const ofrecidas = await this.plugin.estilosOfrecidos();
    const hojas = this.verTodos ? todas : ofrecidas;
    const ocultas = todas.length - ofrecidas.length;

    if (!hojas.length) {
      contentEl.createEl('p', {
        text:
          'No hay ninguna hoja .ulss. Puedes crear una desde aquí, copiar tus ' +
          'estilos en la carpeta «estilos» del plugin, o indicar otra carpeta ' +
          'en los ajustes.',
      });
      const solo = contentEl.createDiv({ cls: 'modal-button-container' });
      const crear = solo.createEl('button', { text: 'Crear un estilo…', cls: 'mod-cta' });
      crear.addEventListener('click', () => this.abrirEditor());
      solo.createEl('button', { text: 'Cancelar' }).addEventListener('click', () => this.close());
      return;
    }

    // Se conserva la eleccion previa si sigue estando en la lista.
    const previa = this.seleccion && hojas.find((h) => h.ruta === this.seleccion.ruta);
    this.seleccion =
      previa || hojas.find((h) => h.nombre === this.plugin.ajustes.estiloPorDefecto) || hojas[0];

    const ajusteEstilo = new Setting(contentEl)
      .setName('Estilo')
      .setDesc(
        this.verTodos
          ? `${todas.length} estilos instalados.`
          : ocultas > 0
            ? `${ofrecidas.length} en uso · ${ocultas} más disponibles.`
            : 'Cualquier .ulss, incluidos los que te bajes de la galería de Ulysses.'
      )
      .addDropdown((d) => {
        for (const h of hojas) d.addOption(h.ruta, h.nombre);
        d.setValue(this.seleccion.ruta);
        d.onChange((v) => {
          this.seleccion = hojas.find((h) => h.ruta === v) || this.seleccion;
        });
      });

    // Editar el estilo elegido, sin salir del flujo de exportar.
    ajusteEstilo.addExtraButton((b) =>
      b
        .setIcon('pencil')
        .setTooltip('Editar este estilo')
        .onClick(() => this.abrirEditor(this.seleccion))
    );

    if (ocultas > 0 || this.verTodos) {
      new Setting(contentEl)
        .setName('Mostrar todos los estilos')
        .setDesc('Solo para esta exportación; no cambia tus ajustes.')
        .addToggle((t) =>
          t.setValue(this.verTodos).onChange(async (v) => {
            this.verTodos = v;
            await this.pintar();
          })
        );
    }

    new Setting(contentEl)
      .setName('Tamaño de página')
      .setDesc('Solo se usa si el estilo no declara el suyo propio.')
      .addDropdown((d) => {
        d.addOption('a4', 'A4');
        d.addOption('letter', 'Carta');
        d.addOption('legal', 'Oficio');
        d.setValue(this.plugin.ajustes.tamanoPagina);
        d.onChange(async (v) => {
          this.plugin.ajustes.tamanoPagina = v;
          await this.plugin.saveData(this.plugin.ajustes);
        });
      });

    // Carpeta de destino, elegible aqui mismo. Se recuerda para la
    // proxima vez, pero se puede cambiar sin entrar en los ajustes.
    const carpetas = DIALOGOS.carpetasDelVault(this.plugin.app);
    const destino = new Setting(contentEl)
      .setName('Guardar en')
      .setDesc('Carpeta del vault donde van el DOCX y el HTML.');
    destino.addDropdown((d) => {
      const actual = (this.plugin.ajustes.carpetaSalida || '').replace(/^\/+|\/+$/g, '');
      let encaja = false;
      for (const c of carpetas) {
        d.addOption(c, c === '' ? '(raíz del vault)' : c);
        if (c === actual) encaja = true;
      }
      if (!encaja) d.addOption(actual, `${actual} (se creará)`);
      d.setValue(actual);
      d.onChange(async (v) => {
        this.plugin.ajustes.carpetaSalida = v;
        await this.plugin.saveData(this.plugin.ajustes);
      });
    });
    destino.addExtraButton((b) =>
      b.setIcon('folder-plus').setTooltip('Escribir otra carpeta').onClick(async () => {
        const nueva = await DIALOGOS.pedirTexto(this.plugin.app, {
          titulo: 'Carpeta de destino',
          descripcion: 'Ruta dentro del vault. Se crea si no existe.',
          etiqueta: 'Carpeta',
          valor: this.plugin.ajustes.carpetaSalida || 'Exportaciones',
        });
        if (nueva === null) return;
        this.plugin.ajustes.carpetaSalida = nueva.replace(/^\/+|\/+$/g, '');
        await this.plugin.saveData(this.plugin.ajustes);
        await this.pintar();
      })
    );

    new Setting(contentEl)
      .setName('Estilos')
      .setDesc('Crear uno nuevo o retocar los que ya tienes.')
      .addButton((b) =>
        b.setButtonText('Crear o editar…').onClick(() => this.abrirEditor())
      );

    const botones = contentEl.createDiv({ cls: 'modal-button-container' });

    const lanzar = async (accion, etiqueta) => {
      const hoja = this.seleccion;
      this.close();
      const aviso = new Notice(`Exportando a ${etiqueta}…`, 0);
      try {
        await accion.call(this.plugin, this.file, hoja.ruta);
      } catch (e) {
        console.error('[Ulysses Export]', e);
        new Notice(`Falló la exportación: ${e && e.message ? e.message : e}`);
      } finally {
        aviso.hide();
      }
    };

    // El PDF lo compone el propio plugin (Typst en WebAssembly), así que
    // funciona igual en el móvil. En escritorio queda además la vía del
    // diálogo de impresión, por si se quiere el PDF de Chromium.
    const bPdf = botones.createEl('button', { text: 'PDF', cls: 'mod-cta' });
    bPdf.addEventListener('click', () => lanzar(this.plugin.exportarPdf, 'PDF'));

    const bDocx = botones.createEl('button', { text: 'DOCX' });
    bDocx.addEventListener('click', () => lanzar(this.plugin.exportarDocx, 'DOCX'));

    const bHtml = botones.createEl('button', { text: 'HTML' });
    bHtml.addEventListener('click', () => lanzar(this.plugin.exportarHtml, 'HTML'));

    if (!enMovil()) {
      const bImprimir = botones.createEl('button', { text: 'Imprimir…' });
      bImprimir.setAttribute('title', 'Diálogo de impresión del sistema');
      bImprimir.addEventListener('click', () => lanzar(this.plugin.exportarPdfImprimiendo, 'PDF'));
    }

    botones.createEl('button', { text: 'Cancelar' }).addEventListener('click', () => this.close());
  }

  /**
   * Abre el editor y, al cerrarlo, vuelve aqui con la lista al dia: si
   * acabas de crear un estilo, lo normal es querer exportar con el.
   */
  /** El menu de exportar no edita: abre la pestaña del editor. */
  abrirEditor(hoja) {
    this.close();
    this.plugin.abrirEditorDeEstilos(hoja ? hoja.ruta : null);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ------------------------------------------------------------------ *
 * Ajustes
 * ------------------------------------------------------------------ */

class AjustesExport extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async display() {
    const { containerEl } = this;
    containerEl.empty();
    const guardar = () => this.plugin.saveData(this.plugin.ajustes);

    const hojas = await this.plugin.listarEstilos();

    new Setting(containerEl)
      .setName('Estilo por defecto')
      .setDesc(`${hojas.length} hojas .ulss disponibles.`)
      .addDropdown((d) => {
        for (const h of hojas) d.addOption(h.nombre, h.nombre);
        if (hojas.length) {
          const actual = hojas.find((h) => h.nombre === this.plugin.ajustes.estiloPorDefecto);
          d.setValue(actual ? actual.nombre : hojas[0].nombre);
        }
        d.onChange(async (v) => {
          this.plugin.ajustes.estiloPorDefecto = v;
          await guardar();
        });
      });

    new Setting(containerEl)
      .setName('Tamaño de página')
      .setDesc('Solo se usa si el estilo no declara el suyo propio.')
      .addDropdown((d) => {
        d.addOption('a4', 'A4');
        d.addOption('letter', 'Carta');
        d.addOption('legal', 'Oficio');
        d.setValue(this.plugin.ajustes.tamanoPagina);
        d.onChange(async (v) => {
          this.plugin.ajustes.tamanoPagina = v;
          await guardar();
        });
      });

    new Setting(containerEl)
      .setName('Estilos que se ofrecen al exportar')
      .setDesc(
        'Uno por línea. Los demás siguen instalados, solo no aparecen en el ' +
          'desplegable. Déjalo vacío para verlos todos.'
      )
      .addTextArea((t) => {
        t.setPlaceholder('Universidad\nNovela')
          .setValue((this.plugin.ajustes.estilosVisibles || []).join('\n'))
          .onChange(async (v) => {
            this.plugin.ajustes.estilosVisibles = v
              .split('\n')
              .map((x) => x.trim())
              .filter(Boolean);
            await guardar();
          });
        t.inputEl.rows = 4;
      });

    new Setting(containerEl)
      .setName('Mostrar todos los estilos')
      .setDesc(`Hay ${hojas.length} instalados.`)
      .addToggle((t) =>
        t.setValue(this.plugin.ajustes.mostrarTodos).onChange(async (v) => {
          this.plugin.ajustes.mostrarTodos = v;
          await guardar();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName('Carpeta de salida')
      .setDesc('Dentro del vault. Ahí van los DOCX y los HTML.')
      .addText((t) =>
        t
          .setPlaceholder('Exportaciones')
          .setValue(this.plugin.ajustes.carpetaSalida)
          .onChange(async (v) => {
            this.plugin.ajustes.carpetaSalida = v.trim();
            await guardar();
          })
      );

    new Setting(containerEl)
      .setName('Carpeta de estilos adicional')
      .setDesc('Para tus propios .ulss dentro del vault. Se suma a la del plugin.')
      .addText((t) =>
        t
          .setPlaceholder('Estilos')
          .setValue(this.plugin.ajustes.carpetaEstilos)
          .onChange(async (v) => {
            this.plugin.ajustes.carpetaEstilos = v.trim();
            this.plugin.cacheHojas.clear();
            await guardar();
          })
      );

    containerEl.createEl('h3', { text: 'Verso y sangría' });

    new Setting(containerEl)
      .setName('Líneas dentro de un párrafo')
      .setDesc(
        'Qué hacer cuando un párrafo tiene varias líneas seguidas. Ulysses ' +
          'las une siempre, y por eso pierde las estrofas.'
      )
      .addDropdown((d) => {
        d.addOption('auto', 'Automático (verso si hay sangría o líneas cortas)');
        d.addOption('verso', 'Siempre verso (cada línea, un párrafo)');
        d.addOption('salto', 'Salto de línea dentro del mismo párrafo');
        d.addOption('parrafo', 'Unir en un solo párrafo (markdown clásico)');
        d.setValue(this.plugin.ajustes.modoLineas || 'auto');
        d.onChange(async (v) => {
          this.plugin.ajustes.modoLineas = v;
          await guardar();
        });
      });

    new Setting(containerEl)
      .setName('Carpeta de tipografías')
      .setDesc(
        'Carpeta del vault con fuentes (.ttf, .otf, .ttc) para el PDF. ' +
        'En el móvil es la única manera de usar las tipografías reales; ' +
        'en escritorio se usan además las del sistema.'
      )
      .addText((c) =>
        c
          .setPlaceholder('Tipografías')
          .setValue(this.plugin.ajustes.carpetaFuentes)
          .onChange(async (v) => {
            this.plugin.ajustes.carpetaFuentes = v.trim();
            await this.plugin.saveData(this.plugin.ajustes);
          })
      );

    new Setting(containerEl)
      .setName('Ancho del tabulador')
      .setDesc(
        'En cuadratines (em). Con 0 se usa el «default-tab-interval» del ' +
          'estilo, y si el estilo no lo declara, 4em. Los espacios sueltos ' +
          'cuentan como un cuarto de tabulador.'
      )
      .addText((t) =>
        t
          .setPlaceholder('0 = automático')
          .setValue(String(this.plugin.ajustes.anchoTabuladorEm || 0))
          .onChange(async (v) => {
            const n = parseFloat(v.replace(',', '.'));
            this.plugin.ajustes.anchoTabuladorEm = Number.isFinite(n) && n >= 0 ? n : 0;
            await guardar();
          })
      );

    new Setting(containerEl)
      .setName('Sangría francesa del verso')
      .setDesc(
        'En cuadratines. Cuando un verso no cabe en la línea, la vuelta se ' +
          'sangra para que no se confunda con un verso nuevo. Con 0 se ' +
          'desactiva.'
      )
      .addText((t) =>
        t
          .setPlaceholder('2')
          .setValue(String(this.plugin.ajustes.sangriaVersoEm))
          .onChange(async (v) => {
            const n = parseFloat(v.replace(',', '.'));
            this.plugin.ajustes.sangriaVersoEm = Number.isFinite(n) && n >= 0 ? n : 2;
            await guardar();
          })
      );

    containerEl.createEl('h3', { text: 'Bibliografía' });

    new Setting(containerEl)
      .setName('Títulos de bibliografía')
      .setDesc(
        'Uno por línea. Los párrafos bajo un titular con alguno de estos ' +
          'nombres llevan sangría francesa. Es una extensión del plugin: el ' +
          'formato .ulss no tiene selector de bibliografía, así que Ulysses ' +
          'no hace esto. Para controlarla desde el estilo, define ' +
          '«paragraph-bibliography» en tu .ulss.'
      )
      .addTextArea((t) => {
        t.setPlaceholder('Bibliografía\nReferencias')
          .setValue((this.plugin.ajustes.encabezadosBibliografia || []).join('\n'))
          .onChange(async (v) => {
            this.plugin.ajustes.encabezadosBibliografia = v
              .split('\n')
              .map((x) => x.trim())
              .filter(Boolean);
            await guardar();
          });
        t.inputEl.rows = 4;
      });

    new Setting(containerEl)
      .setName('Incluir comentarios')
      .setDesc('Sacar también los bloques %% … %% de Obsidian.')
      .addToggle((t) =>
        t.setValue(this.plugin.ajustes.incluirComentarios).onChange(async (v) => {
          this.plugin.ajustes.incluirComentarios = v;
          await guardar();
        })
      );

    containerEl.createEl('h3', { text: 'Sobre la fidelidad' });
    const p = containerEl.createEl('p');
    p.appendText(
      'El DOCX se genera mapeando cada propiedad de la hoja .ulss a su equivalente ' +
        'de Word (puntos a twips, interlineado exacto, márgenes de sección), que es ' +
        'donde la correspondencia con Ulysses es más estrecha. El PDF se compone con ' +
        'el motor de Obsidian, así que el guionado y los saltos de página pueden ' +
        'diferir de los de macOS. '
    );
    const p2 = containerEl.createEl('p');
    p2.appendText(
      'Si una tipografía del estilo no está instalada en el sistema, se usa la ' +
        'alternativa más próxima. Instalar las originales es lo que más acerca el resultado.'
    );

    if (hojas.length) {
      containerEl.createEl('h3', { text: 'Hojas encontradas' });
      const ul = containerEl.createEl('ul');
      for (const h of hojas) ul.createEl('li', { text: h.nombre });
    }
  }
}

module.exports = UlyssesExport;

