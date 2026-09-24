## MODIFIED Requirements

### Requirement: OpenRouter BYOK y data_collection

Cuando el proveedor BYOK es OpenRouter y el modelo configurado (`BYOK_OPENROUTER_MODEL`) termina en `:free`, la petición SHALL incluir `provider.data_collection = "deny"`. Si el modelo no termina en `:free`, la petición NO SHALL forzar `data_collection` ni restringir el modelo a `:free`.

**Sin modelo utilizable, ese proveedor SHALL considerarse no disponible.** "Sin modelo" significa que la variable está ausente o vacía y que no hay valor por defecto que la sustituya. Hoy ese caso **no está contemplado**, y la construcción del proveedor no depende de él: se crearía igual y, al no terminar el modelo en `:free`, con la política en `omit`. El resultado sería el peor de los tres posibles —un proveedor que arranca, acepta la tarea y hace viajar el texto del CV a OpenRouter **sin** `data_collection: deny`, en silencio—, peor que un modelo muerto, que al menos falla ruidosamente. Por tanto:

- Sin modelo utilizable, el proveedor `byok:<userId>:openrouter` NO SHALL construirse ni inyectarse en el universo de la ejecución, y NO SHALL poder enrutarse para ningún usuario, tenga o no clave guardada y consentimiento vigente. Esta regla acota la inyección BYOK general: un vendor sin configuración utilizable no entra en la cadena.
- La ausencia SHALL tratarse como indisponibilidad del proveedor, **nunca** como proveedor con la política sin determinar. Un valor vacío NO SHALL caer a un valor por defecto del código que reintroduzca un modelo: si no hay modelo verificado y compatible con la política, tampoco lo hay en el código.
- El arranque SHALL registrar un aviso visible de que ese vendor BYOK queda sin modelo utilizable, y ese aviso NO SHALL sustituir a la indisponibilidad: avisar y enrutar igual es exactamente el fallo que esta regla cierra.
- La falta de modelo NO SHALL impedir el arranque del proceso ni afectar a los demás vendors BYOK (`anthropic`, `openai`), que siguen su propia configuración.

#### Scenario: Modelo free con deny

- **GIVEN** BYOK OpenRouter de Ana y `BYOK_OPENROUTER_MODEL` terminado en `:free`
- **WHEN** ese provider completa una petición
- **THEN** el cuerpo enviado a OpenRouter SHALL llevar `data_collection: "deny"`

#### Scenario: Modelo de pago sin forzar deny

- **GIVEN** BYOK OpenRouter de Ana y `BYOK_OPENROUTER_MODEL` sin sufijo `:free`
- **WHEN** ese provider completa una petición
- **THEN** la petición NO SHALL exigir `data_collection: "deny"` por política de LinkVault

#### Scenario: Sin modelo el proveedor no se construye

- **GIVEN** Ana con clave de OpenRouter guardada, consentimiento vigente y `BYOK_OPENROUTER_MODEL` ausente o vacía, sin valor por defecto que la sustituya
- **WHEN** se resuelven los proveedores BYOK de Ana
- **THEN** NO SHALL construirse `byok:<ana>:openrouter`
- **AND** ese proveedor NO SHALL aparecer en el universo de routing de la ejecución
- **AND** sus vendors `anthropic` y `openai` SHALL resolverse con normalidad

#### Scenario: Sin modelo no se manda texto sin política

- **GIVEN** la misma configuración sin modelo utilizable
- **WHEN** se ejecuta una tarea que lleva texto de CV
- **THEN** ninguna petición SHALL salir hacia OpenRouter por la vía BYOK
- **AND** NO SHALL construirse el proveedor con `data_collection` en `omit` por no terminar el modelo en `:free`

#### Scenario: El aviso de arranque no sustituye a la indisponibilidad

- **GIVEN** un arranque de `api` o `worker` sin modelo utilizable para el BYOK de OpenRouter
- **WHEN** el proceso valida su configuración
- **THEN** SHALL registrarse un aviso visible nombrando el vendor que queda sin modelo
- **AND** el proceso SHALL arrancar igualmente
- **AND** el aviso NO SHALL bastar: ese proveedor SHALL seguir siendo inenrutable mientras no haya modelo
