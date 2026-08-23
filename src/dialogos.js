'use strict';

/*
 * Dialogos propios
 * ================
 *
 * «window.prompt» y «window.confirm» no existen en Obsidian movil: se
 * quedan en blanco y el flujo se corta sin decir nada. Estos modales
 * hacen lo mismo con la API de Obsidian, asi que funcionan igual en
 * escritorio y en movil.
 */

const obsidian = require('obsidian');
const { Modal, Setting, Notice } = obsidian;

/** Pide un texto. Devuelve una promesa con el valor o null si se cancela. */
function pedirTexto(app, opciones) {
  const opc = opciones || {};
  return new Promise((resolver) => {
    const modal = new Modal(app);
    let valor = opc.valor === undefined ? '' : String(opc.valor);
    let resuelto = false;
    const terminar = (v) => {
      if (resuelto) return;
      resuelto = true;
      resolver(v);
    };

    modal.onOpen = () => {
      const { contentEl } = modal;
      contentEl.empty();
      contentEl.createEl('h3', { text: opc.titulo || 'Escribe un valor' });
      if (opc.descripcion) {
        contentEl.createEl('p', { text: opc.descripcion, cls: 'setting-item-description' });
      }

      const ajuste = new Setting(contentEl);
      if (opc.etiqueta) ajuste.setName(opc.etiqueta);
      ajuste.addText((t) => {
        t.setValue(valor);
        if (opc.marcador) t.setPlaceholder(opc.marcador);
        t.onChange((v) => { valor = v; });
        t.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); aceptar(); }
        });
        window.setTimeout(() => {
          try { t.inputEl.focus(); t.inputEl.select(); } catch (e) { /* sin foco, da igual */ }
        }, 30);
      });

      const aceptar = () => {
        const limpio = String(valor || '').trim();
        if (!limpio) { new Notice('Hace falta un nombre.'); return; }
        terminar(limpio);
        modal.close();
      };

      const botones = contentEl.createDiv({ cls: 'modal-button-container' });
      const b = botones.createEl('button', { text: opc.aceptar || 'Aceptar', cls: 'mod-cta' });
      b.addEventListener('click', aceptar);
      botones.createEl('button', { text: 'Cancelar' }).addEventListener('click', () => modal.close());
    };

    modal.onClose = () => { modal.contentEl.empty(); terminar(null); };
    modal.open();
  });
}

/** Pregunta si continuar. Devuelve una promesa con true o false. */
function confirmar(app, opciones) {
  const opc = opciones || {};
  return new Promise((resolver) => {
    const modal = new Modal(app);
    let resuelto = false;
    const terminar = (v) => {
      if (resuelto) return;
      resuelto = true;
      resolver(v);
    };

    modal.onOpen = () => {
      const { contentEl } = modal;
      contentEl.empty();
      contentEl.createEl('h3', { text: opc.titulo || '¿Seguro?' });
      if (opc.descripcion) contentEl.createEl('p', { text: opc.descripcion });

      const botones = contentEl.createDiv({ cls: 'modal-button-container' });
      const si = botones.createEl('button', {
        text: opc.aceptar || 'Continuar',
        cls: opc.peligro ? 'mod-warning' : 'mod-cta',
      });
      si.addEventListener('click', () => { terminar(true); modal.close(); });
      botones.createEl('button', { text: opc.cancelar || 'Cancelar' })
        .addEventListener('click', () => modal.close());
    };

    modal.onClose = () => { modal.contentEl.empty(); terminar(false); };
    modal.open();
  });
}

/**
 * Lista las carpetas del vault, para elegir destino sin escribir rutas.
 * Se apoya solo en la API del vault, asi que vale en movil.
 */
function carpetasDelVault(app) {
  const salida = new Set(['']);
  try {
    for (const f of app.vault.getAllLoadedFiles()) {
      // Una carpeta tiene «children»; un fichero, no.
      if (f && f.children && typeof f.path === 'string' && f.path !== '/') salida.add(f.path);
    }
  } catch (e) {
    /* si la API no esta, queda al menos la raiz */
  }
  return Array.from(salida).sort((a, b) => a.localeCompare(b, 'es'));
}

module.exports = { pedirTexto, confirmar, carpetasDelVault };
