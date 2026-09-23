## Purpose

Permite guardar la URL de la pestaña activa en LinkVault desde una extensión Chromium MV3,
con login propio y sin scrapear el DOM de la bolsa.

## ADDED Requirements

### Requirement: Guardar URL de la pestaña activa

La extensión SHALL obtener la URL de la pestaña activa del navegador y SHALL llamar a
`POST /api/links` con `{ url }` o `{ url, groupId }` usando el access token de la sesión de
extensión. El destino por defecto SHALL ser **lista privada** (sin `groupId`). Un único CTA
primario «Guardar» SHALL disparar el guardado con el destino actual (privado salvo que el
usuario haya elegido un grupo). Ante `201`, SHALL mostrar si el link es nuevo o
`already_there` / ya en otros grupos según el cuerpo de respuesta existente, **sin** afirmar
que el preview enriquecido está listo (el enrichment puede degradar, p. ej. LinkedIn). Ante
error de red o `4xx`/`5xx`, SHALL mostrar un mensaje de error sin inventar éxito.

#### Scenario: Un click guarda en privado

- **GIVEN** una sesión de extensión válida y una pestaña con URL `https://www.linkedin.com/jobs/view/123`
- **WHEN** el usuario pulsa el CTA «Guardar» sin haber cambiado el destino
- **THEN** la extensión SHALL enviar `POST /api/links` con esa `url` y sin `groupId`
- **AND** ante `201` SHALL indicar que el link quedó guardado (sin prometer JobPreview rico)

#### Scenario: Guardar en un grupo

- **GIVEN** una sesión válida y al menos un grupo del que el usuario es miembro
- **WHEN** el usuario elige un grupo y pulsa «Guardar»
- **THEN** la petición SHALL incluir ese `groupId`
- **AND** ante `201` con `shared` `already_there` SHALL indicarlo de forma distinta a un alta nueva

#### Scenario: Sin sesión

- **GIVEN** no hay sesión de extensión
- **WHEN** el usuario intenta guardar
- **THEN** la extensión NO SHALL llamar a `POST /api/links`
- **AND** SHALL pedir login

### Requirement: Popup mínimo y permisos

La extensión SHALL usar Manifest V3. SHALL solicitar solo los permisos necesarios para leer la
URL de la pestaña activa y hablar con el origen de la API configurado. NO SHALL inyectar content
scripts que lean el DOM de portales de empleo en esta versión. El popup SHALL permitir login,
logout, ver la URL candidata, destino por defecto privado con selector opcional de grupo, y el
CTA de guardado. Todas las llamadas a `/api/auth/extension/*` SHALL enviar
`X-Requested-With: linkvault`.

#### Scenario: Sin content script de scraping

- **WHEN** se inspecciona el empaquetado de la extensión v1
- **THEN** NO SHALL haber content script que extraiga título/empresa/salario del DOM de la bolsa

### Requirement: Lista de grupos para el selector

La extensión SHALL listar los grupos del usuario autenticado vía la API de membresía existente
para el selector de destino. Si la lista está vacía, SHALL ofrecer solo destino privado.

#### Scenario: Selector con grupos

- **GIVEN** sesión válida y al menos un grupo
- **WHEN** el usuario abre el selector de destino
- **THEN** la extensión SHALL mostrar esos grupos como destinos además de privado

#### Scenario: Sin grupos

- **GIVEN** sesión válida y cero grupos
- **WHEN** abre el selector
- **THEN** SHALL ofrecer solo destino privado

### Requirement: Configuración del origen API

La extensión SHALL usar un origen base de API configurable en desarrollo (p. ej. empaquetado
unpacked apuntando a `http://localhost:<port>`). En builds de producción SHALL apuntar al origen
documentado de la API de LinkVault. NO SHALL hardcodear secrets.

#### Scenario: Dev apunta a local

- **GIVEN** la extensión cargada unpacked en modo desarrollo
- **WHEN** el usuario guarda un link
- **THEN** la petición SHALL ir al origen local documentado en `platform/local-environment`

### Requirement: Refresh single-flight en el cliente

La extensión SHALL garantizar como máximo un refresh in-flight a la vez (mutex en service
worker o solo desde el popup). Ante `409` `refresh_conflict` SHALL aplicar la misma política
que el SPA (`web/auth`): hasta **3** reintentos con delays equivalentes a `delaysMs` del cliente
web. NO SHALL disparar refresh concurrente desde popup y background.

#### Scenario: Un solo refresh a la vez

- **GIVEN** access próximo a caducar
- **WHEN** dos acciones dispararían refresh a la vez
- **THEN** como máximo una petición `extension/refresh` SHALL estar en vuelo

#### Scenario: Tope de reintentos 409

- **GIVEN** la API responde `409` `refresh_conflict` de forma sostenida
- **WHEN** el cliente reintenta
- **THEN** SHALL detenerse tras como máximo 3 reintentos y pedir re-login si sigue fallando
