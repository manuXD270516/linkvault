## Purpose

Empaquetar y documentar la extensión LinkVault para Firefox MV3 y permitir
orígenes `moz-extension://` en la allowlist CORS de la API.

## Requirements

### Requirement: Build Firefox MV3

El monorepo SHALL exponer `extension:build-firefox` (o equivalente) que produzca
`dist/apps/extension-firefox` cargable en Firefox ≥ 121 vía `about:debugging`
(Load Temporary Add-on). Manifest V3 de Firefox SHALL declarar `background.scripts`
igual a `["background.js"]` junto con `background.service_worker` `"background.js"` y
`type: "module"`, porque Firefox no admite `background.service_worker` en MV3 (MDN,
`manifest.json/background`; bug 1573659): solo arranca el fondo como event page desde
`scripts`, y `type: "module"` permite que `background.js` importe los chunks compartidos.
Además SHALL declarar `browser_specific_settings.gecko.id` estable
(`linkvault@linkvault.app`), `strict_min_version` ≥ `121.0`, popup Guardar y
`host_permissions` al origen de `EXTENSION_API_BASE_URL`. El manifiesto de Chromium
(`dist/apps/extension`) SHALL seguir declarando solo `background.service_worker` con
`type: "module"`, sin `background.scripts`. Paridad funcional
mínima: login extensión, Guardar privado por defecto, selector de grupo si el
usuario tiene grupos. El outDir Chromium (`dist/apps/extension`) SHALL permanecer
independiente (no colisión al construir ambos).

#### Scenario: Artefacto Firefox

- **GIVEN** el workspace en CI o local
- **WHEN** se ejecuta el target de build Firefox
- **THEN** SHALL existir `dist/apps/extension-firefox/manifest.json` con gecko id
  y `background` igual a `{ scripts: ["background.js"], service_worker: "background.js", type: "module" }`
- **AND** el script `lint-firefox` (contrato FF ≥ 121) SHALL pasar sobre ese outDir

#### Scenario: Lint rechaza un fondo que Firefox no arranca

- **GIVEN** un `dist/apps/extension-firefox/manifest.json` cuyo `background` declara
  `service_worker` y `type: "module"` pero no `scripts`
- **WHEN** se ejecuta `extension:lint-firefox`
- **THEN** SHALL terminar con código distinto de cero y un mensaje que nombra `background.scripts`

#### Scenario: Chromium sin scripts de fondo

- **WHEN** se construye el manifiesto para el destino Chromium
- **THEN** `background` SHALL ser `{ service_worker: "background.js", type: "module" }`
- **AND** SHALL NOT contener la clave `scripts`

#### Scenario: El contrato del manifiesto corre en CI

- **GIVEN** la función que compone el manifiesto a partir de `manifest.template.json`
- **WHEN** se ejecuta `extension:test`
- **THEN** un test SHALL fallar si el manifiesto de Firefox no declara `background.scripts`
  igual a `["background.js"]` con `type: "module"`, o si el de Chromium declara `scripts`

#### Scenario: OutDir separado

- **WHEN** se ejecutan build Chromium y build Firefox en secuencia
- **THEN** ambos artefactos SHALL coexistir en outDirs distintos

### Requirement: Docs de tienda

RUNBOOK (o docs/extension) SHALL documentar checklist manual para Chrome Web
Store y AMO (empaquetado del outDir correcto, `EXTENSION_API_BASE_URL` de
producción para builds de tienda, privacidad, capturas). NO SHALL requerir
publicar desde CI ni listing live aprobado para dar el change por cerrado.

#### Scenario: Checklist presente

- **WHEN** un desarrollador abre el RUNBOOK de extensión
- **THEN** SHALL encontrar pasos para CWS y AMO y la nota de URL de API prod
