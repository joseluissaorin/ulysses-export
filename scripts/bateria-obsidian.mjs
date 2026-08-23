// Batería Chrome vs Typst DENTRO de Obsidian.
//
// Usa el Obsidian real (lanzado con --remote-debugging-port=9222) para
// producir cada documento por las dos vías del plugin:
//
//   · la ANTIGUA: el HTML de construirHtml impreso por el Chromium del
//     propio Obsidian (Page.printToPDF, el mismo motor que window.print)
//   · la NUEVA: exportarPdf del plugin (Typst en WebAssembly)
//
// y deja los pares en «Batería exportación/salida/» del vault para
// compararlos después con scripts/comparar.py.
//
// Uso: node scripts/bateria-obsidian.mjs [--docs re] [--estilos re] [--puerto 9222]

import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const VAULT = '/home/joseluis/Documentos/UlyssesMD';
const CARPETA_DOCS = 'Batería exportación';
const CARPETA_SALIDA = 'Batería exportación/salida';

const args = process.argv.slice(2);
const opcion = (nombre, defecto) => {
  const i = args.indexOf(nombre);
  return i === -1 ? defecto : args[i + 1];
};
const PUERTO = Number(opcion('--puerto', '9222'));
const RE_DOCS = new RegExp(opcion('--docs', '.'), 'i');
const RE_ESTILOS = new RegExp(opcion('--estilos', '.'), 'i');

/* ------------------------------------------------------------------ *
 * Cliente CDP mínimo sobre el WebSocket global de Node
 * ------------------------------------------------------------------ */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.n = 0;
    this.pendientes = new Map();
    this.avisos = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pendientes.has(m.id)) {
        const { res, rej } = this.pendientes.get(m.id);
        this.pendientes.delete(m.id);
        if (m.error) rej(new Error(m.error.message));
        else res(m.result);
      } else if (m.method) {
        this.avisos.push(m);
      }
    });
  }

  static async conectar(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('no se pudo conectar a ' + url)), { once: true });
    });
    return new Cdp(ws);
  }

  enviar(metodo, params) {
    const id = ++this.n;
    this.ws.send(JSON.stringify({ id, method: metodo, params: params || {} }));
    return new Promise((res, rej) => this.pendientes.set(id, { res, rej }));
  }

  espera(metodo, plazoMs) {
    return new Promise((res, rej) => {
      const tic = setInterval(() => {
        const i = this.avisos.findIndex((a) => a.method === metodo);
        if (i !== -1) {
          clearInterval(tic);
          clearTimeout(tac);
          res(this.avisos.splice(i, 1)[0]);
        }
      }, 25);
      const tac = setTimeout(() => {
        clearInterval(tic);
        rej(new Error('esperando ' + metodo));
      }, plazoMs || 30000);
    });
  }

  cerrar() {
    this.ws.close();
  }
}

async function json(ruta, metodo) {
  const r = await fetch(`http://127.0.0.1:${PUERTO}${ruta}`, { method: metodo || 'GET' });
  return r.json();
}

/* ------------------------------------------------------------------ *
 * Obsidian: evaluar código en la ventana principal
 * ------------------------------------------------------------------ */

async function conectarObsidian() {
  const objetivos = await json('/json');
  const principal = objetivos.find((t) => t.type === 'page' && !t.url.startsWith('devtools'));
  if (!principal) throw new Error('no encuentro la ventana de Obsidian');
  const cdp = await Cdp.conectar(principal.webSocketDebuggerUrl);
  const evaluar = async (expr) => {
    const r = await cdp.enviar('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      timeout: 300000,
    });
    if (r.exceptionDetails) {
      throw new Error('en Obsidian: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  };
  return { cdp, evaluar };
}

/* ------------------------------------------------------------------ *
 * Impresión con el Chromium de Obsidian (la vía antigua)
 * ------------------------------------------------------------------ *
 * Se hace DENTRO de Obsidian: una BrowserWindow oculta carga el HTML y
 * webContents.printToPDF lo imprime con la misma tubería que usaba
 * window.print() en el plugin antiguo. Devuelve el PDF en base64.
 */

function exprImprimir(rutaHtml, opciones) {
  return `(async () => {
    const remote = require('@electron/remote');
    const win = new remote.BrowserWindow({ show: false, webPreferences: { sandbox: false, offscreen: false } });
    try {
      await win.loadFile(${JSON.stringify(rutaHtml)});
      await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true', true);
      const buf = await win.webContents.printToPDF(${JSON.stringify(opciones)});
      return buf.toString('base64');
    } finally {
      win.destroy();
    }
  })()`;
}

// Calibrado contra los PDF del diálogo de impresión: el diálogo aplica un
// encogimiento constante (S_CHROME) que printToPDF no pone por sí solo.
// Único resto conocido: el número de página sale 1 px más abajo que en el
// diálogo; la comparación lo tolera explícitamente.
function opcionesImpresion(html) {
  // El papel se toma del @page del propio estilo (como haría quien
  // imprime eligiendo el papel correcto en el diálogo): si no coincide,
  // Chromium centra la página CSS en el papel y desplaza el contenido.
  const m = /@page \{ size: ([\d.]+)pt ([\d.]+)pt/.exec(html);
  const anchoIn = m ? parseFloat(m[1]) / 72 : 8.26772;
  const altoIn = m ? parseFloat(m[2]) / 72 : 11.69291;
  return {
    printBackground: true,
    displayHeaderFooter: false,
    preferCSSPageSize: true,
    pageSize: { width: anchoIn, height: altoIn },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    scale: 0.999610304,
  };
}

/* ------------------------------------------------------------------ *
 * La batería
 * ------------------------------------------------------------------ */

const { evaluar, cdp } = await conectarObsidian();

// 1. Recargar el plugin para que corra el main.js recién instalado
await evaluar(`(async () => {
  await app.plugins.disablePlugin('ulysses-export');
  await app.plugins.enablePlugin('ulysses-export');
  return app.plugins.plugins['ulysses-export'].manifest.version;
})()`);

// 2. Preparar capturas: guardar() del plugin desviado a rutas deterministas
await evaluar(`(async () => {
  const p = app.plugins.plugins['ulysses-export'];
  if (!(await app.vault.adapter.exists(${JSON.stringify(CARPETA_SALIDA)}))) {
    await app.vault.adapter.mkdir(${JSON.stringify(CARPETA_SALIDA)});
  }
  window.__bateria = {
    original: p.guardar.bind(p),
    destino: null,
  };
  p.guardar = async (nombre, contenido) => {
    const ruta = window.__bateria.destino || (${JSON.stringify(CARPETA_SALIDA)} + '/' + nombre);
    if (typeof contenido === 'string') {
      await app.vault.adapter.write(ruta, contenido);
    } else {
      const ab = contenido.buffer.slice(contenido.byteOffset, contenido.byteOffset + contenido.byteLength);
      await app.vault.adapter.writeBinary(ruta, ab);
    }
    return ruta;
  };
  return 'listo';
})()`);

// 3. Documentos y estilos
const docs = readdirSync(`${VAULT}/${CARPETA_DOCS}`)
  .filter((f) => f.endsWith('.md') && RE_DOCS.test(f))
  .sort();
const estilos = await evaluar(
  `app.plugins.plugins['ulysses-export'].listarEstilos().then(l => l.map(h => ({ruta: h.ruta, nombre: h.nombre})))`
);
const estilosElegidos = estilos.filter((e) => RE_ESTILOS.test(e.nombre));

console.log(`${docs.length} documentos × ${estilosElegidos.length} estilos`);
mkdirSync(`${VAULT}/${CARPETA_SALIDA}`, { recursive: true });

const errores = [];
for (const doc of docs) {
  for (const estilo of estilosElegidos) {
    const clave = `${doc.replace(/\.md$/, '')}__${estilo.nombre}`.replace(/[/\\]/g, '-');
    const rutaDoc = `${CARPETA_DOCS}/${doc}`;
    try {
      // --- vía antigua: HTML del plugin + Chromium de Obsidian ---
      const html = await evaluar(`(async () => {
        const p = app.plugins.plugins['ulysses-export'];
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(rutaDoc)});
        let capturado = null;
        const guardar = p.guardar;
        p.guardar = async (n, c) => { capturado = c; return 'capturado'; };
        try { await p.exportarHtml(file, ${JSON.stringify(estilo.ruta)}); } finally { p.guardar = guardar; }
        return capturado;
      })()`);
      const rutaHtml = `${VAULT}/${CARPETA_SALIDA}/${clave}.html`;
      writeFileSync(rutaHtml, html);
      const b64 = await evaluar(exprImprimir(rutaHtml, opcionesImpresion(html)));
      writeFileSync(`${VAULT}/${CARPETA_SALIDA}/${clave}.chrome.pdf`, Buffer.from(b64, 'base64'));

      // --- vía nueva: exportarPdf (Typst) del propio plugin ---
      await evaluar(`(async () => {
        const p = app.plugins.plugins['ulysses-export'];
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(rutaDoc)});
        window.__bateria.destino = ${JSON.stringify(CARPETA_SALIDA)} + '/' + ${JSON.stringify(clave)} + '.typst.pdf';
        try { await p.exportarPdf(file, ${JSON.stringify(estilo.ruta)}); } finally { window.__bateria.destino = null; }
        return 'ok';
      })()`);
      console.log('✓', clave);
    } catch (e) {
      errores.push({ clave, error: e.message });
      console.log('✗', clave, '—', e.message.slice(0, 120));
    }
  }
}

// 4. Restaurar el guardar original
await evaluar(`(() => {
  const p = app.plugins.plugins['ulysses-export'];
  if (window.__bateria) { p.guardar = window.__bateria.original; delete window.__bateria; }
  return 'restaurado';
})()`);

cdp.cerrar();
if (errores.length) {
  console.log(`\n${errores.length} fallos:`);
  for (const e of errores) console.log(' -', e.clave, e.error.slice(0, 200));
  process.exit(1);
}
console.log('\nBatería generada sin errores.');
