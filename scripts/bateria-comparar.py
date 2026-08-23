#!/usr/bin/env python3
"""Compara todas las parejas .chrome.pdf / .typst.pdf de la batería.

Uso: bateria-comparar.py CARPETA [--png CARPETA_DIFFS] [--tol 0.06]

Criterio de aprobado por pareja:
  - mismo número de páginas
  - mismas líneas, con |dy| y |dx| dentro de la tolerancia
  - se tolera el folio (número de página) 1 px más abajo en la referencia:
    es un artefacto conocido del arnés (printToPDF) frente al diálogo.
"""
import sys, os, argparse, importlib.util

aqui = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('comparar', os.path.join(aqui, 'comparar.py'))
comparar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparar)

import pymupdf
import numpy as np
from PIL import Image

def es_folio(r, c, pagina_alto):
    """La línea del número de página, con el desfase conocido de 1 px."""
    if not (r['texto'].isdigit() and len(r['texto']) <= 3):
        return False
    if r['y'] < pagina_alto * 0.9:
        return False
    return abs((c['y'] - r['y']) + 0.75) <= 0.06 and abs(c['x0'] - r['x0']) <= 0.45

def desfase_origen(R, C):
    """Desfase horizontal uniforme de 1 px entre las dos vías de impresión
    de Chromium (el diálogo redondea el margen izquierdo hacia arriba;
    printToPDF al más cercano). Se detecta y se descuenta, avisando."""
    dxs = []
    for i in range(min(len(R), len(C))):
        lr, lc = comparar.lineas(R[i]), comparar.lineas(C[i])
        for r, c in zip(lr, lc):
            dxs.append(c['x0'] - r['x0'])
    if not dxs:
        return 0.0
    dxs.sort()
    mediana = dxs[len(dxs) // 2]
    for objetivo in (0.75, -0.75):
        if abs(mediana - objetivo) <= 0.03:
            return objetivo
    return 0.0

def comparar_par(ref, cand, tol, png=None):
    R, C = pymupdf.open(ref), pymupdf.open(cand)
    origen = desfase_origen(R, C)
    resultado = {
        'paginas_ref': len(R), 'paginas_cand': len(C),
        'lineas': 0, 'malas': 0, 'peor_dy': 0.0, 'peor_dx': 0.0,
        'texto_distinto': 0, 'desparejadas': 0, 'pixeles': 0.0, 'detalles': [],
        'origen': origen, 'subpixel': 0,
    }
    alto = R[0].rect.height
    for i in range(max(len(R), len(C))):
        lr = comparar.lineas(R[i]) if i < len(R) else []
        lc = comparar.lineas(C[i]) if i < len(C) else []
        # Emparejar por texto y cercanía vertical, no por índice: si una
        # línea se mueve, el resto no debe darse por desviado en cascada.
        libres = list(range(len(lc)))
        parejas = []
        for r in lr:
            clave = r['texto'].replace('\xa0', ' ').strip()
            candidatos = [j for j in libres if lc[j]['texto'].replace('\xa0', ' ').strip() == clave]
            if not candidatos:
                candidatos = [j for j in libres
                              if lc[j]['texto'].replace('\xa0', ' ').strip()[:24] == clave[:24] and clave[:24]]
            if candidatos:
                j = min(candidatos, key=lambda j: abs(lc[j]['y'] - r['y']))
                libres.remove(j)
                parejas.append((r, lc[j]))
            else:
                parejas.append((r, None))
        for j in libres:
            parejas.append((None, lc[j]))
        for r, c in parejas:
            resultado['lineas'] += 1
            if r and c:
                if es_folio(r, c, alto):
                    continue
                dy, dx = c['y'] - r['y'], c['x0'] - r['x0'] - origen
                mismo = r['texto'].replace('\xa0', ' ') == c['texto'].replace('\xa0', ' ')
                resultado['peor_dy'] = max(resultado['peor_dy'], abs(dy))
                resultado['peor_dx'] = max(resultado['peor_dx'], abs(dx))
                if not mismo:
                    resultado['texto_distinto'] += 1
                if abs(dy) > tol or abs(dx) > tol or not mismo:
                    # Desvío solo de posición y menor de 0,6 px: sub-píxel
                    if mismo and abs(dy) <= 0.74 and abs(dx) <= 0.74:
                        resultado['subpixel'] += 1
                    else:
                        resultado['malas'] += 1
                        if len(resultado['detalles']) < 6:
                            resultado['detalles'].append(
                                f"p{i+1} dy={dy:+.2f} dx={dx:+.2f} {r['texto'][:38]!r}"
                                + ('' if mismo else f" ≠ {c['texto'][:38]!r}")
                            )
            else:
                resultado['desparejadas'] += 1
                resultado['malas'] += 1
                s = r or c
                if len(resultado['detalles']) < 6:
                    resultado['detalles'].append(
                        f"p{i+1} {'solo chrome' if r else 'solo typst'} {s['texto'][:44]!r}"
                    )
        if i < len(R) and i < len(C):
            # 96 ppp: el desfase de origen de 1 px CSS es exactamente 1 píxel
            pr, pc = R[i].get_pixmap(dpi=96), C[i].get_pixmap(dpi=96)
            ar = np.asarray(Image.frombytes('RGB', (pr.width, pr.height), pr.samples).convert('L'), dtype=np.int16)
            ac = np.asarray(Image.frombytes('RGB', (pc.width, pc.height), pc.samples).convert('L'), dtype=np.int16)
            if ac.shape == ar.shape:
                if origen:
                    ac = np.roll(ac, -int(round(origen / 0.75)), axis=1)
                pct = (np.abs(ar - ac) > 64).sum() / ar.size * 100
                resultado['pixeles'] = max(resultado['pixeles'], pct)
                if png and pct > 0.2:
                    rgb = np.zeros(ar.shape + (3,), dtype=np.uint8)
                    rgb[..., 0] = ac.clip(0, 255)
                    rgb[..., 1] = np.minimum(ar, ac).clip(0, 255)
                    rgb[..., 2] = ar.clip(0, 255)
                    nombre = os.path.basename(ref).replace('.chrome.pdf', f'-p{i+1}.png')
                    Image.fromarray(rgb).save(os.path.join(png, nombre))
    return resultado

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('carpeta')
    ap.add_argument('--png', default=None)
    ap.add_argument('--tol', type=float, default=0.06)
    a = ap.parse_args()
    if a.png:
        os.makedirs(a.png, exist_ok=True)
    pares = sorted(
        f[:-len('.chrome.pdf')] for f in os.listdir(a.carpeta) if f.endswith('.chrome.pdf')
    )
    filas = []
    for clave in pares:
        ref = os.path.join(a.carpeta, clave + '.chrome.pdf')
        cand = os.path.join(a.carpeta, clave + '.typst.pdf')
        if not os.path.exists(cand):
            filas.append((clave, None))
            continue
        filas.append((clave, comparar_par(ref, cand, a.tol, a.png)))

    filas.sort(key=lambda f: (-(f[1] is None), -(f[1]['malas'] if f[1] else 0), -(f[1]['peor_dy'] if f[1] else 0)))
    aprobadas = 0
    subpixel = 0
    for clave, r in filas:
        if r is None:
            print(f"✗ {clave}: falta el PDF de Typst")
            continue
        paginas_ok = r['paginas_ref'] == r['paginas_cand']
        if paginas_ok and r['malas'] == 0 and r['subpixel'] == 0:
            aprobadas += 1
        elif paginas_ok and r['malas'] == 0:
            subpixel += 1
            print(f"~ {clave}: idéntica salvo {r['subpixel']} líneas con desvío menor de 1 px "
                  f"(dy máx {r['peor_dy']:.2f} dx máx {r['peor_dx']:.2f}pt)")
        else:
            origen = f" · desfase de origen {r['origen']:+.2f}pt descontado" if r['origen'] else ''
            print(f"✗ {clave}: pág {r['paginas_ref']}/{r['paginas_cand']} · {r['malas']}/{r['lineas']} líneas mal · "
                  f"dy máx {r['peor_dy']:.2f} dx máx {r['peor_dx']:.2f} · píx {r['pixeles']:.2f}%{origen}")
            for d in r['detalles']:
                print('    ', d)
    peor_dy = max((r['peor_dy'] for _, r in filas if r), default=0)
    peor_pix = max((r['pixeles'] for _, r in filas if r), default=0)
    print(f"\n=== {aprobadas}/{len(filas)} idénticas · {subpixel} menos de 1 px · "
          f"{len(filas)-aprobadas-subpixel} distintas (tol {a.tol}pt) · "
          f"dy máx global {peor_dy:.2f}pt · píxeles máx {peor_pix:.2f}%")
    return 0 if aprobadas + subpixel == len(filas) else 1

if __name__ == '__main__':
    sys.exit(main())
