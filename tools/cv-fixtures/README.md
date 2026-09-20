# Fixtures de la extracción de CV

`apps/worker/src/modules/cv/infrastructure/extractors/fixtures/cv-fixtures.ts` genera los archivos con los que se prueban los extractores del worker
(`apps/worker/src/modules/cv/infrastructure/extractors/`). **No añade ninguna dependencia**: un PDF mínimo es texto
plano con su tabla de referencias cruzadas, y un DOCX es un ZIP sin comprimir, que `node:zlib` sabe firmar con su
`crc32`.

**Ningún fixture lleva datos personales.** El texto es el de un CV inventado, con un nombre que no existe: ningún CV
real entra en este repositorio, ni siquiera en un test.

| Fixture | Qué es | Qué tiene que pasar |
|---|---|---|
| `cv-with-text.pdf` | Una página con capa de texto | `extracted` |
| `cv-without-text.pdf` | Una página con un rectángulo y ningún operador de texto: lo que da un escaneo | `failed` / `no_text` |
| `cv-corrupt.pdf` | La firma `%PDF-` y bytes al azar detrás | `failed` / `unreadable_file` |
| `cv-encrypted.pdf` | Un PDF con su diccionario de cifrado estándar | `failed` / `unreadable_file` |
| `cv-with-text.docx` | ZIP sin comprimir con `[Content_Types].xml`, `_rels/.rels` y `word/document.xml` | `extracted` |
| `not-a-docx.zip` | Un ZIP con una sola entrada `hola.txt` | `failed` / `unreadable_file` |

Los tests llaman a las funciones del módulo y trabajan con los bytes en memoria. Escribirlos en disco solo hace falta
para mirarlos a mano:

```sh
node --experimental-strip-types tools/cv-fixtures/make-fixtures.ts <carpeta>
```

## Dos trampas que costaron una tarde, anotadas para que no se repitan

1. **Las entradas de la tabla `xref` terminan en espacio, CR y LF.** Con `\n` a secas, aunque la entrada siga midiendo
   veinte bytes, `pdf-parse` rechaza el archivo. Es lo que hace `assemblePdf`.
2. **`pdf-parse` lee mal un búfer que viene del *pool* de Node.** Con `byteOffset` distinto de cero —lo normal en
   objetos pequeños, porque Node los saca de un búfer compartido— el parser lee las posiciones de la tabla `xref`
   desplazadas y falla con `bad XRef entry`. Por eso el adaptador copia los bytes a una vista de desplazamiento cero
   antes de llamarlo, y tiene su propio test con un PDF pequeño. Se reprodujo por debajo de ~4 kB; más arriba Node
   deja de usar el *pool* y el fallo desaparece, que es lo que lo hace tan fácil de no ver.

## El PDF cifrado

`docs/adr/ADR-028` y el diseño del change (D9) preveían producirlo **una vez** con `qpdf` y commitearlo como binario,
para no escribir un cifrador solo para un test:

```sh
qpdf --encrypt "clave-de-prueba" "clave-de-prueba" 40 -- cv-with-text.pdf cv-encrypted.pdf
```

Aquí se genera, y la razón es la misma que estaba detrás de aquella decisión: **tampoco se escribe ningún cifrador**.
Lo que el extractor tiene que ver es el **diccionario de cifrado**: en cuanto un PDF declara `/Filter /Standard` y su
`/Encrypt`, el parser toma el camino del descifrado y se planta pidiendo una contraseña que nadie le va a dar, que es
exactamente lo que le pasa a quien sube el CV que mandó protegido a una empresa. Generarlo evita, además, meter en el
repositorio un binario que nadie puede revisar en un PR, que era el otro motivo para generar los demás.

El día que haga falta un archivo cifrado **de verdad** —por ejemplo, para comprobar que con la contraseña correcta sí
se lee—, el comando de arriba es el que lo produce, y entonces sí tendría sentido commitearlo.
