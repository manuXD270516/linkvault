## Why

Tras F2 (notificaciones), freshness y filtros LatAm, el loop diario del grupo está cubierto; lo que falta
es **retención**: mucha gente no abre la app cada día y pierde links nuevos del grupo. B10 (design-v0.2)
pide un digest semanal por email, explícitamente diferido hasta tener Mailer + prefs (ADR-034/035).

## What Changes

- **Digest semanal por grupo**: cron en worker agrega actividad reciente (links nuevos compartidos al
  grupo en la ventana) y envía **un email por (miembro elegible × grupo)** con resumen corto + CTA.
- **Tipo de preferencia** `group_weekly_digest` (opt-out, default ON) en API + SPA de prefs.
- **Solo email** (no push); exige `emailVerified`; reutiliza Mailer y ledger de entregas.
- **Flag** `FEATURE_GROUP_DIGEST` (default off en prod hasta checklist; on en local/dev).
- Fila **21** en `docs/design-v0.2.md` §6 + `openspec-changes.yaml`; **enmienda ADR-035** (digest deja
  de estar “fuera”).

**Fuera de alcance:**

- Push / SMS / feed in-app; digest personal (no de grupo); marketing cross-grupo; IA que redacte el
  cuerpo; digests diarios; incluir stageLabel/notas/historial de postulaciones ajenas.

## Capabilities

### New Capabilities

- `notifications/group-digest`: ventana, agregación, cron, plantilla, idempotencia semanal.

### Modified Capabilities

- `notifications/preferences`: nuevo tipo `group_weekly_digest`.
- `notifications/dispatch`: `group_weekly_digest` **solo email** (excepción al dual email+push).
- `web/notifications`: toggle + enlace desde el pie del digest.
- `platform/local-environment` (si aplica): documentar flag/cron.

## Impact

- **Código:** shared schemas; notifications prefs/dispatch; worker cron + aggregator; plantilla email;
  SPA prefs; ADR-035 enmienda; §6.
- **Agentes:** backend-dev, frontend-dev, devops (env/flag).
- **Dependencias:** Mailer (ADR-034), notifications (ADR-035), groups/links en main.
