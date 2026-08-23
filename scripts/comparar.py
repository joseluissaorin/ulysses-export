#!/usr/bin/env python3
"""Compara dos PDF (referencia y candidato) línea a línea y por píxeles.

Uso: comparar.py referencia.pdf candidato.pdf [--png carpeta] [--tol 0.75]

Para cada página lista las líneas de texto de ambos con su línea base (y),
su x inicial y su texto, y marca las que difieren más de la tolerancia.
Con --png escribe superposiciones (referencia en rojo, candidato en azul).
"""
import sys, argparse
import pymupdf
import numpy as np
from PIL import Image, ImageChops

def lineas(pagina):
    out = []
    d = pagina.get_text('dict')
    for b in d['blocks']:
        if b['type'] != 0: continue
        for l in b['lines']:
            spans = l['spans']
            if not spans: continue
            texto = ''.join(s['text'] for s in spans).strip()
            if not texto: continue
            # línea base: origen del primer span
            y = spans[0]['origin'][1]
            x0 = min(s['bbox'][0] for s in spans)
            x1 = max(s['bbox'][2] for s in spans)
            tam = spans[0]['size']
            fuente = spans[0]['font']
            out.append(dict(y=y, x0=x0, x1=x1, texto=texto, tam=tam, fuente=fuente))
    out.sort(key=lambda r: (round(r['y'], 1), r['x0']))
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('ref'); ap.add_argument('cand')
    ap.add_argument('--png', default=None)
    ap.add_argument('--tol', type=float, default=0.75)
    ap.add_argument('--dpi', type=int, default=72)
    ap.add_argument('--silencioso', action='store_true')
    a = ap.parse_args()
    R = pymupdf.open(a.ref); C = pymupdf.open(a.cand)
    print(f'páginas: ref={len(R)} cand={len(C)}  tamaño ref={R[0].rect.width:.2f}x{R[0].rect.height:.2f} cand={C[0].rect.width:.2f}x{C[0].rect.height:.2f}')
    total_lineas = 0; malas = 0; worst = 0.0
    for i in range(max(len(R), len(C))):
        lr = lineas(R[i]) if i < len(R) else []
        lc = lineas(C[i]) if i < len(C) else []
        print(f'--- página {i+1}: ref {len(lr)} líneas, cand {len(lc)} líneas')
        n = max(len(lr), len(lc))
        for k in range(n):
            r = lr[k] if k < len(lr) else None
            c = lc[k] if k < len(lc) else None
            total_lineas += 1
            if r and c:
                dy = c['y'] - r['y']; dx = c['x0'] - r['x0']; dx1 = c['x1'] - r['x1']
                mismo = r['texto'] == c['texto']
                ok = abs(dy) <= a.tol and abs(dx) <= a.tol and mismo
                worst = max(worst, abs(dy), abs(dx))
                if not ok: malas += 1
                if not ok or not a.silencioso:
                    marca = '  ' if ok else '!!'
                    print(f'{marca} {k:3d} y={r["y"]:7.2f} dy={dy:+6.2f} x={r["x0"]:6.2f} dx={dx:+6.2f} dx1={dx1:+6.2f} {r["tam"]:.1f}pt | {r["texto"][:40]!r}' + ('' if mismo else f' ≠ {c["texto"][:40]!r}'))
            else:
                malas += 1
                s = r or c
                print(f'!! {k:3d} {"solo ref" if r else "solo cand"} y={s["y"]:7.2f} x={s["x0"]:6.2f} {s["texto"][:50]!r}')
        if a.png:
            pr = R[i].get_pixmap(dpi=a.dpi) if i < len(R) else None
            pc = C[i].get_pixmap(dpi=a.dpi) if i < len(C) else None
            def img(p):
                return Image.frombytes('RGB', (p.width, p.height), p.samples).convert('L')
            ir = img(pr) if pr else None; ic = img(pc) if pc else None
            if ir is None: ir = Image.new('L', ic.size, 255)
            if ic is None: ic = Image.new('L', ir.size, 255)
            if ic.size != ir.size: ic = ic.resize(ir.size)
            ar = np.asarray(ir, dtype=np.int16); ac = np.asarray(ic, dtype=np.int16)
            diff = np.abs(ar - ac)
            pct = (diff > 64).sum() / diff.size * 100
            # ref en rojo, cand en azul: donde coinciden queda negro/gris
            rgb = np.stack([255 - (255 - ac).clip(0,255), 255 - np.maximum(255-ar, 255-ac).clip(0,255), 255 - (255 - ar).clip(0,255)], axis=-1)
            # rojo = solo ref (ar oscuro, ac claro) => R alto, G,B bajos
            rgb = np.zeros(ar.shape + (3,), dtype=np.uint8)
            rgb[..., 0] = ac.clip(0,255)  # donde ref oscuro y cand claro -> rojo
            rgb[..., 1] = np.minimum(ar, ac).clip(0,255)
            rgb[..., 2] = ar.clip(0,255)  # donde cand oscuro y ref claro -> azul
            Image.fromarray(rgb).save(f'{a.png}/pagina-{i+1:02d}.png')
            print(f'    píxeles distintos: {pct:.2f}%')
    print(f'=== líneas comparadas: {total_lineas}, con desvío: {malas}, desvío máximo: {worst:.2f}pt')
    return 0 if malas == 0 and len(R) == len(C) else 1

if __name__ == '__main__':
    sys.exit(main())
