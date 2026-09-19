## Why

El smoke de `link-enrichment` midió lo que el producto puede leer de verdad: de las cinco bolsas del manifiesto, hoy
**solo Get on Board** se deja leer. LinkedIn e Indeed lo prohíben en su `robots.txt`, Computrabajo nos bloquea, y el CDN
de Trabajopolis rechaza el cliente HTTP de Node aunque deje pasar a `curl` con las mismas cabeceras. Ninguna de esas
barreras se sortea: son decisiones de cada sitio (ADR-003). Pero eso deja la mayoría de lo que circula en un chat
boliviano con una tarjeta que dice "Esta bolsa no permite la lectura automática" y un formulario vacío.

La persona ya tiene la oferta delante: la está leyendo en su teléfono. Este change le deja **pegar el texto de la
oferta** y que la IA lo convierta en la misma vacante legible que produce una página bien marcada. Es el único
camino lícito para esas bolsas, y seguir postulaciones (`applications-tracking`) sobre tarjetas sin título sería peor
producto que no seguirlas.

Aprovecha también para cerrar la pregunta que dejó el smoke: un link cuyo `displayUrl` lleva un parámetro que el
`robots.txt` prohíbe se quedaba ilegible para siempre, aunque su propio historial tuviera la misma vacante sin él.

## What Changes

- **Completar pegando la descripción**: en cualquier tarjeta —y como acción principal en las que la bolsa no deja
  leer— la persona pega el texto de la oferta, con título y empresa aparte si no vienen en él, y
  `POST /api/links/:id/pasted` lo lee **dentro de la propia petición**: el texto solo vive en la memoria de esa
  petición y nunca se guarda ni se registra, igual que el chat de `job-links`.
- **Lo pegado es un dato personal**: se lee con una tarea propia, `extract-pasted-job`, declarada `personal`, de modo que
  no va a un proveedor externo sin consentimiento; y lo que se guarda de ella no reproduce nombres de personas.
- **`api` ejecuta IA por primera vez**: monta `AiModule`, con el mismo ledger, las mismas cuotas y la misma cadena de
  proveedores que el worker, y un plazo acotado para que la persona no espere más de unos segundos.
- **Un tercer origen para cada campo**: "Descripción pegada por <nombre>", entre "Leído de la página" y "Escrito por
  <nombre>". Precedencia: **escrito a mano > pegado > leído de la página**, en una sola función compartida por los dos
  procesos. Una relectura no pisa lo pegado, pegar no pisa lo escrito a mano ni deja huecos, y **toda sustitución se
  puede deshacer**, también un pegado equivocado.
- **Higiene antes de la IA**: emails y teléfonos del texto pegado se quitan igual que en las páginas. La regla, que hoy
  vive en el dominio del worker, pasa a `libs/shared` para que la apliquen los dos procesos sin copiarla.
- **Límite de pegados** por usuario y ventana, con el limitador de plataforma que ya existe.
- **Probar el historial cuando `robots.txt` niega**: si el `displayUrl` de un link está prohibido, el worker prueba las
  demás URLs de su historial del mismo host, cada una con su propio permiso, antes de rendirse con `robots_disallowed`.
  Y volver a guardar la vacante con una URL nueva pide una lectura nueva, que es lo que hace que ese rescate ocurra.
- **Golden propio de `extract-pasted-job`** con texto real copiado del móvil —sin cabecera, con ruido de la app y el
  nombre del reclutador—, sin tocar el de páginas.
- **Los avisos llegan a todas las instancias**: pegar y corregir a mano publican en el canal de Redis que ya existe.

## Capabilities

### New Capabilities
- `links/pasted-description`: completar un link pegando el texto de la oferta, sin guardar ese texto, con su límite y
  su origen propio.

### Modified Capabilities
- `links/enrichment`: "Preview con procedencia por campo" gana el origen `pasted` y su lugar en la precedencia;
  "Estados del enriquecimiento" deja de devolver a `failed` un link con campos pegados; nuevo requisito para probar
  las URLs del historial cuando `robots.txt` niega la principal.
- `web/links`: la tarjeta bloqueada señala la salida, se puede pegar la descripción, y "Editar la oferta a mano"
  distingue lo pegado de lo leído y de lo escrito.
- `platform/realtime`: el aviso se publica también al pegar y al corregir a mano, y llega a todas las instancias.

## Impact

- **Código**: `apps/api/src/modules/links/` (caso de uso de pegado, merge con el nuevo origen, controlador),
  `apps/api/src/app/app.module.ts` (monta `AiModule`), `apps/worker/src/modules/enrichment/` (el merge respeta lo
  pegado, prueba del historial), `libs/shared/src/` (origen `pasted`, contrato de la petición, higiene de contactos),
  `libs/ai/src/tasks/extract-pasted-job.task.ts` con su prompt y su golden y `apps/web/src/app/features/links/` (diálogo de pegado, origen nuevo).
- **API**: `POST /api/links/:id/pasted`, con `400` para un texto vacío o demasiado largo, `404` si no se puede ver el
  link, `422` si lo pegado no parece una oferta, `429` al superar el límite de pegados o la cuota de IA, y `503` si la
  IA no está disponible.
- **Datos**: ningún campo nuevo en `job_links`; `previewSources` admite el origen `pasted`. El texto pegado **no** se
  escribe en ninguna colección, cola ni log.
- **IA**: `api` pasa a consumir `runTask`; nueva tarea `extract-pasted-job`, `personal`, con su prompt, su golden y su
  línea base.
- **ADRs**: implementa ADR-003, ADR-010 y ADR-022, y respeta ADR-018. Las decisiones no triviales —IA dentro de `api`,
  el tercer origen y su precedencia, el rescate por historial— se registran en **ADR-023**.
- **Fuera de alcance**: crear un link nuevo solo a partir de un texto, sin URL (no tendría clave de dedupe); leer
  capturas de pantalla o PDFs; y cualquier forma de sortear un bloqueo de un sitio.
