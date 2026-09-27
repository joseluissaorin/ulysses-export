'use strict';

/*
 * Tamaño de una imagen sin decodificarla
 * ======================================
 *
 * Basta leer la cabecera: PNG (IHDR), JPEG (el primer SOF), GIF y SVG
 * (width/height o viewBox). Lo usan el plugin y la terminal para decidir
 * a qué tamaño va una imagen y si es una lámina.
 */

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

    if (ext === 'svg') return dimensionesSvg(new TextDecoder().decode(b.subarray(0, 4096)));
  } catch (e) {
    /* si no se puede, se escala al ancho util */
  }
  return null;
}

/**
 * Tamaño de un SVG en px a 96 ppp: «width»/«height» con su unidad o, si
 * no los trae, el «viewBox». Basta con que la proporción sea la buena
 * para decidir si es una lámina.
 */
function dimensionesSvg(texto) {
  const raiz = /<svg\b[^>]*>/i.exec(texto);
  if (!raiz) return null;
  const atributo = (nombre) => {
    const m = new RegExp(`\\s${nombre}\\s*=\\s*["']([^"']+)["']`, 'i').exec(raiz[0]);
    return m ? m[1].trim() : null;
  };
  const PX = { px: 1, pt: 96 / 72, pc: 16, in: 96, mm: 96 / 25.4, cm: 96 / 2.54, '': 1 };
  const medida = (v) => {
    const m = v && /^([\d.]+)\s*(px|pt|pc|in|mm|cm)?$/i.exec(v);
    return m ? parseFloat(m[1]) * PX[(m[2] || '').toLowerCase()] : null;
  };
  let ancho = medida(atributo('width'));
  let alto = medida(atributo('height'));
  if (!ancho || !alto) {
    const vb = (atributo('viewBox') || '').split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      ancho = vb[2];
      alto = vb[3];
    }
  }
  return ancho && alto ? { ancho, alto } : null;
}

/** Extensión en minúsculas de una ruta («foto.PNG» → «png»). */
function extension(ruta) {
  const m = /\.([a-z0-9]+)$/i.exec(String(ruta || ''));
  return m ? m[1].toLowerCase() : '';
}

module.exports = { dimensiones, dimensionesSvg, extension };
