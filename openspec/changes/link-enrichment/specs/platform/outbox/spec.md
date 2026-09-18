## MODIFIED Requirements

### Requirement: El trabajo encolado no se pierde

El trabajo publicado en la cola SHALL consumirse exactamente una vez en efecto: el consumidor SHALL ser idempotente por
sí mismo, de modo que un evento republicado tras expirar la retención de la cola NO SHALL duplicar su efecto. Un job que
falla SHALL reintentarse según la política de la cola y, agotados los reintentos, SHALL quedar registrado como fallido
sin que el link se quede sin explicación. Ningún consumidor SHALL descartar trabajo en silencio.

#### Scenario: Cola sin consumidor

- **GIVEN** el worker apagado
- **WHEN** se guarda un link y su evento se publica
- **THEN** el job SHALL quedar esperando en la cola y el link SHALL seguir en `pending`
- **AND** al arrancar el worker SHALL procesarse sin haberse perdido

#### Scenario: Job consumido

- **GIVEN** un link guardado y su evento publicado
- **WHEN** el worker consume el job
- **THEN** el link SHALL dejar de estar en `pending`

#### Scenario: Evento republicado tras la retención

- **GIVEN** un job ya consumido y olvidado por la retención de la cola
- **WHEN** su evento vuelve a publicarse
- **THEN** el efecto SHALL ser el mismo que tras la primera vez

#### Scenario: Job que agota sus reintentos

- **GIVEN** un job cuyo procesamiento falla siempre
- **WHEN** se agotan sus reintentos
- **THEN** SHALL quedar registrado como fallido
- **AND** el link SHALL quedar con un estado que explique que no se pudo enriquecer
