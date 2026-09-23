## Context

Ver proposal.md — Why. Hoy: access en memoria + refresh `lv_refresh` httpOnly `Path=/api/auth`
(ADR-012); CSRF `X-Requested-With` en todo `POST /api/auth/*`; sin CORS; `POST /api/links`
Bearer-only. La extensión no comparte origen ni cookie con la SPA.

## Goals / Non-Goals

**Goals:** Chromium MV3; auth extensión con refresh en body; CTA único + privado por defecto;
reuso `POST /api/links` + listado de grupos; CORS allowlist; fila 24 + ADR-038; tests API +
smoke unpacked documentado.

**Non-Goals:** content-script scraping; campo `note` en popup; Firefox; Web Store CI;
device-code; cambiar contrato de guardado web; dual-write de preview desde el DOM; recordar
último grupo / action sin popup (V1).

## Decisions

### D1 — App `apps/extension`

Paquete Nx `extension` (TypeScript, bundler liviano p. ej. esbuild/vite). Artefactos: `manifest.json`
MV3, `popup` (HTML/TS), service worker de background mínimo. Refresh **solo** vía un mutex
(single-flight) — no alarmas concurrentes con el popup. Sin content scripts en v1. i18n ES/EN.

**Alternativa:** carpeta suelta fuera de Nx → rechazada (rompe monorepo/CI).

### D2 — Auth dedicado `/api/auth/extension/*`

| Método | Ruta | Body / auth |
|---|---|---|
| POST | `/api/auth/extension/login` | email/password → access + refresh en JSON |
| POST | `/api/auth/extension/refresh` | `{ refreshToken }` → rotación |
| POST | `/api/auth/extension/logout` | `{ refreshToken }` → `204` |

Reutilizar dominio de sesiones (familia, hash, reuso 10s, TTLs). Campo `client: 'web' | 'extension'`;
sesiones existentes sin campo ≡ `web`. Refresh web **solo** cookie y solo `client=web`;
refresh extensión **solo** body y solo `client=extension`. Login extensión reusa el mismo
`Login` + `ATTEMPT_LIMITER` (contadores compartidos). Rutas públicas + CSRF como el resto de
`POST /api/auth/*` (delta `auth/sessions`).

SPA: sin cambio de cookie. Extensión: `chrome.storage.local` + cabecera `X-Requested-With: linkvault`.

### D3 — CORS allowlist (alcance honesto)

`EXTENSION_CORS_ORIGINS` (CSV). Métodos POST/GET/OPTIONS; headers `Authorization`,
`Content-Type`, `X-Requested-With`. Default vacío = CORS off. **ADR-038:** CORS acota orígenes
página/web; una extensión con `host_permissions` puede omitir CORS — la defensa real es auth +
límites + `client` + no loguear tokens.

### D4 — API base URL

Build-time `EXTENSION_API_BASE_URL`. Popup no usa cookies.

### D5 — UX guardado (V0)

Destino default **privado**; un CTA «Guardar»; selector de grupo opcional colapsado/secundario.
Copy de éxito: “Guardado en LinkVault” / `already_there`; **no** “preview listo”. Sin `note`.

### D6 — Plan / ADR

Fila **24** `browser-extension`. **ADR-038**: `client`, refresh body, CSRF, rate-limit
compartido, CORS alcance; nota de enmienda en ADR-012.

### D7 — Tests

- API: login sin Set-Cookie; CSRF 403; 429 compartido; refresh body; rechazo cruzado ambos
  sentidos; logout 204; revoke-all tras reset; `POST /api/links` con token extensión; CORS.
- Extensión: lógica pura + mutex refresh; smoke manual unpacked documentado.

## Risks / Trade-offs

- [Refresh en `chrome.storage.local`] → logout remoto; rotación; no loguear tokens.
- [Sobrevalorar CORS] → ADR-038 aclara; rate-limit + client isolation.
- [LinkedIn robots_disallowed] → copy no promete preview (spec save-link).
- [Doble refresh] → single-flight (D1).

## Migration Plan

Deploy API (endpoints + CORS + `client`). Luego build unpacked. Rollback: allowlist vacía;
rutas extensión 404/feature-off opcional.

## Open Questions

Ninguna.
