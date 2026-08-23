// Compila un .typ a PDF con el MISMO compilador WASM que usa el plugin.
// Uso: node scripts/typst-wasm.mjs entrada.typ salida.pdf [carpeta-de-fuentes...]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { initSync, TypstCompilerBuilder } from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler.mjs';

export async function crearCompilador(carpetasFuentes) {
  const wasm = readFileSync(new URL('../node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm', import.meta.url));
  initSync({ module: wasm });
  const b = new TypstCompilerBuilder();
  b.set_dummy_access_model();
  for (const dir of carpetasFuentes) {
    for (const f of readdirSync(dir)) {
      if (!/\.(ttf|otf|ttc)$/i.test(f)) continue;
      const p = join(dir, f);
      if (statSync(p).isFile()) await b.add_raw_font(readFileSync(p));
    }
  }
  return b.build();
}

export function compilar(c, fuente, recursos) {
  c.reset();
  c.add_source('/main.typ', fuente);
  for (const [ruta, bytes] of Object.entries(recursos || {})) c.map_shadow(ruta, bytes);
  const r = c.compile('/main.typ', null, 'pdf', 0);
  if (!(r instanceof Uint8Array)) throw new Error('Typst: ' + JSON.stringify(r));
  return r;
}

if (process.argv[1] && process.argv[1].endsWith('typst-wasm.mjs')) {
  const [, , entrada, salida, ...dirs] = process.argv;
  const c = await crearCompilador(dirs.length ? dirs : [process.env.HOME + '/.local/share/fonts/ulysses']);
  try {
    writeFileSync(salida, compilar(c, readFileSync(entrada, 'utf8')));
    console.log('ok', salida);
  } catch (e) { console.error(e.message); process.exit(1); }
}
