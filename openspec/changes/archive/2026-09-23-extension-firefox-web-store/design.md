## Context

See `proposal.md`. Hoy: un build Chromium MV3 (`service_worker` + `type: module`),
CORS documentado solo para `chrome-extension://`, RUNBOOK unpacked Chromium.

## Goals / Non-Goals

**Goals:** artefacto Firefox cargable en `about:debugging` + allowlist
`moz-extension://` + checklist tiendas (docs; listing live fuera del DoD).

**Non-Goals:** submit automático; Safari; reescritura del popup; exigir AMO/CWS
aprobado para cerrar el change (V1 business).

## Decisions

### D1 — Un codebase, dos outDir

- `nx run extension:build` → `dist/apps/extension` (Chromium).
- `nx run extension:build-firefox` → `dist/apps/extension-firefox`.
- Misma lógica TS; Vite mode/`EXTENSION_TARGET=firefox` selecciona outDir +
  manifest Firefox. `emptyOutDir` solo limpia el outDir del target activo.

### D2 — Background Firefox = service_worker módulo (FF ≥ 121)

Firefox 121+ soporta `background.service_worker` + `type: "module"`. Manifest
Firefox añade:

```json
"browser_specific_settings": {
  "gecko": {
    "id": "linkvault@linkvault.app",
    "strict_min_version": "121.0"
  }
}
```

Sin scripts legacy ni IIFE obligatorio. Verify: script
`apps/extension/scripts/lint-firefox-manifest.mjs` (contrato FF ≥ 121;
`web-ext` 8.x aún marca `service_worker` como unsupported en su schema local —
AMO online al publicar) + criterio documentado de smoke `about:debugging` →
Load Temporary Add-on → `manifest.json`.

### D3 — API surface: thin wrapper

Thin `browserApi` = `globalThis.browser ?? globalThis.chrome` (promise APIs).
Sin `webextension-polyfill` salvo que lint/runtime lo exija. Tipado en
`chrome.d.ts` / alias. Tests unitarios no dependen del host real.

### D4 — CORS

`EXTENSION_CORS_ORIGINS` CSV de `chrome-extension://…` **y**
`moz-extension://…`. Validación de esquema en boot (rechazo de otros esquemas).
Tests preflight chrome + moz. Default vacío = off.

### D5 — URL de API / tiendas

- Local/dev: `EXTENSION_API_BASE_URL` default `http://localhost:3000`.
- Builds de **tienda** (checklist): MUST setear `EXTENSION_API_BASE_URL` a la
  URL de producción antes de zippear; documentado en RUNBOOK. CI no publica.

### D6 — Plan / ADR

Fila **33**. **ADR-047** enmienda ADR-038 (CORS multi-browser + FF packaging).

### D7 — Capabilities

No se modifica `extension/save-link` como delta aparte: paridad Guardar queda
bajo `extension/firefox-packaging`.

## Risks / Trade-offs

- [UUID temporal Firefox cambia en cada temporary install] → RUNBOOK: re-copiar
  Origin a `EXTENSION_CORS_ORIGINS` tras cada load; gecko id estable ayuda en
  signed builds.
- [FF < 121] → `strict_min_version` 121; fuera de soporte v1.

## Migration Plan

Deploy API (CORS schema + allowlist) antes o junto al zip Firefox. Rollback:
quitar orígenes moz / revertir schema refine.
