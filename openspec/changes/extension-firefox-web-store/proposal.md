## Why

La extensión Chromium (fila 24) ya captura con un clic, pero Firefox y la
distribución vía tienda quedan fuera: load-unpacked no escala y usuarios
Firefox siguen en paste/SPA.

## What Changes

- Build/empaquetado **Firefox** (MV3, FF ≥ 121) reusando `apps/extension`, outDir
  separado, `browser_specific_settings.gecko`.
- Allowlist CORS: aceptar orígenes `moz-extension://…` además de
  `chrome-extension://…`; validar esquema en boot (ADR-047 enmienda ADR-038).
- Checklist + docs RUNBOOK para Chrome Web Store y AMO (publicación manual;
  listing live fuera del Definition of Done).
- Paridad Guardar: privado default + picker de grupo (mismo código).
- Plan §6 fila **33**.

**Fuera de alcance:**

- Safari; scraping content-script; CI de publicación automática a tiendas;
  exigir aprobación AMO/CWS para cerrar el change.
- Funnel grupo / tag index / pin-to-top.
- Cambios de auth extension (ADR-038 sigue).

## Capabilities

### New Capabilities

- `extension/firefox-packaging`: build Firefox + docs de tienda.

### Modified Capabilities

- `platform/local-environment`: CORS chrome+moz, docs unpacked ambos browsers,
  validación de esquema.

## Impact

- **Código:** extension build targets; api CORS parse; docs/ADR-047.
- **Agentes:** devops, frontend-dev, backend-dev (CORS).
- **Dependencias:** browser-extension en main.
