## MODIFIED Requirements

### Requirement: Ruta pública de aviso de privacidad

El SPA SHALL exponer la ruta pública `/privacidad` (sin exigir sesión) con un aviso que explique, en lenguaje claro al
menos: qué se guarda del CV y dónde; la política de retención aplicable (o que el detalle de prod se documenta según
configuración); el uso de IA / OpenRouter / BYOK y el consentimiento; cómo borrar la cuenta; y que existen **copias de
seguridad cifradas** fuera del servidor que conservan los datos borrados (el CV y la cuenta) durante un **plazo máximo
escrito**, tras el cual desaparecen de ellas. El plazo del aviso SHALL ser el que documenta el respaldo
(`platform/backups`). El aviso NO SHALL inventar garantías que el entorno actual no cumpla; cuando la configuración de
producción tenga cifrado en reposo y/o retención documentados, `/privacidad` MAY afirmarlos. NO SHALL afirmar que un
dato borrado desaparece de inmediato de todas partes.

#### Scenario: Abrir /privacidad sin sesión

- **GIVEN** una persona sin sesión
- **WHEN** abre `/privacidad`
- **THEN** SHALL ver el aviso de privacidad
- **AND** NO SHALL redirigirse a `/login`

#### Scenario: El aviso cubre los temas obligatorios

- **WHEN** se revisa el contenido de `/privacidad`
- **THEN** SHALL mencionar almacenamiento de CV, retención, IA/OpenRouter/BYOK y borrado de cuenta
- **AND** NO SHALL afirmar cifrado en reposo ni caducidad automática del CV si el entorno documentado no los tiene

#### Scenario: El aviso dice cuánto duran los datos borrados en las copias

- **WHEN** se revisa la sección de borrado de `/privacidad`
- **THEN** SHALL decir que las copias de seguridad cifradas conservan los datos borrados
- **AND** SHALL dar el plazo máximo documentado por el respaldo
