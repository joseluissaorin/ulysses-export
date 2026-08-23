# Ejemplos

`muestra.md` es una nota corta que ejercita casi todo lo que el plugin
sabe hacer: título, prosa justificada con sangría de primera línea,
diálogo con raya a la española, negritas y cursivas, resaltado, listas
numeradas y de viñetas, cita en bloque, divisor y una nota al pie.

| Fichero | Qué es |
|---|---|
| `muestra.md` | La nota de partida |
| `estilos/Novela.ulss` | Estilo de novela (Baskerville, «*****» como divisor) |
| `estilos/Universidad.ulss` | Estilo académico (Optima, notas al pie, número de página) |
| `muestra-novela.pdf` | La nota exportada con Novela |
| `muestra-universidad.pdf` | La nota exportada con Universidad |

Para regenerarlos desde la terminal:

```bash
node scripts/exportar.mjs ejemplos/muestra.md ejemplos/estilos/Novela.ulss ejemplos/muestra-novela.pdf
node scripts/exportar.mjs ejemplos/muestra.md ejemplos/estilos/Universidad.ulss ejemplos/muestra-universidad.pdf
```

(Hace falta tener las tipografías correspondientes instaladas; si no las
hay, el motor cae a las alternativas y lo avisa.)

Las hojas proceden de la galería de estilos de Ulysses y conservan la
autoría indicada en sus cabeceras.
