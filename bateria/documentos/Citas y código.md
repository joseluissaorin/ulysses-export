# Citas y código

Un párrafo de entrada antes de la cita.

> La cita en bloque conserva la sangría de primera línea del párrafo en los estilos que la definen, se compone en cursiva donde la hoja lo pida y suma sus márgenes a los del texto, que es donde se ve si la geometría de contenedores está bien resuelta.

Prosa entre citas.

> Primera línea de una cita con varios párrafos.
>
> Segundo párrafo de la misma cita, más largo que el primero para obligar a que las líneas se partan dentro del bloque sangrado y comprobar el justificado interior con los márgenes dobles.
>
> Y un tercero de cierre.

Ahora código en bloque:

```
function saludo(nombre) {
	const mensaje = `Hola, ${nombre}`;
	return mensaje.toUpperCase(); // con tabulador inicial
}

const resultado = saludo("mundo con una línea larguísima que no debería partirse igual que la prosa porque es preformateada");
```

Y un párrafo con `código en línea` y más `fragmentos como este` mezclados con **negrita**, *cursiva*, ***las dos cosas***, ~~tachado~~ y ==resaltado==, además de un [enlace con texto](https://example.org/ruta) y un [[Enlace interno|alias de wikilink]].

> Cita final tras el código, para el ritmo cita–código–cita.
