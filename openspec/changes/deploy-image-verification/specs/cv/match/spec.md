## MODIFIED Requirements

### Requirement: BYOK hace no vigente el degradado por cuota de IA

Al evaluar si un análisis degradado por `quota_exceeded` sigue vigente para reutilizarlo sin reencolar, el sistema SHALL considerar el motivo **no vigente** cuando, en ese momento, la persona tiene al menos un proveedor BYOK elegible para `match-cv` (consentimiento externo vigente, clave descifrable, **configuración utilizable** y capacidades). En ese caso el `POST` SHALL ejecutar un análisis nuevo. La cuota de producto `MATCH_ANALYSES_PER_USER` sigue aplicando con independencia de BYOK.

«Configuración utilizable» SHALL significar lo mismo que en «Inyección BYOK en runTask» (`ai/byok`): la configuración que permite **construir** el proveedor de ese vendor. Un vendor que no la tenga —el caso de OpenRouter sin modelo utilizable— NO SHALL contar como BYOK elegible aquí. Sin esta condición, quien tuviera como única clave la de ese vendor invalidaría su análisis degradado vigente, volvería a pedir el análisis, `runTask` devolvería otra vez `quota_exceeded` porque ese proveedor no llega a construirse, y el siguiente `POST` volvería a invalidarlo: el bucle que este requirement existe para impedir.

Las cuatro condiciones SHALL **sumarse**, nunca sustituirse: la configuración utilizable NO SHALL hacer no vigente el degradado de un vendor sin consentimiento externo vigente o sin clave descifrable, y esta acotación NO SHALL leerse como una puerta para saltarse ninguna de las otras.

La indisponibilidad por configuración SHALL ser **de ese vendor**, nunca de BYOK entero: si la persona tiene otro vendor con clave descifrable, consentimiento vigente, configuración utilizable y capacidades, el motivo SHALL seguir siendo no vigente y el `POST` SHALL ejecutar un análisis nuevo.

Cuando ningún vendor reúne las cuatro condiciones, el degradado por `quota_exceeded` SHALL seguir **vigente** hasta su hora de vuelta: el `POST` SHALL reutilizar el informe degradado sin reencolar y NO SHALL ejecutar un análisis nuevo.

#### Scenario: Reintentar tras pegar una clave BYOK

- **GIVEN** un análisis de Ana degradado por cuota de IA agotada cuya hora de vuelta aún no llegó, y Ana acaba de guardar una clave OpenAI usable con consentimiento vigente
- **WHEN** pide de nuevo el análisis de esa oferta
- **THEN** SHALL ejecutarse un análisis nuevo
- **AND** NO SHALL reutilizarse el informe básico solo por la hora de vuelta

#### Scenario: La única clave es de un vendor sin configuración utilizable

- **GIVEN** un análisis de Ana degradado por cuota de IA agotada cuya hora de vuelta aún no llegó
- **AND** Ana con consentimiento vigente y una única clave, la de un vendor sin configuración utilizable
- **WHEN** pide de nuevo el análisis de esa oferta
- **THEN** ese vendor NO SHALL contar como BYOK elegible
- **AND** el motivo `quota_exceeded` SHALL seguir vigente
- **AND** SHALL reutilizarse el informe degradado sin reencolar ninguna ejecución nueva

#### Scenario: Un vendor inutilizable entre otros utilizables

- **GIVEN** el mismo análisis degradado con la hora de vuelta sin llegar
- **AND** Ana con consentimiento vigente y claves descifrables de dos vendors, uno sin configuración utilizable y otro con configuración utilizable y las capacidades de `match-cv`
- **WHEN** pide de nuevo el análisis de esa oferta
- **THEN** el motivo SHALL considerarse no vigente
- **AND** SHALL ejecutarse un análisis nuevo

#### Scenario: La configuración utilizable no sustituye al consentimiento ni a la clave

- **GIVEN** el mismo análisis degradado con la hora de vuelta sin llegar
- **AND** un vendor con configuración utilizable pero sin consentimiento externo vigente, o sin clave descifrable
- **WHEN** pide de nuevo el análisis de esa oferta
- **THEN** ese vendor NO SHALL contar como BYOK elegible
- **AND** el motivo `quota_exceeded` SHALL seguir vigente
