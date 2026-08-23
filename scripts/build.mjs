// Empaqueta el plugin: src/main.js -> dist/main.js (+ manifest y estilos).
import esbuild from 'esbuild';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('dist', { recursive: true });

const opciones = {
  entryPoints: ['src/main.js'],
  bundle: true,
  outfile: 'dist/main.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  external: ['obsidian', 'electron', 'fs', 'path', 'os'],
  logLevel: 'info',
  banner: {
    js: '/* Ulysses Export — plugin de Obsidian — licencia MIT (ver LICENSE del repositorio) */',
  },
  define: { 'import.meta.url': 'undefined' },
};

for (const f of ['manifest.json', 'styles.css']) {
  if (existsSync(f)) copyFileSync(f, `dist/${f}`);
}

if (watch) {
  const ctx = await esbuild.context(opciones);
  await ctx.watch();
} else {
  await esbuild.build(opciones);
}
