# Catálogo de uso de LinkVault en local

Recorrido mínimo y completo de todas las funcionalidades archivadas (`openspec/changes/archive/`), en el orden en que
las encuentra un usuario nuevo. Cada ruta y cada endpoint citados existen en el código de `main`: las rutas en el
router de `apps/web`, los endpoints en los controladores de `apps/api`. Los textos entre comillas son los de la
interfaz en español. Lo que una spec promete y el código no tiene está en
[No encontrado en el código](#no-encontrado-en-el-código).

Convenciones: una ruta como `/grupos` es una pantalla del SPA en http://localhost:4200; `MÉTODO /api/...` es un
endpoint de la API en http://localhost:3000.

## Preparar el entorno local

Fuentes: `README.md` («Prerrequisitos», «Puesta en marcha»), `docs/RUNBOOK.md` (Paso 6 terdecies, quattuordecies,
quindecies y quindecies-bis), `docs/demo.md` y `.env.example`.

### 1. Prerrequisitos

- Node.js de `.nvmrc` (22.x), pnpm de `packageManager` (`corepack enable`), Docker con Compose v2.
- Windows: redistribuible de Visual C++ x64.

### 2. Instalar y configurar

```bash
pnpm install
cp .env.example .env
```

Cambios en `.env` para recorrer **todo** el catálogo (cada variable está documentada en `.env.example`):

```dotenv
# IA: sin proveedores reales. `synth` es el valor de .env.example y el que fija CLAUDE.md para desarrollo.
AI_CHAIN=mock
AI_MOCK_MODE=synth
# Búsqueda (perfil search/demo de compose)
FEATURE_SEARCH=true
# Descubrir vacantes: `mock` no sale a Internet; `live` consulta Get on Board y Remote OK de verdad
FEATURE_DISCOVERY=true
DISCOVERY_CHAIN=mock
# Frescura de vacantes y resumen semanal (worker)
FEATURE_LINK_FRESHNESS=true
FEATURE_GROUP_DIGEST=true
# Push del navegador: par generado con `npx web-push generate-vapid-keys` (RUNBOOK, Web Push VAPID)
VAPID_PUBLIC_KEY=<Public Key>
VAPID_PRIVATE_KEY=<Private Key>
# Claves propias (BYOK): node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
AI_VAULT_KEY=<32 bytes en base64>
```

**IA en local.** `AI_MOCK_MODE=synth` devuelve el fixture si existe y, si no, una salida **sintética determinista**
(`libs/ai/src/infrastructure/providers/mock-deterministic.provider.ts:22-23`). Con `replay` (el modo de CI) una entrada
sin fixture lanza `FixtureMissing`, que es un error de programación y no una degradación: pegar descripciones, el encaje y
el plan de estudio no servirían con datos propios. En ninguno de los dos modos sale nada de tu máquina, y el mock no es
un proveedor externo (`external: false`), así que no hace falta el permiso de IA externa. Salida sintética con `synth`
(no es IA real, no la juzgues como tal):

| Tarea | Dónde se ve |
| ----- | ----------- |
| `extract-job` | Enriquecimiento de una página sin JSON-LD ni metadatos suficientes: campos «Deducido por la IA». |
| `extract-pasted-job` | «Pegar la descripción». |
| `match-cv` y `critique-suggestions` | «Analizar mi encaje»: badge, habilidades, sugerencias y los pasos «Revisando sugerencias…» / «Mejorando sugerencias…». |
| `build-roadmap` | «Plan de estudio» en `/plan/:analysisId`. |
| Embeddings (`AI_EMBED_CHAIN=mock`) | Parte semántica de `/buscar`. |

### 3. Levantar la infraestructura

```bash
docker compose --profile demo up -d --wait   # mongo (rs0), redis, minio, mailpit y meilisearch
```

Sin búsqueda basta `docker compose up -d --wait` (sin Meilisearch). `--profile search` es equivalente a `demo` para
Meilisearch. Ollama (`--profile ai-local`) no hace falta para este catálogo.

### 4. Cargar la demo

```bash
ALLOW_DEMO_SEED=true pnpm nx run api:seed-demo
```

Idempotente: repetirlo no duplica. Para partir de cero: `docker compose down -v` (borra los volúmenes).

### 5. Servir las apps (una terminal cada una)

```bash
pnpm nx serve api      # http://localhost:3000 (API bajo /api)
pnpm nx serve worker   # http://localhost:3001 (solo salud y métricas)
pnpm nx serve web      # http://localhost:4200 (reenvía /api a la API)
```

Comprobación: `curl http://localhost:3000/health` y `curl http://localhost:3001/health` → `200`.

### 6. Entrar

- SPA: http://localhost:4200 → «Iniciar sesión» con una cuenta de la demo.
- Correo (verificación, recuperación, avisos): Mailpit en http://localhost:8025.
- Con `curl`, obtén un access token (dura 15 min; repite el login al caducar):

```bash
H='X-Requested-With: linkvault'
J='Content-Type: application/json'
curl -s -c cookies.txt -H "$H" -H "$J" http://localhost:3000/api/auth/login \
  -d '{"email":"ana@demo.linkvault.local","password":"Demo-pass-Ana-12345!"}'   # copia accessToken
T='Authorization: Bearer <accessToken>'
```

### Datos de la demo

Fuente: `apps/api/src/seed/demo-seed.dataset.ts` y `seed-demo.runner.ts`.

| Dato | Valor |
| ---- | ----- |
| Ana (owner) | `ana@demo.linkvault.local` / `Demo-pass-Ana-12345!` |
| Bob (member) | `bob@demo.linkvault.local` / `Demo-pass-Bob-12345!` |
| Grupo | «Demo LatAm», código `SEEDD3M2`, enlaces públicos por defecto |
| Link 1 | «Backend Engineer (Demo)», Demo LatAm Corp, remoto, 4000–6000 USD/mes. Postulación de Ana: Postulada. Comentario de Ana y «conozco a alguien» de Bob |
| Link 2 | «Frontend Engineer (Cerrada)», híbrido, 15 000–22 000 BOB/mes, **cerrada** (`recheck`). Postulación: En proceso, etapa «Entrevista técnica» |
| Link 3 | «QA Analyst (Demo)», Acme Bolivia, presencial. Postulación: Rechazada |
| Link 4 | «Mobile Developer (Stale)», Startup Andes, remoto. Postulación: Postulada, sin cambios desde hace 11 días |
| CV de Ana | `ana-demo-cv.pdf`, un PDF mínimo **sin texto** |

- **El CV de la demo no sirve para el encaje**: no tiene texto. Sube un CV real (PDF o DOCX con texto) en `/mi-cv`.
- Las cuentas de la demo nacen **sin email verificado**: los avisos por email de producto no les llegan hasta verificar
  (ver [2. Verificar el email](#2-verificar-el-email)). Mailpit captura cualquier dirección, también `@demo.linkvault.local`.
- Los links apuntan a `demo.linkvault.local`, que no existe: su lectura automática falla, pero los datos escritos por el
  seed se quedan (lo escrito a mano manda).

## Recorrido

### Cuenta

#### 1. Crear una cuenta

- **Qué es:** alta con email, nombre y contraseña.
- **Dónde:** `/registro` · `POST /api/auth/register`.
- **Cómo probarla:** abre `/registro` → nombre, email nuevo, contraseña de 10+ caracteres → «Crear cuenta».
- **Qué esperar:** entras directamente en `/grupos`, con el aviso «Tu email aún no está verificado…». Un email ya usado
  muestra «Ya existe una cuenta con este email».
- **Requiere:** api y web.

#### 2. Verificar el email

- **Qué es:** confirmar el email con el enlace del correo.
- **Dónde:** aviso de la barra, `/verificar-email?token=…` · `POST /api/auth/verify-email/resend`,
  `POST /api/auth/verify-email`.
- **Cómo probarla:** en el aviso, «Reenviar correo» → abre Mailpit → correo «Verifica tu email en LinkVault» → pulsa
  el enlace.
- **Qué esperar:** «Email verificado» y el aviso desaparece. Un enlace usado o caducado: «Este enlace no es válido o ha
  caducado.».
- **Requiere:** Mailpit.

#### 3. Iniciar y cerrar sesión

- **Qué es:** login, sesión restaurada al recargar y logout.
- **Dónde:** `/login` · `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`.
- **Cómo probarla:** «Cerrar sesión» en la barra → `/login` con Ana → «Entrar» → recarga la página.
- **Qué esperar:** tras recargar, «Conectando…» un instante y sigues dentro. Contraseña mala: «Email o contraseña
  incorrectos». Una ruta protegida sin sesión lleva a `/login?returnUrl=…`.
- **Requiere:** api y web.

#### 4. Recuperar la contraseña

- **Qué es:** elegir una contraseña nueva desde un enlace por correo.
- **Dónde:** `/recuperar-contrasena`, `/restablecer-contrasena?token=…` · `POST /api/auth/forgot-password`,
  `POST /api/auth/reset-password`.
- **Cómo probarla:** en `/login`, «Olvidé mi contraseña» → email → «Enviar instrucciones» → Mailpit, correo
  «Restablece tu contraseña de LinkVault» → enlace → «Nueva contraseña» → «Guardar contraseña».
- **Qué esperar:** «Tu contraseña se ha actualizado…»; las demás sesiones quedan cerradas. Con un email inexistente la
  pantalla dice lo mismo (no revela cuentas).
- **Requiere:** Mailpit. Si lo haces con Ana, el seed restaura su contraseña al volver a ejecutarlo.

#### 5. Perfil: nombre y contraseña

- **Qué es:** cambiar el nombre visible y la contraseña.
- **Dónde:** `/perfil` · `GET /api/users/me`, `PATCH /api/users/me`, `POST /api/auth/password`.
- **Cómo probarla:** «Perfil» en la barra → cambia «Nombre» → «Guardar nombre»; en «Cambiar la contraseña», actual y
  nueva → «Cambiar contraseña».
- **Qué esperar:** «Nombre guardado»; «Contraseña cambiada. Cerramos tu sesión en los demás dispositivos.».
- **Requiere:** api.

#### 6. Aviso de privacidad

- **Qué es:** qué se hace con el CV, la IA, las claves propias y el borrado de cuenta.
- **Dónde:** `/privacidad` (pública).
- **Cómo probarla:** abre `/privacidad` sin sesión, o desde «aviso de privacidad» en `/perfil` o `/mi-cv`.
- **Qué esperar:** «Aviso de privacidad» con «Tu CV», «IA, OpenRouter y tus claves (BYOK)» y «Borrar tu cuenta».
- **Requiere:** web.

### Grupos

#### 7. Crear un grupo

- **Qué es:** el espacio donde un círculo junta ofertas.
- **Dónde:** `/grupos` · `POST /api/groups`, `GET /api/groups`, `GET /api/groups/:id`.
- **Cómo probarla:** «LinkVault» en la barra (lleva a `/grupos`) → «Crear un grupo» → nombre → «Crear grupo».
- **Qué esperar:** entras en `/grupos/:id` como «Propietario», con el «Código de invitación». Límite: 20 grupos por
  persona («Ya perteneces a 20 grupos, el máximo»).
- **Requiere:** api.

#### 8. Invitar y unirse con un código

- **Qué es:** entrar a un grupo con el código de 8 caracteres o el enlace de invitación.
- **Dónde:** `/unirse?codigo=…` · `POST /api/groups/join`, `POST /api/groups/:id/invite-code`.
- **Cómo probarla:**
  1. Como Ana, en el grupo: «Copiar invitación» (copia `…/unirse?codigo=…`).
  2. Con otra cuenta (ventana privada), abre ese enlace, o `/grupos` → «Unirse con un código» → `SEEDD3M2` → «Unirme».
  3. Como Ana: «Regenerar el código» → «Regenerar».
- **Qué esperar:** el invitado entra al detalle del grupo; el código anterior deja de servir («Ese código no corresponde
  a ningún grupo»).
- **Requiere:** dos cuentas (regístrate una o usa Bob).

#### 9. Administrar el grupo

- **Qué es:** renombrar, expulsar, nombrar propietario, salir y borrar.
- **Dónde:** `/grupos/:id` · `PATCH /api/groups/:id`, `GET /api/groups/:id/members`,
  `DELETE /api/groups/:id/members/:userId`, `POST /api/groups/:id/owner`, `DELETE /api/groups/:id/members/me`,
  `DELETE /api/groups/:id`.
- **Cómo probarla** (en un grupo tuyo con otro miembro, no en el de la demo):
  1. «Renombrar» → «Guardar nombre nuevo».
  2. En un miembro: «Nombrar propietario» → confirmar. Ahora ves «Salir del grupo».
  3. Como nuevo owner: «Expulsar» al otro → «Ahora no» o «Regenerar el código para que no pueda volver a entrar».
  4. «Borrar el grupo» → «Borrar».
- **Qué esperar:** el owner nunca puede salir sin ceder la propiedad («Para salir, nombra propietario a otro miembro»);
  la confirmación de borrado dice cuántas ofertas se pierden.
- **Requiere:** dos cuentas.

### Links

#### 10. Guardar una oferta en un grupo

- **Qué es:** compartir el enlace de una oferta con el grupo, con una nota opcional.
- **Dónde:** `/grupos/:id` · `POST /api/links`, `GET /api/groups/:id/links`.
- **Cómo probarla:** en «Demo LatAm», «Pega el enlace de una oferta» → URL de una oferta (por ejemplo de getonbrd.com) →
  «Nota para el grupo (opcional)» → «Guardar». Guarda otra vez la misma URL.
- **Qué esperar:** la tarjeta aparece con «Leyendo la oferta…» y «Nota de {tu nombre}». El grupo comparte en público por
  defecto: «Cualquiera con este enlace verá la oferta…» y «Copiar enlace». La segunda vez: «Ya estaba aquí, lo compartió
  …».
- **Requiere:** api, worker (para la lectura).

#### 11. Solo para mí (lista privada)

- **Qué es:** ofertas guardadas sin grupo.
- **Dónde:** `/mis-links` · `POST /api/links` (sin `groupId`), `GET /api/links/mine`, `DELETE /api/links/mine/:linkId`.
- **Cómo probarla:** «Solo para mí» en la barra → pega un enlace → «Guardar» → en la tarjeta, «Quitar» → «Quitar».
- **Qué esperar:** la oferta aparece solo ahí; al quitarla, «Se quita de tu lista; la oferta sigue disponible en tus
  grupos.». Si ya estaba en un grupo tuyo: «Ya la tienes en: …».
- **Requiere:** api.

#### 12. Importar un chat

- **Qué es:** pegar una conversación (p. ej. de WhatsApp) y guardar todas sus URLs de una vez.
- **Dónde:** `/grupos/:id` o `/mis-links` · `POST /api/links/import`.
- **Cómo probarla:** «Pegar un chat» → pega un texto con dos o tres URLs → «Importar».
- **Qué esperar:** resumen «N guardadas, M ya estaban» y «Leyendo ofertas: x de N listas». El texto no se guarda.
  Máximo 20 000 caracteres y 50 links por vez.
- **Requiere:** api, worker.

#### 13. Lectura automática de la oferta y avisos en vivo

- **Qué es:** el worker lee la página (respetando `robots.txt`) y completa título, empresa, modalidad, salario…
- **Dónde:** tarjeta de `/grupos/:id` y `/mis-links` · `GET /api/events` (SSE), `POST /api/links/:linkId/enrich`.
- **Cómo probarla:**
  1. Guarda una oferta de getonbrd.com (la única bolsa que se deja leer) y espera sin recargar.
  2. Guarda una de LinkedIn (`https://www.linkedin.com/jobs/view/1234567890/`).
  3. En un fallo reintentable, «Reintentar».
  4. Con `curl`: `curl -sN -H "$T" http://localhost:3000/api/events` y guarda un link en otra ventana.
- **Qué esperar:** la tarjeta se completa sola, con el origen de cada dato («Deducido por la IA» si lo puso la IA).
  LinkedIn: «LinkedIn no nos deja leer sus ofertas. Pega su descripción para completarla», sin reintento. Tres
  relecturas por link cada 15 min.
- **Requiere:** worker, red saliente. IA sintética si la página no trae JSON-LD ni metadatos.

#### 14. Corregir una oferta a mano

- **Qué es:** escribir o corregir campos de la vacante; se ve quién los escribió y se puede volver atrás.
- **Dónde:** tarjeta → «Editar» o «Completar a mano» · `PATCH /api/links/:linkId/preview`.
- **Cómo probarla:** «Editar» → cambia «Puesto» → «Guardar» → «Editar» otra vez → «Volver a lo anterior» en ese campo.
- **Qué esperar:** «Escrito por {nombre}» junto al campo; al revertir vuelve el valor y el origen anteriores. Cualquiera
  que vea el link puede corregirlo.
- **Requiere:** api.

#### 15. Pegar la descripción

- **Qué es:** completar una oferta que no se deja leer pegando su texto.
- **Dónde:** tarjeta → «Pegar la descripción» · `POST /api/links/:linkId/pasted`.
- **Cómo probarla:** en la oferta de LinkedIn del paso 13, «Pegar la descripción» → pega un texto de oferta → Puesto y
  Empresa si faltan → «Completar la oferta» → luego «Deshacer lo que pegó {nombre}».
- **Qué esperar:** «Leyendo… puede tardar unos segundos» y la tarjeta completa con «Descripción pegada por {nombre}».
  Deshacer devuelve la tarjeta a su estado anterior. Un chat en vez de una oferta: «Eso no parece una oferta de
  trabajo…». Máximo 10 pegados cada 15 min.
- **Requiere:** IA en `synth` (salida sintética).

#### 16. Quitar una oferta del grupo

- **Qué es:** retirar la relación con el grupo; la vacante sigue en otros grupos.
- **Dónde:** tarjeta → «Quitar» · `DELETE /api/groups/:id/links/:linkId`.
- **Cómo probarla:** en una oferta que compartiste tú → «Quitar» → «Quitar».
- **Qué esperar:** la confirmación dice cuántos comentarios se pierden y que el enlace público deja de funcionar. Solo lo
  ofrece a quien compartió y al owner.
- **Requiere:** api.

#### 17. Comentarios y nota

- **Qué es:** hilo por oferta dentro del grupo y la nota de quien la compartió.
- **Dónde:** tarjeta del grupo → «Comentar» / «Responder» / «Ver los N comentarios» ·
  `POST /api/groups/:id/links/:linkId/comments`, `GET /api/groups/:id/links/:linkId/comments`,
  `DELETE /api/groups/:id/links/:linkId/comments/:commentId`, `DELETE /api/groups/:id/links/:linkId/note`.
- **Cómo probarla:**
  1. Como Bob, en «Backend Engineer (Demo)»: «Responder» → escribe → «Comentar» (o Ctrl+Enter).
  2. Con Ana en otra ventana, mira la tarjeta sin recargar.
  3. Como Ana (owner), «Borrar» el comentario de Bob; en tu nota, «Quitar la nota».
- **Qué esperar:** el comentario llega en vivo a la otra ventana; borrar lo ajeno avisa «Desaparecerá para todo el
  grupo…». Máximo 30 comentarios cada 15 min.
- **Requiere:** dos cuentas; api con Redis (aviso en vivo).

#### 18. «Conozco a alguien ahí»

- **Qué es:** marcar que conoces a alguien en la empresa; el grupo ve cuántos, no quiénes.
- **Dónde:** tarjeta del grupo · `PUT /api/groups/:id/links/:linkId/know-someone`.
- **Cómo probarla:** como Ana, en «Backend Engineer (Demo)» (Bob ya lo marcó) → «Conozco a alguien ahí» → pulsa otra vez.
- **Qué esperar:** «2 personas conocen a alguien ahí» y el botón «Ya marqué que conozco a alguien»; al desmarcar vuelve a
  «1 persona…». No aparece en `/mis-links`.
- **Requiere:** api. Curl: `curl -s -H "$T" -H "$J" -X PUT .../know-someone -d '{"flagged":true}'`.

#### 19. Fijar, etiquetar y filtrar

- **Qué es:** lista corta del grupo y etiquetas libres para organizar ofertas.
- **Dónde:** `/grupos/:id` · `PUT /api/groups/:id/links/:linkId/pinned`, `PUT /api/groups/:id/links/:linkId/tags`,
  `GET /api/groups/:id/links` (`?pinned=true`, `?tag=…`).
- **Cómo probarla:** «Fijar» en una tarjeta → «Editar etiquetas» → `backend, remoto` → «Guardar etiquetas» → activa
  «Solo fijados» → escribe `backend` en «Filtrar por etiqueta» → «Filtrar» → «Quitar etiqueta».
- **Qué esperar:** «Fijado» no cambia el orden; los filtros piden la lista al servidor. Hasta 8 etiquetas, minúsculas,
  sin tildes (`a-z`, `0-9`, espacio y guion, 32 caracteres).
- **Requiere:** api. Cualquier miembro puede fijar y etiquetar.

#### 20. Enlace público de una oferta

- **Qué es:** URL corta que cualquiera abre sin cuenta, con la oferta pero sin grupo, nombres ni comentarios.
- **Dónde:** menú de la tarjeta del grupo · `PUT /api/groups/:id/links/:linkId/public`,
  `DELETE /api/groups/:id/links/:linkId/public`, `GET /p/:slug` (HTML para los bots de chat),
  `GET /api/public/previews/:slug`, vista `/oferta/:slug`, `PATCH /api/groups/:id/settings`.
- **Cómo probarla:**
  1. En una tarjeta sin enlace: «Compartir con un enlace público» → «Compartir» → «Copiar enlace».
  2. Abre la URL copiada (`http://localhost:3000/p/<slug>`) en una ventana privada.
  3. «Dejar de compartir» → «Dejar de compartir» → recarga la URL.
  4. Como owner, desactiva «Los links nuevos se comparten con un enlace público» y guarda otra oferta.
- **Qué esperar:** la ventana privada acaba en `/oferta/:slug` con «Ver la oferta original» y «Guardar en LinkVault».
  Tras despublicar: «Este enlace ya no está disponible». Con el ajuste apagado, la oferta nueva nace sin enlace.
- **Requiere:** api y web.

#### 21. Guardar desde un enlace público

- **Qué es:** quien recibe el enlace se crea cuenta y la oferta cae en su lista privada.
- **Dónde:** `/oferta/:slug` → `/registro?import=<slug>` → `/mis-links?import=<slug>`.
- **Cómo probarla:** en la vista pública (ventana privada), «Guardar en LinkVault» → regístrate con una cuenta nueva.
- **Qué esperar:** acabas en «Solo para mí» con «Guardada en «Solo para mí». Compártela en un grupo cuando quieras.»;
  nunca en un grupo. Con sesión abierta, el botón te lleva directo a `/mis-links?import=…`.
- **Requiere:** un enlace público vivo.

#### 22. Oferta cerrada y reabrir

- **Qué es:** marca de vacante cerrada y la acción de reabrirla si fue un error.
- **Dónde:** tarjeta · `POST /api/links/:linkId/reopen`.
- **Cómo probarla:** en «Frontend Engineer (Cerrada)» → «Reabrir». Si la oferta tiene «Cierra el» en el pasado, sale
  «Elige cuándo cierra»: fecha futura → «Reabrir», o «Sin fecha de cierre».
- **Qué esperar:** desaparece «Oferta cerrada» y sale «Oferta marcada como abierta. Las postulaciones caducadas no cambian
  solas.».
- **Requiere:** api. Cualquiera que vea el link puede reabrirlo.

#### 23. Frescura de vacantes (cierre automático)

- **Qué es:** el worker revisa periódicamente las ofertas abiertas y cierra las vencidas; al cerrar, caduca las
  postulaciones abiertas.
- **Dónde:** worker (sin pantalla propia); se ve como «Oferta cerrada» en la tarjeta y «Expirada» en el tablero.
- **Cómo probarla:** en una oferta con postulación abierta, «Editar» → «Cierra el» con una fecha pasada → «Guardar» →
  espera la pasada horaria del worker.
- **Qué esperar:** la tarjeta pasa a «Oferta cerrada» en vivo (motivo `calendar`, sin descargar la página) y la
  postulación, a «Expirada».
- **Requiere:** `FEATURE_LINK_FRESHNESS=true`, worker. Cadencia: `LINK_FRESHNESS_INTERVAL_DAYS` (7).

### Postulaciones

#### 24. Seguir una oferta

- **Qué es:** registrar el propio interés o postulación en una oferta; es privado.
- **Dónde:** tarjeta → «Me interesa» / «Postulé» · `POST /api/applications`, `GET /api/applications`.
- **Cómo probarla:** en `/mis-links` o en un grupo, «Me interesa» en una oferta; en otra, «Postulé» → «¿Cuándo
  postulaste?» → «Hoy».
- **Qué esperar:** la tarjeta muestra «Tu postulación:» con el estado y enlace al tablero.
- **Requiere:** api.

#### 25. Compartir mi estado con el grupo

- **Qué es:** que los miembros vean tu estado (no etapa, notas ni fechas) como avatar en la tarjeta.
- **Dónde:** aviso tras el gesto en `/grupos/:id`; interruptor en el panel · `PATCH /api/applications/:id`,
  `GET /api/groups/:id/applications`.
- **Cómo probarla:** como Bob, en el grupo, «Me interesa» → en el aviso «¿Que tus grupos vean que te interesa esta
  oferta?…», «Compartir» (o «Qué verán»). Entra como Ana y abre el grupo.
- **Qué esperar:** Ana ve el avatar de Bob con «Bob Demo · postulación: Interés». «Deshacer» lo vuelve privado.
- **Requiere:** dos cuentas.

#### 26. Tablero de postulaciones

- **Qué es:** columnas por estado, con etapa, historial y notas privadas.
- **Dónde:** `/postulaciones` · `PATCH /api/applications/:id/status`, `PATCH /api/applications/:id`,
  `GET /api/applications/:id/events`.
- **Cómo probarla** (como Ana):
  1. «Postulaciones» en la barra.
  2. Arrastra «Backend Engineer (Demo)» a «En proceso» (o «Mover a…») → «Etapa (opcional)»: «Prueba técnica» → «Guardar».
  3. Suéltala en «Cerradas» → «¿Cómo se cerró?» → «Retirada».
  4. Pulsa la tarjeta: «Historial», «Notas (solo las ves tú)» → «Guardar la nota», interruptor «Compartir mi estado con
     mis grupos».
- **Qué esperar:** seis columnas («Interés», «Postuladas», «En proceso», «Con oferta», «Aceptadas», «Cerradas»); cada
  cambio queda en el historial. Un cambio desde otra pestaña: «Esta postulación cambió en otra pestaña…».
- **Requiere:** api.

#### 27. Dejar de seguir

- **Qué es:** borrar la postulación y su historial (no la oferta).
- **Dónde:** panel de la tarjeta → «Dejar de seguir» · `DELETE /api/applications/:id`.
- **Cómo probarla:** abre una tarjeta del tablero → «Dejar de seguir» → confirmar.
- **Qué esperar:** desaparece del tablero; la oferta sigue en su grupo o lista.
- **Requiere:** api.

#### 28. Insights de postulaciones

- **Qué es:** resumen propio por estado y las postulaciones estancadas.
- **Dónde:** `/postulaciones/insights` · `GET /api/applications/analytics`.
- **Cómo probarla:** en el tablero, «Ver insights».
- **Qué esperar:** «Resumen» (Abiertas / Cerradas / Aceptadas), «Por estado» y «Estancadas (≥ 10 días)» con «Mobile
  Developer (Stale)» y «Ver en el tablero».
- **Requiere:** demo o postulaciones propias.

### CV e IA

#### 29. Mi CV

- **Qué es:** hasta 5 CV en PDF o DOCX; LinkVault lee su texto (sin IA) para compararlo después.
- **Dónde:** `/mi-cv` · `POST /api/cv`, `GET /api/cv`, `GET /api/cv/:id/text-preview`, `PUT /api/cv/:id/default`,
  `DELETE /api/cv/:id`.
- **Cómo probarla:** «Mi CV» → «Subir CV» (un PDF real con texto) → espera → «Ver lo que leímos» → «Usar este» en otro
  CV → «Eliminar».
- **Qué esperar:** «Estamos leyendo tu CV…» → «Listo · tu CV se leyó bien». El CV de la demo acaba en «Este archivo no
  tiene texto…». No hay descarga del archivo.
- **Requiere:** worker, MinIO.

#### 30. Permiso de IA externa, idioma y nombre

- **Qué es:** decidir si el CV puede ir a un proveedor externo, en qué idioma salen los análisis y si se oculta el nombre.
- **Dónde:** `/perfil`, sección «IA y privacidad» · `PATCH /api/users/me`.
- **Cómo probarla:** activa «Permitir que un proveedor de IA externo analice mi CV» → cambia «Idioma de los análisis de
  IA» → alterna «Ocultar mi nombre a los proveedores externos» → desactiva el permiso.
- **Qué esperar:** «Concedido el … · versión 2026-09-21»; al retirar, «Permiso retirado…». `/mi-cv` refleja el estado
  del permiso. En local no hay proveedor externo: el permiso solo cambia textos y el enrutado.
- **Requiere:** api.

#### 31. Analizar mi encaje

- **Qué es:** comparar tu CV con una oferta: badge, habilidades que coinciden y faltan, sugerencias.
- **Dónde:** tarjeta → «Analizar mi encaje» · `POST /api/links/:linkId/match`, `GET /api/links/:linkId/match`.
- **Cómo probarla:** con un CV propio leído, en «Backend Engineer (Demo)» → «Analizar mi encaje» → «Analizar».
- **Qué esperar:** pasos «Leyendo la oferta», «Comparando con tu CV», «Redactando sugerencias»… y el informe con «Encaje
  alto/medio/bajo». El tablero muestra el badge en esa postulación. Sin CV: «Necesitas un CV guardado…»; oferta sin leer:
  «Todavía no hemos leído esta oferta…».
- **Requiere:** worker, CV con texto, IA en `synth` (salida sintética). Cuota: 10 análisis al día.

#### 32. Sugerencias y «No me convence»

- **Qué es:** propuestas de cambio al CV con la evidencia de la oferta y del CV; se puede marcar una que no convence.
- **Dónde:** informe del encaje · `POST /api/analyses/:analysisId/suggestion-feedback`.
- **Cómo probarla:** en el informe, «Copiar» una sugerencia → «No me convence» en otra.
- **Qué esperar:** «Copiado»; «Marcada». Solo aparecen en un análisis no básico.
- **Requiere:** análisis no degradado (`synth`).

#### 33. Plan de estudio

- **Qué es:** plan por semanas con recursos para las habilidades que faltan.
- **Dónde:** `/plan/:analysisId` · `POST /api/analyses/:analysisId/roadmap`, `GET /api/analyses/:analysisId/roadmap`,
  `GET /api/analyses/:analysisId/roadmap.md`.
- **Cómo probarla:** en un informe con «Habilidades que faltan», «Ver plan de estudio» → espera → «Exportar Markdown».
- **Qué esperar:** «Estamos preparando tu plan de estudio…» → ítems por semanas con «Verificado» / «Sin verificar»; se
  descarga `roadmap-<analysisId>.md`.
- **Requiere:** worker, análisis no degradado con habilidades faltantes, IA en `synth`. Cuota: 10 planes al día.

#### 34. Claves de IA propias (BYOK)

- **Qué es:** guardar cifrada una clave de Anthropic, OpenAI u OpenRouter.
- **Dónde:** `/perfil`, «Tus claves de IA» · `GET /api/users/me/ai-keys`, `PUT /api/users/me/ai-keys/:vendor`,
  `DELETE /api/users/me/ai-keys/:vendor`, `DELETE /api/users/me/ai-keys`.
- **Cómo probarla:** en un proveedor, «Clave de API» con un valor de prueba de 16+ caracteres → «Guardar clave» →
  «Rotar clave» → «Revocar» → «Revocar».
- **Qué esperar:** «Configurada · hint …xxxx»; nunca se muestra la clave entera. Sin `AI_VAULT_KEY`, guardar responde
  `503 vault_unavailable`.
- **Requiere:** `AI_VAULT_KEY`. **No pegues una clave real** si quieres seguir sin IA real: con el permiso externo
  activo, una clave propia tiene prioridad sobre el mock.

### Búsqueda y descubrimiento

#### 35. Buscar

- **Qué es:** búsqueda híbrida sobre vacantes, postulaciones, comentarios, notas, CV y planes que puedes ver.
- **Dónde:** `/buscar` · `GET /api/search`.
- **Cómo probarla:** «Buscar» → «Engineer» → «Buscar»; luego «Moneda» USD, «Salario mínimo» 3000 y «Solo abiertas»; luego
  «Estado» «Postulada».
- **Qué esperar:** resultados tipados que enlazan a su pantalla; «Solo abiertas» excluye «Frontend Engineer (Cerrada)».
  Consulta vacía: «Escribe algo para buscar…». Sin Meilisearch o con el flag apagado: «La búsqueda no está disponible en
  este momento…».
- **Requiere:** `FEATURE_SEARCH=true` en api y worker, perfil `search` o `demo`, worker (indexa desde el outbox). Datos
  anteriores al flag: `pnpm nx run api:backfill-search -- --limit=500`.

#### 36. Salario leído del texto

- **Qué es:** sacar mínimo y máximo de un salario escrito en el resumen para que funcione el filtro por rango.
- **Dónde:** worker (al leer una oferta) y CLI; se ve en el filtro de salario de `/buscar`.
- **Cómo probarla:**

```bash
pnpm nx run api:backfill-salary-parse -- --limit=500 --dry-run   # qué cambiaría
pnpm nx run api:backfill-salary-parse -- --limit=500
pnpm nx run api:backfill-search -- --docType=job_preview --limit=500
```

- **Qué esperar:** el CLI imprime cuántas ofertas actualiza; esas ofertas aparecen en búsquedas con rango de salario.
  No toca salarios escritos a mano ni pegados.
- **Requiere:** `FEATURE_SEARCH=true` para el segundo paso.

#### 37. Descubrir vacantes

- **Qué es:** buscar en bolsas públicas (Get on Board, Remote OK) y guardar sin salir de LinkVault.
- **Dónde:** `/descubrir` · `GET /api/discovery/search`, `POST /api/links`.
- **Cómo probarla:** «Descubrir» → «react» → «Buscar» → «Guardar en» un grupo → «Guardar» en un resultado.
- **Qué esperar:** con `DISCOVERY_CHAIN=mock`, dos resultados fijos («React Developer» de GetOnBoard y «Senior React
  Engineer» de RemoteOK); la oferta aparece en el grupo elegido. Con el flag apagado: «El descubrimiento de vacantes no
  está disponible en este momento.».
- **Requiere:** `FEATURE_DISCOVERY=true`. `DISCOVERY_CHAIN=live` sale a Internet.

### Notificaciones

#### 38. Preferencias de notificaciones

- **Qué es:** elegir qué avisos por email llegan.
- **Dónde:** `/notificaciones` (desde «Gestionar notificaciones» en `/perfil`) ·
  `GET /api/notifications/preferences`, `PATCH /api/notifications/preferences`.
- **Cómo probarla:** desactiva «Nuevo link en un grupo» → «Guardar preferencias» → recarga.
- **Qué esperar:** «Preferencias guardadas» y el valor persiste. Todas vienen activadas por defecto, incluida «Avisarme
  también de mis propias acciones».
- **Requiere:** api.

#### 39. Avisos por email

- **Qué es:** correos por nuevo link en un grupo, cambio de estado compartido en el grupo y postulación estancada.
- **Dónde:** worker → Mailpit.
- **Cómo probarla** (cuenta con email verificado):
  1. Guarda una oferta en un grupo → correo «Nuevo link en tu grupo».
  2. Con una postulación compartida con el grupo, cambia su estado → «Actualización de postulación en el grupo».
  3. Con la demo, espera la pasada horaria → a Ana le llega «Tu postulación lleva tiempo sin cambios» por «Mobile
     Developer (Stale)».
- **Qué esperar:** los correos en Mailpit; un cambio solo de etapa o una postulación privada no avisan al grupo.
- **Requiere:** worker, Mailpit, email verificado (los usuarios de la demo no lo están), preferencia activa. Estancada:
  10 días sin cambio de estado.

#### 40. Push del navegador

- **Qué es:** avisos push además del email.
- **Dónde:** `/notificaciones`, «Push del navegador» · `GET /api/notifications/push-vapid-public-key`,
  `POST /api/notifications/push-subscriptions`, `DELETE /api/notifications/push-subscriptions`.
- **Cómo probarla:** «Activar push» → acepta el permiso del navegador → provoca un aviso (paso 39) → «Desactivar push».
- **Qué esperar:** «Push activado en este dispositivo» y la notificación del sistema. Sin claves VAPID: «El push no está
  disponible ahora. Los avisos por email siguen activos.».
- **Requiere:** `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` en api y worker, worker.

#### 41. Resumen semanal del grupo

- **Qué es:** un correo con las ofertas compartidas en el grupo la semana anterior.
- **Dónde:** worker → Mailpit.
- **Cómo probarla:** con `FEATURE_GROUP_DIGEST=true`, espera al cron (`GROUP_DIGEST_CRON`, por defecto lunes 14:00 UTC) o
  pon en esa variable una expresión cron cercana y reinicia el worker.
- **Qué esperar:** correo «Resumen semanal · {grupo}». Procesa la **semana ISO anterior**: un grupo sin links
  compartidos esa semana no recibe nada, así que con datos recién creados no sale ningún correo.
- **Requiere:** `FEATURE_GROUP_DIGEST=true`, worker, email verificado, preferencia «Digest semanal del grupo».

### Extensión del navegador

#### 42. Extensión para Chromium

- **Qué es:** guardar la URL de la pestaña activa en la lista privada o en un grupo.
- **Dónde:** popup de la extensión · `POST /api/auth/extension/login`, `POST /api/auth/extension/refresh`,
  `POST /api/auth/extension/logout`, `GET /api/groups`, `POST /api/links`.
- **Cómo probarla:**
  1. `pnpm nx build extension` (sale en `dist/apps/extension/`).
  2. `chrome://extensions` → Modo desarrollador → «Load unpacked» → `dist/apps/extension`.
  3. Copia el ID y pon en `.env`: `EXTENSION_CORS_ORIGINS=chrome-extension://<id>` → reinicia `pnpm nx serve api`.
  4. En la pestaña de una oferta, abre el popup → «Inicia sesión» con Ana → «Grupo (opcional)» → «Guardar».
- **Qué esperar:** «Guardado en LinkVault»; la oferta aparece en `/mis-links` o en el grupo elegido. Otra vez: «Ya lo
  tenías guardado aquí». «Cerrar sesión» en el popup.
- **Requiere:** api con `EXTENSION_CORS_ORIGINS`. `EXTENSION_API_BASE_URL` por defecto `http://localhost:3000`.

#### 43. Extensión para Firefox

- **Qué es:** la misma extensión como complemento temporal de Firefox (121 o superior).
- **Dónde:** igual que la de Chromium.
- **Cómo probarla:**
  1. `pnpm nx run extension:build-firefox` (sale en `dist/apps/extension-firefox/`); opcional
     `pnpm nx run extension:lint-firefox`.
  2. `about:debugging` → «This Firefox» → «Load Temporary Add-on…» → `dist/apps/extension-firefox/manifest.json`.
  3. Copia el `Origin` `moz-extension://<uuid>` y añádelo a `EXTENSION_CORS_ORIGINS` (separado por coma) → reinicia la
     API. El UUID cambia en cada carga temporal.
  4. Mismos pasos que en Chromium.
- **Qué esperar:** lo mismo que en Chromium.
- **Requiere:** Firefox ≥ 121.

### Salida y operación

#### 44. Borrar la cuenta

- **Qué es:** eliminar la cuenta y todos los datos personales.
- **Dónde:** `/perfil`, «Zona de peligro» → «Borrar mi cuenta» · `DELETE /api/users/me`.
- **Cómo probarla:** con una cuenta de prueba (no Ana): «Borrar mi cuenta» → «Contraseña actual» → «Borrar cuenta».
- **Qué esperar:** vuelves a `/login` y esa cuenta ya no entra. Si eres el único owner de un grupo con más miembros:
  «Eres el único propietario de un grupo con otros miembros…».
- **Requiere:** api, worker (borra los archivos de CV).

#### 45. Salud y métricas

- **Qué es:** comprobaciones de vida y métricas Prometheus.
- **Dónde:** `GET /health`, `GET /health/live`, `GET /metrics` (api en 3000, worker en 3001; fuera de `/api`).
- **Cómo probarla:** `curl -i http://localhost:3000/health`, `curl http://localhost:3001/metrics`. Para ver el `503`,
  `docker compose stop redis` y repite; luego `docker compose start redis`.
- **Qué esperar:** `/health` en `200` con Mongo y Redis arriba y `503` si falta alguno; `/metrics` en texto Prometheus.
- **Requiere:** nada más.

#### 46. Reencolar lecturas pendientes o fallidas

- **Qué es:** volver a pedir la lectura de links que se quedaron sin leer.
- **Dónde:** CLI de api (escribe en el outbox; lo publica la api en marcha).
- **Cómo probarla:**

```bash
pnpm nx run api:backfill-enrichment --limit=200
pnpm nx run api:backfill-enrichment --status=failed --limit=50
```

- **Qué esperar:** imprime cuántos links pidió de cuántos encontró; nunca reintenta `robots_disallowed`, `blocked` ni
  `not_a_job`.
- **Requiere:** api y worker en marcha.

## No encontrado en el código

Lo que una spec vigente promete y el código de `main` no hace:

| Spec | Qué promete | Qué hay en el código |
| ---- | ----------- | -------------------- |
| `openspec/specs/web/discovery/spec.md`, «Página /descubrir» | Copy con el **destino actual** y confirmación de creado al guardar en un grupo. | La confirmación es fija: «Guardada en «Solo para mí».» (`apps/web/src/app/features/discovery/discovery.page.html:216`), también cuando se guarda en un grupo. |
| `openspec/specs/web/*/spec.md`, requisitos «Textos en español e inglés» / «i18n ES/EN» y `web/i18n` | Textos traducidos al inglés. | El catálogo `messages.en.xlf` está completo, pero `apps/web/project.json` no tiene opción `localize` ni configuración `en`: en local no hay forma de ver la interfaz en inglés (ADR-050 deja pendiente publicarla). |

## Hallazgos en la documentación

- `docs/demo.md:9` pide `AI_MOCK_MODE=replay` para la demo. Con `replay`, las entradas nuevas sin fixture lanzan
  `FixtureMissing`: el pegado, el encaje y el plan de estudio no sirven con datos propios. Este catálogo usa `synth`,
  el valor de `.env.example` y el que fija CLAUDE.md para desarrollo.
- `docs/demo.md:26-27` condiciona «Reabrir» a que el PR `job-link-reopen` (#47) esté en `main`; ya lo está (change
  archivado `2026-09-23-job-link-reopen`).
- `docs/demo.md:31` dice «skip si el seed omitió CV»: aunque el seed no lo omita, su CV es un PDF sin texto y no sirve
  para el encaje; siempre hay que subir uno real.

## Tabla de control

| # | Funcionalidad | Ruta/endpoint | Requiere | Probado |
| - | ------------- | ------------- | -------- | ------- |
| 1 | Crear una cuenta | `/registro` · `POST /api/auth/register` | api, web | [ ] |
| 2 | Verificar el email | `/verificar-email` · `POST /api/auth/verify-email` | Mailpit | [ ] |
| 3 | Iniciar y cerrar sesión | `/login` · `POST /api/auth/login` | api, web | [ ] |
| 4 | Recuperar la contraseña | `/recuperar-contrasena` · `POST /api/auth/reset-password` | Mailpit | [ ] |
| 5 | Perfil: nombre y contraseña | `/perfil` · `POST /api/auth/password` | api | [ ] |
| 6 | Aviso de privacidad | `/privacidad` | web | [ ] |
| 7 | Crear un grupo | `/grupos` · `POST /api/groups` | api | [ ] |
| 8 | Invitar y unirse | `/unirse` · `POST /api/groups/join` | dos cuentas | [ ] |
| 9 | Administrar el grupo | `/grupos/:id` · `POST /api/groups/:id/owner` | dos cuentas | [ ] |
| 10 | Guardar una oferta en un grupo | `/grupos/:id` · `POST /api/links` | api, worker | [ ] |
| 11 | Solo para mí | `/mis-links` · `GET /api/links/mine` | api | [ ] |
| 12 | Importar un chat | `POST /api/links/import` | api, worker | [ ] |
| 13 | Lectura automática y avisos en vivo | `GET /api/events` · `POST /api/links/:linkId/enrich` | worker, red | [ ] |
| 14 | Corregir a mano | `PATCH /api/links/:linkId/preview` | api | [ ] |
| 15 | Pegar la descripción | `POST /api/links/:linkId/pasted` | IA `synth` | [ ] |
| 16 | Quitar una oferta del grupo | `DELETE /api/groups/:id/links/:linkId` | api | [ ] |
| 17 | Comentarios y nota | `POST /api/groups/:id/links/:linkId/comments` | dos cuentas | [ ] |
| 18 | Conozco a alguien ahí | `PUT /api/groups/:id/links/:linkId/know-someone` | demo | [ ] |
| 19 | Fijar, etiquetar y filtrar | `PUT /api/groups/:id/links/:linkId/tags` | api | [ ] |
| 20 | Enlace público | `/oferta/:slug` · `GET /p/:slug` | api, web | [ ] |
| 21 | Guardar desde enlace público | `/mis-links?import=…` | enlace público | [ ] |
| 22 | Oferta cerrada y reabrir | `POST /api/links/:linkId/reopen` | demo | [ ] |
| 23 | Frescura de vacantes | worker | `FEATURE_LINK_FRESHNESS` | [ ] |
| 24 | Seguir una oferta | `POST /api/applications` | api | [ ] |
| 25 | Compartir mi estado con el grupo | `GET /api/groups/:id/applications` | dos cuentas | [ ] |
| 26 | Tablero de postulaciones | `/postulaciones` · `PATCH /api/applications/:id/status` | api | [ ] |
| 27 | Dejar de seguir | `DELETE /api/applications/:id` | api | [ ] |
| 28 | Insights de postulaciones | `/postulaciones/insights` · `GET /api/applications/analytics` | demo | [ ] |
| 29 | Mi CV | `/mi-cv` · `POST /api/cv` | worker, MinIO | [ ] |
| 30 | Permiso de IA, idioma y nombre | `/perfil` · `PATCH /api/users/me` | api | [ ] |
| 31 | Analizar mi encaje | `POST /api/links/:linkId/match` | CV real, IA `synth` | [ ] |
| 32 | Sugerencias y «No me convence» | `POST /api/analyses/:analysisId/suggestion-feedback` | IA `synth` | [ ] |
| 33 | Plan de estudio | `/plan/:analysisId` · `GET /api/analyses/:analysisId/roadmap.md` | IA `synth` | [ ] |
| 34 | Claves de IA propias | `PUT /api/users/me/ai-keys/:vendor` | `AI_VAULT_KEY` | [ ] |
| 35 | Buscar | `/buscar` · `GET /api/search` | `FEATURE_SEARCH`, perfil `demo` | [ ] |
| 36 | Salario leído del texto | CLI `api:backfill-salary-parse` | `FEATURE_SEARCH` | [ ] |
| 37 | Descubrir vacantes | `/descubrir` · `GET /api/discovery/search` | `FEATURE_DISCOVERY` | [ ] |
| 38 | Preferencias de notificaciones | `/notificaciones` · `PATCH /api/notifications/preferences` | api | [ ] |
| 39 | Avisos por email | worker | Mailpit, email verificado | [ ] |
| 40 | Push del navegador | `POST /api/notifications/push-subscriptions` | VAPID | [ ] |
| 41 | Resumen semanal del grupo | worker | `FEATURE_GROUP_DIGEST` | [ ] |
| 42 | Extensión Chromium | `POST /api/auth/extension/login` | `EXTENSION_CORS_ORIGINS` | [ ] |
| 43 | Extensión Firefox | `POST /api/auth/extension/refresh` | Firefox ≥ 121 | [ ] |
| 44 | Borrar la cuenta | `/perfil` · `DELETE /api/users/me` | cuenta de prueba | [ ] |
| 45 | Salud y métricas | `GET /health` · `GET /metrics` | — | [ ] |
| 46 | Reencolar lecturas | CLI `api:backfill-enrichment` | api, worker | [ ] |
