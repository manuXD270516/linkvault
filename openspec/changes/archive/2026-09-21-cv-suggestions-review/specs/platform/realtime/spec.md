## ADDED Requirements

### Requirement: Aviso del paso de un análisis

Cuando un análisis de encaje cambie de paso, SHALL publicarse `analysis.step` en el canal que la API ya reparte. El evento SHALL llevar solo el identificador del análisis, el de la oferta y el nombre del paso. NO SHALL llevar texto del CV, texto de la oferta, sugerencias, score ni prompt. SHALL entregarse solo a la persona dueña del análisis. Si no hay nadie escuchando, SHALL descartarse sin error y sin impedir que el análisis se guarde. Publicarlo NO SHALL retrasar ni hacer fallar el análisis.

#### Scenario: Solo la dueña

- **GIVEN** Ana y Beto con el canal abierto, y un análisis de Ana
- **WHEN** ese análisis cambia de paso
- **THEN** Ana SHALL recibir `analysis.step` con el análisis, la oferta y el paso
- **AND** Beto NO SHALL recibirlo

#### Scenario: El mensaje no lleva el CV

- **GIVEN** un análisis cuyo CV tiene un fragmento reconocible
- **WHEN** se publica `analysis.step`
- **THEN** el mensaje NO SHALL contener ese fragmento ni ninguna sugerencia

#### Scenario: Nadie escuchando

- **GIVEN** ningún canal abierto
- **WHEN** el análisis cambia de paso
- **THEN** el aviso SHALL descartarse sin error
- **AND** el análisis SHALL seguir guardado
