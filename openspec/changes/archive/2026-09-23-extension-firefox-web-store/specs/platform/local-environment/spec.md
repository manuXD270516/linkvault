## MODIFIED Requirements

### Requirement: CORS y origen de la extensión en local

El entorno local documentado SHALL permitir configurar allowlist de orígenes
`chrome-extension://<extension-id>` y/o `moz-extension://<uuid>` (variable
`EXTENSION_CORS_ORIGINS` en `.env.example`) para que la API acepte peticiones
CORS preflight/simple desde la extensión unpacked (Chromium o Firefox). El
README o RUNBOOK SHALL documentar cómo cargar el build unpacked en Chrome y en
Firefox (`about:debugging`) y cómo obtener el extension id / UUID de origen
(p. ej. `chrome.runtime.id` / inspeccionar Origin en DevTools, o el UUID
temporal de Firefox temporary add-on).

La configuración de la API SHALL aceptar **solo** orígenes con esquema
`chrome-extension:` o `moz-extension:`; cualquier otro esquema en el CSV SHALL
fallar al boot.

#### Scenario: Variable documentada

- **WHEN** un desarrollador abre `.env.example`
- **THEN** SHALL existir la variable de allowlist CORS de extensión documentada
  mencionando Chromium y Firefox
- **AND** la guía local SHALL indicar pasos para cargar el build unpacked y
  obtener el id/UUID en ambos navegadores

#### Scenario: moz-extension allowlisted

- **GIVEN** `EXTENSION_CORS_ORIGINS` incluye un `moz-extension://<id>`
- **WHEN** llega un preflight `Origin` igual
- **THEN** la respuesta SHALL incluir `Access-Control-Allow-Origin` con ese
  origen

#### Scenario: Esquema inválido rechazado

- **GIVEN** `EXTENSION_CORS_ORIGINS` incluye un origen `https://evil.example`
- **WHEN** arranca la API
- **THEN** la carga de config SHALL fallar
