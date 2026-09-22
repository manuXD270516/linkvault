## 1. Contratos compartidos e infra

- [x] 1.1 [shared] Eventos `GroupLinkAdded.v1` y `ApplicationStatusNotify.v1` (status canónico + `groupId?`) + schemas zod/`jobId` fan-out; verificar tests shared.
- [ ] 1.2 [infra] `VAPID_*` en `.env.example` + RUNBOOK de generación; verificar las tres variables documentadas.
- [ ] 1.3 [infra] Plantillas Mailer `group-new-link`, `application-status`, `application-stale` ES/EN texto plano **sin** stageLabel/notas; verificar `mailer.spec`.

## 2. Preferencias y push (API)

- [ ] 2.1 [backend] Repo + use cases de preferencias (defaults ON, `notifyOwnActions`, `applicationStatusGroupId` nullable con validación de membresía); verificar unit tests.
- [ ] 2.2 [backend] HTTP GET/PATCH `/api/notifications/preferences`; verificar 200/401 y rechazo vía `/users/me`.
- [ ] 2.3 [backend] Subs push POST/DELETE-by-endpoint + GET vapid (`200` o `503`); verificar idempotencia y 401.
- [ ] 2.4 [backend] Cascada de cuenta borra prefs + subs + ledger de entregas; verificar cascade spec.

## 3. Despacho (worker)

- [ ] 3.1 [backend] Consumer único: expandir fan-out con membership **actual**, opt-out, `notifyOwnActions`, alcance D8; verificar unit tests.
- [ ] 3.2 [backend] Ledger `notification_deliveries` (claim antes de enviar); verificar que re-proceso no duplica envío.
- [ ] 3.3 [backend] WebPushSender VAPID + purge 410/404 por endpoint; verificar mock.
- [ ] 3.4 [backend] Entrega email (Mailer + `outputLanguage`) y push; fallo de un canal no bloquea el otro; verificar CapturingMailer.

## 4. Disparadores de producto

- [ ] 4.1 [backend] `POST /api/links` e **import**: relación nueva → outbox `GroupLinkAdded.v1` en la misma txn; verificar tests sharing/import + outbox.
- [ ] 4.2 [backend] Cambio de **status** canónico con `visibility=group` → outbox (`groupId?` validado link∈grupo∧miembro); stage-only y private no encolan; verificar applications specs.
- [ ] 4.3 [backend] Detector stale worker: `!isClosedStatus`, 10d, claim con lease + `Queue.add` (sin outbox) + aviso dueño; verificar tests detector/ledger.

## 5. Frontend

- [ ] 5.1 [frontend] UI preferencias (tipos, notifyOwnActions, selector opcional de `applicationStatusGroupId`) + i18n + enlace perfil; verificar tests.
- [ ] 5.2 [frontend] Service Worker + flujo push (VAPID, POST/DELETE endpoint); permiso denegado no bloquea email; verificar tests/harness.
- [ ] 5.3 [frontend] Al cambiar estado desde vista de grupo, enviar `groupId` en el request; verificar test del cliente API.

## 6. Docs, plan y cierre

- [ ] 6.1 [infra] ADR-035 + enmendar referencia ADR-024 (stale/avisos) + fila 17 `design-v0.2.md` §6; verificar archivos.
- [ ] 6.2 [infra] `pnpm nx affected -t lint,typecheck,test` con `AI_CHAIN=mock AI_MOCK_MODE=replay` y `openspec validate notifications`; verificar verde.
