## ADDED Requirements

### Requirement: BYOK hace no vigente el degradado por cuota de IA

Al evaluar si un análisis degradado por `quota_exceeded` sigue vigente para reutilizarlo sin reencolar, el sistema SHALL considerar el motivo **no vigente** cuando, en ese momento, la persona tiene al menos un proveedor BYOK elegible para `match-cv` (consentimiento externo vigente, clave descifrable y capacidades). En ese caso el `POST` SHALL ejecutar un análisis nuevo. La cuota de producto `MATCH_ANALYSES_PER_USER` sigue aplicando con independencia de BYOK.

#### Scenario: Reintentar tras pegar una clave BYOK

- **GIVEN** un análisis de Ana degradado por cuota de IA agotada cuya hora de vuelta aún no llegó, y Ana acaba de guardar una clave OpenAI usable con consentimiento vigente
- **WHEN** pide de nuevo el análisis de esa oferta
- **THEN** SHALL ejecutarse un análisis nuevo
- **AND** NO SHALL reutilizarse el informe básico solo por la hora de vuelta
