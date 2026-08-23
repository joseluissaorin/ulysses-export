// Copia el plugin construido al vault indicado (o al de pruebas).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
const destino = process.argv[2] || '/home/joseluis/Documentos/UlyssesMD/.obsidian/plugins/ulysses-export';
mkdirSync(destino, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(`dist/${f}`, `${destino}/${f}`);
const wasm = 'node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm';
if (existsSync(wasm) && !existsSync(`${destino}/typst.wasm`)) copyFileSync(wasm, `${destino}/typst.wasm`);
console.log('instalado en', destino);
