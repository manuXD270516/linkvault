## Purpose

Empaquetar y documentar la extensión LinkVault para Firefox MV3 y permitir
orígenes `moz-extension://` en la allowlist CORS de la API.

## ADDED Requirements

### Requirement: Build Firefox MV3

El monorepo SHALL exponer `extension:build-firefox` (o equivalente) que produzca
`dist/apps/extension-firefox` cargable en Firefox ≥ 121 vía `about:debugging`
(Load Temporary Add-on). Manifest V3 SHALL declarar `background.service_worker`
con `type: "module"`, `browser_specific_settings.gecko.id` estable
(`linkvault@linkvault.app`), `strict_min_version` ≥ `121.0`, popup Guardar y
`host_permissions` al origen de `EXTENSION_API_BASE_URL`. Paridad funcional
mínima: login extensión, Guardar privado por defecto, selector de grupo si el
usuario tiene grupos. El outDir Chromium (`dist/apps/extension`) SHALL permanecer
independiente (no colisión al construir ambos).

#### Scenario: Artefacto Firefox

- **GIVEN** el workspace en CI o local
- **WHEN** se ejecuta el target de build Firefox
- **THEN** SHALL existir `dist/apps/extension-firefox/manifest.json` con gecko id
  y background service_worker
- **AND** el script `lint-firefox` (contrato FF ≥ 121) SHALL pasar sobre ese outDir

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
