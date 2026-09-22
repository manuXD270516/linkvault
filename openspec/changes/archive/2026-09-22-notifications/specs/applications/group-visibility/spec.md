## ADDED Requirements

### Requirement: Compartir estado habilita avisos de grupo

Al pasar `visibility` a `group`, los **cambios posteriores** de estado/etapa SHALL poder generar
`application_status_group`. El solo hecho de activar el interruptor NO SHALL, por sí mismo, enviar un aviso de “cambio
de estado” a menos que el design lo documente explícitamente como evento distinto (V0: **no** avisa solo por el
toggle).

#### Scenario: Toggle sin cambio de estado

- **GIVEN** Ana con postulación `private` en estado `applied`
- **WHEN** activa `visibility` `group` sin cambiar el estado
- **THEN** NO SHALL encolarse `application_status_group` por ese PATCH
