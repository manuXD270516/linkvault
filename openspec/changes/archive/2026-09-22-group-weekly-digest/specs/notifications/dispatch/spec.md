## MODIFIED Requirements

### Requirement: Entrega por canales independientes

Para los tipos `group_new_link`, `application_status_group` y `application_stale`, cada
destinatario elegible SHALL poder recibir el aviso por **email** (si `emailVerified` y el tipo no
está en opt-out) y por **web push** (si tiene suscripción activa y el tipo no está en opt-out),
según el resto de este capability. Fallar un canal NO SHALL bloquear el otro.

El tipo **`group_weekly_digest`** SHALL entregarse **solo por email**. NO SHALL intentarse web
push para ese tipo. Su producción SHALL ocurrir en el worker (cron / job semanal), no como fan-out
de un hecho HTTP de api.

#### Scenario: Digest no usa push

- **GIVEN** Ana con suscripción push activa y digest habilitado
- **WHEN** se envía el digest semanal de un grupo
- **THEN** SHALL intentarse email (si verificada)
- **AND** NO SHALL encolarse ni enviarse web push de tipo `group_weekly_digest`
