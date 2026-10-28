## Purpose

Define qué cabeceras de seguridad sirve cada superficie pública de LinkVault —el SPA, la API, la página pública y el
borde TLS—, dónde vive cada una y cómo se comprueba que siguen ahí y que la política de contenido no rompe ninguna
ruta del SPA. Protege el access token en memoria frente a scripts inyectados (ADR-012), las acciones de un clic frente al
encuadre desde otro origen y la primera visita frente a la degradación a HTTP (ADR-057).

## ADDED Requirements

### Requirement: El borde exige HTTPS con HSTS en todas las rutas públicas

Toda respuesta que el borde (Traefik) sirva por el punto de entrada HTTPS —SPA, API y página pública `/p/:slug`— SHALL
llevar `Strict-Transport-Security` con `max-age` de al menos `604800` (siete días) e `includeSubDomains`, y SHALL NOT
llevar `preload`. La única excepción es una vuelta atrás con `max-age=0`, que SHALL declararse con una línea de
excepción fechada en la configuración del borde. La cabecera SHALL añadirla el borde, y la API SHALL NOT emitirla. Añadirla SHALL NOT cambiar las reglas, las
prioridades ni los servicios de los routers, ni quitar `Referrer-Policy` de las rutas del SPA.

#### Scenario: El SPA, la API y la página pública llevan HSTS

- **GIVEN** la pila de producción desplegada con un certificado válido
- **WHEN** se piden por HTTPS `/unirse`, una ruta bajo `/api/` y una bajo `/p/`
- **THEN** las tres respuestas SHALL llevar `Strict-Transport-Security` con `max-age=604800` e `includeSubDomains`
- **AND** ninguna SHALL llevar `preload`

#### Scenario: La API no emite HSTS por su cuenta

- **WHEN** se pide a la API una ruta cualquiera directamente, sin pasar por el borde
- **THEN** la respuesta SHALL NOT llevar `Strict-Transport-Security`

#### Scenario: Un router nuevo sin HSTS no pasa las comprobaciones del repositorio

- **GIVEN** la configuración dinámica del borde con un router de HTTPS que no lista el middleware de HSTS
- **WHEN** se ejecutan las comprobaciones del repositorio
- **THEN** SHALL fallar nombrando ese router

#### Scenario: Una vuelta atrás de HSTS sin excepción fechada no pasa las comprobaciones del repositorio

- **GIVEN** la configuración dinámica del borde con el middleware de HSTS en `max-age` 0
- **WHEN** se ejecutan las comprobaciones del repositorio sin una línea `# hsts-rollback: AAAA-MM-DD <motivo>`
- **THEN** SHALL fallar nombrando el middleware
- **AND** con esa línea presente SHALL pasar

### Requirement: El SPA se sirve con una política de seguridad de contenido aplicada

Las respuestas del SPA SHALL llevar `Content-Security-Policy` (aplicada, no `-Report-Only`, salvo una vuelta atrás
declarada con una línea de excepción fechada en la configuración del servidor de `web`) con, al menos:
`default-src 'self'`, `script-src 'self'` sin `'unsafe-inline'`, `'unsafe-eval'`, `data:`, `blob:` ni orígenes
externos, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` y `connect-src`,
`img-src`, `font-src` y `worker-src` limitados a `'self'`. La política SHALL declararse una sola vez, en la
configuración del servidor de la imagen `web`. El build de producción del SPA SHALL NOT contener scripts ni
manejadores de eventos en línea, y el SPA SHALL NOT evaluar código en tiempo de ejecución.

#### Scenario: Un script inyectado no se ejecuta

- **GIVEN** el SPA servido con su política
- **WHEN** una página del SPA recibe un `<script>` en línea o un atributo `onerror` inyectado
- **THEN** el navegador SHALL bloquearlo
- **AND** el access token en memoria SHALL NOT quedar al alcance de ese código

#### Scenario: El SPA carga con estilos bajo la política

- **GIVEN** el build de producción del SPA servido con su política
- **WHEN** una persona abre `/login`
- **THEN** la hoja de estilos SHALL aplicarse
- **AND** el documento SHALL NOT contener ningún atributo `onload` ni ningún `<script>` sin `src`

#### Scenario: Validar con zod no viola la política

- **GIVEN** el SPA servido con su política
- **WHEN** el SPA valida la respuesta de la API con un esquema de zod
- **THEN** SHALL NOT producirse ninguna violación de `script-src`

#### Scenario: Una política que admite script en línea no pasa las comprobaciones del repositorio

- **GIVEN** la configuración de `web` con `'unsafe-inline'` en `script-src`
- **WHEN** se ejecutan las comprobaciones del repositorio
- **THEN** SHALL fallar nombrando la directiva

#### Scenario: Una política en Report-Only sin excepción fechada no pasa las comprobaciones del repositorio

- **GIVEN** la configuración de `web` con la política como `Content-Security-Policy-Report-Only`
- **WHEN** se ejecutan las comprobaciones del repositorio sin una línea `# csp-report-only: AAAA-MM-DD <motivo>`
- **THEN** SHALL fallar nombrando la cabecera
- **AND** con esa línea presente SHALL pasar

### Requirement: Ninguna página de LinkVault se puede encuadrar desde otro origen

Las respuestas del SPA y de la API, incluida la página pública `/p/:slug`, SHALL llevar `frame-ancestors 'none'` en su
`Content-Security-Policy` y `X-Frame-Options: DENY`.

#### Scenario: Unirse a un grupo no se puede encuadrar

- **GIVEN** una página de otro origen que pone `/unirse?codigo=<código>` en un `iframe`
- **WHEN** el navegador la carga
- **THEN** el navegador SHALL negarse a mostrar LinkVault dentro del `iframe`

#### Scenario: La página pública tampoco se encuadra

- **WHEN** se pide `/p/<slug>`
- **THEN** la respuesta SHALL llevar `frame-ancestors 'none'` y `X-Frame-Options: DENY`

### Requirement: El SPA restringe permisos del navegador y aísla su ventana

Las respuestas del SPA SHALL llevar `Permissions-Policy` que deshabilite al menos `accelerometer`, `camera`,
`geolocation`, `gyroscope`, `magnetometer`, `microphone`, `payment`, `usb` y `browsing-topics`, sin deshabilitar
`clipboard-write`, y `Cross-Origin-Opener-Policy: same-origin`.

#### Scenario: Copiar la invitación sigue funcionando

- **GIVEN** el SPA servido con su `Permissions-Policy`
- **WHEN** la propietaria de un grupo pulsa «Copiar invitación»
- **THEN** el enlace SHALL quedar en el portapapeles

#### Scenario: El SPA no pide cámara ni ubicación

- **WHEN** un script del origen del SPA pide la cámara o la geolocalización
- **THEN** el navegador SHALL denegarlo sin preguntar

### Requirement: Las cabeceras del SPA están en todas las respuestas de web

El servidor de la imagen `web` SHALL emitir las cabeceras de seguridad del SPA —`Content-Security-Policy`,
`X-Frame-Options`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` y
`Cross-Origin-Opener-Policy`— en toda respuesta, incluidas `index.html`, el fallback de rutas del SPA, los ficheros
estáticos, `sw.js` y las respuestas de error. Las políticas de caché por tipo de fichero SHALL conservar sus valores en
las respuestas correctas, cada respuesta SHALL llevar como mucho una cabecera `Cache-Control`, y una respuesta de error
SHALL NOT llevar `immutable`.

#### Scenario: El documento y los estáticos llevan nosniff

- **WHEN** se piden `/`, `/index.html`, `/grupos/x` (fallback), un `.js` con hash y `/sw.js`
- **THEN** las cinco respuestas SHALL llevar las seis cabeceras de seguridad del SPA

#### Scenario: Un recurso inexistente también las lleva

- **WHEN** se pide un `.png` que no existe
- **THEN** la respuesta de error SHALL llevar las seis cabeceras de seguridad del SPA

#### Scenario: La caché no cambia

- **WHEN** se piden `/index.html` y un `.js` con hash
- **THEN** `index.html` SHALL llevar `Cache-Control: no-cache`
- **AND** el `.js` SHALL llevar `Cache-Control` público, inmutable y de siete días

#### Scenario: Un recurso inexistente no se cachea como inmutable

- **WHEN** se pide un `.png` que no existe
- **THEN** la respuesta de error SHALL NOT llevar `immutable`
- **AND** SHALL NOT llevar más de una cabecera `Cache-Control`

#### Scenario: Una cabecera dentro de un location no pasa las comprobaciones del repositorio

- **GIVEN** la configuración de `web` con un `add_header` dentro de un bloque `location`
- **WHEN** se ejecutan las comprobaciones del repositorio
- **THEN** SHALL fallar nombrando el `location`

### Requirement: La API añade cabeceras de seguridad por defecto sin pisar las de cada ruta

Toda respuesta de la API que pase por su ciclo normal de respuesta —éxitos, errores de validación, rechazos del filtro
CSRF de auth, rutas inexistentes, límites de peticiones y preflight CORS— SHALL llevar `X-Content-Type-Options:
nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` y `Content-Security-Policy: default-src 'none';
frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. Una cabecera que la ruta ya haya puesto SHALL conservar el
valor de la ruta. El flujo de eventos en tiempo real SHALL llevar al menos `X-Content-Type-Options: nosniff`.

#### Scenario: Una respuesta JSON lleva las cabeceras

- **WHEN** una persona autenticada pide `GET /api/groups`
- **THEN** la respuesta SHALL llevar las cuatro cabeceras de seguridad de la API

#### Scenario: Los errores también las llevan

- **WHEN** se pide una ruta inexistente bajo `/api/`, o un `POST /api/auth/login` sin la cabecera CSRF
- **THEN** la respuesta `404` o `403` SHALL llevar las cuatro cabeceras de seguridad de la API

#### Scenario: La página pública conserva su política

- **WHEN** se pide `/p/<slug>` de un link publicado
- **THEN** la respuesta SHALL llevar la `Content-Security-Policy` y la `Referrer-Policy` de la página pública, sin cambios
- **AND** SHALL llevar `X-Frame-Options: DENY`

#### Scenario: El flujo de eventos lleva nosniff

- **WHEN** una persona autenticada abre el flujo de eventos en tiempo real
- **THEN** la cabecera del flujo SHALL llevar `X-Content-Type-Options: nosniff`

### Requirement: Ninguna ruta del SPA produce violaciones de la política

Con el build de producción y la `Content-Security-Policy` y la `Permissions-Policy` de la imagen `web`, recorrer
cualquier ruta del SPA —en escritorio y en móvil— SHALL NOT producir ninguna violación de la política de contenido ni
ningún error de `Permissions-Policy` en la consola, y el service worker SHALL registrarse.

#### Scenario: El recorrido de todas las rutas no produce violaciones

- **GIVEN** el build de producción del SPA con la política de la imagen `web` aplicada a cada documento
- **WHEN** se visita cada ruta del SPA y se abre su diálogo o menú principal, en escritorio y en móvil emulado
- **THEN** SHALL NOT registrarse ninguna violación de la política
- **AND** la consola SHALL NOT mostrar ningún error de `Permissions-Policy`

#### Scenario: Activar las notificaciones registra el service worker

- **GIVEN** el SPA servido con su política y el permiso de notificaciones concedido
- **WHEN** una persona activa las notificaciones
- **THEN** `sw.js` SHALL quedar registrado sin ninguna violación de la política

#### Scenario: El camino crítico en staging no produce violaciones

- **GIVEN** staging sirviendo un commit con estas cabeceras
- **WHEN** se recorre a mano el camino crítico en Chromium y en Firefox con la consola abierta
- **THEN** SHALL NOT aparecer ningún mensaje de la política de contenido ni de `Permissions-Policy`
