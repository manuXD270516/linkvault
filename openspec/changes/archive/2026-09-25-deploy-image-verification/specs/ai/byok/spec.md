## MODIFIED Requirements

### Requirement: Guardar y revocar una clave por vendor

Una persona autenticada SHALL poder guardar exactamente una clave por vendor (`anthropic`, `openai`, `openrouter`) vía `PUT /api/users/me/ai-keys/:vendor` con cuerpo `{ apiKey }` (longitud mínima 16). El sistema SHALL cifrarla con libsodium secretbox y `AI_VAULT_KEY` antes de persistirla y SHALL responder `200` solo con `vendor`, `keyHint` (últimos 4 caracteres), `updatedAt` y `available`. `GET /api/users/me/ai-keys` SHALL listar solo esas vistas. `DELETE /api/users/me/ai-keys/:vendor` SHALL borrar la fila. Ninguna respuesta ni el ledger SHALL incluir la clave en claro ni el ciphertext. Sin vault disponible fuera de producción, PUT SHALL responder `503` con código `vault_unavailable`.

`available` SHALL ser un booleano que diga si el servidor **puede construir hoy el proveedor de ese vendor**, en el sentido de «configuración utilizable» de «Inyección BYOK en runTask» y «OpenRouter BYOK y data_collection». SHALL derivarse **solo de la configuración del servidor**: NO SHALL derivarse de que haya clave guardada, de que la clave sea descifrable, de la disponibilidad del vault ni del estado del consentimiento externo. Existe para que la interfaz no tenga que deducir la disponibilidad en el cliente ni presentar como usable un vendor que el servidor no va a enrutar.

La disponibilidad SHALL informarse para **cada vendor soportado, tenga o no clave guardada** —el formulario de un vendor sin configurar necesita el mismo dato—, y esa información SHALL limitarse al par vendor + `available`. NO SHALL fabricarse una vista de clave donde no hay clave: el listado de claves sigue conteniendo **solo las guardadas**. Cuando un vendor tiene clave guardada, el `available` de su vista y el que se informe para ese vendor SHALL salir del mismo cálculo y NO SHALL discrepar.

El conjunto de campos SHALL seguir siendo **cerrado**: «solo» sigue significando solo, ahora con `available` dentro. Esta ampliación NO SHALL leerse como permiso para devolver cualquier otro campo de la clave o de la configuración.

La prohibición del secreto queda **intacta**: `available` es un estado de configuración, no un secreto. Ninguna respuesta SHALL incluir la clave en claro ni su ciphertext, y `available` NO SHALL revelar ningún valor de configuración del servidor —ni el modelo, ni credenciales de plataforma—, solo el booleano.

#### Scenario: Upsert y listado

- **GIVEN** Ana autenticada y `AI_VAULT_KEY` configurada
- **WHEN** hace PUT con una clave de OpenAI y luego GET
- **THEN** el listado SHALL incluir `vendor: openai` y un `keyHint` de 4 caracteres
- **AND** ni GET ni PUT SHALL devolver la clave completa

#### Scenario: Revocar

- **GIVEN** Ana con clave de Anthropic guardada
- **WHEN** hace DELETE de ese vendor
- **THEN** GET ya no SHALL listar Anthropic
- **AND** las siguientes ejecuciones NO SHALL inyectar `byok:<ana>:anthropic`

#### Scenario: Vault no disponible en desarrollo

- **GIVEN** entorno no productivo sin `AI_VAULT_KEY` válida
- **WHEN** Ana hace PUT
- **THEN** SHALL responderse `503` con código `vault_unavailable`

#### Scenario: El listado dice la disponibilidad de cada vendor

- **GIVEN** Ana autenticada con claves guardadas de `openrouter` y `openai`, y una instancia donde `openrouter` no tiene configuración utilizable
- **WHEN** hace GET del listado de claves
- **THEN** la vista de `openrouter` SHALL llevar `available: false`
- **AND** la vista de `openai` SHALL llevar `available: true`
- **AND** la respuesta SHALL informar también de la disponibilidad de `anthropic`, que no tiene clave guardada, sin listarlo como clave guardada

#### Scenario: La disponibilidad sale del servidor, no del vault ni de la clave

- **GIVEN** un vendor con configuración utilizable del que Ana no tiene clave guardada, y el consentimiento externo revocado
- **WHEN** hace GET del listado de claves
- **THEN** ese vendor SHALL informarse como disponible
- **AND** `available` NO SHALL calcularse a partir de tener clave guardada, de poder descifrarla ni del estado del consentimiento

#### Scenario: La disponibilidad no es un secreto

- **GIVEN** cualquier respuesta de las rutas de claves de IA
- **WHEN** se inspecciona su cuerpo
- **THEN** cada vista SHALL llevar como mucho `vendor`, `keyHint`, `updatedAt` y `available`
- **AND** NO SHALL llevar la clave en claro ni su ciphertext
- **AND** NO SHALL llevar el modelo configurado ni ningún otro valor de configuración del servidor

### Requirement: Inyección BYOK en runTask

Cuando `runTask` recibe un `userId` con consentimiento externo vigente y al menos una clave descifrable, el sistema SHALL añadir proveedores `byok:<userId>:<vendor>` (`external: true`) al universo de la ejecución (delante en el orden de routing), **uno por cada vendor que tenga clave descifrable y configuración utilizable**. Sin consentimiento o sin claves, NO SHALL inyectar BYOK. Un fallo al descifrar o al llamar al vendor SHALL registrarse como `provider_error` y continuar con el siguiente proveedor **elegible de esa cadena** (si la cuota de plataforma está agotada, la cadena solo tiene BYOK).

Un vendor cuya configuración no permita construir el proveedor —el caso de OpenRouter sin modelo utilizable descrito en «OpenRouter BYOK y data_collection»— NO SHALL inyectarse. Esa ausencia SHALL ser indisponibilidad **de ese vendor**, nunca de BYOK entero: los demás vendors con clave descifrable y configuración utilizable SHALL inyectarse con normalidad y conservar su prioridad sobre la plataforma.

Consentimiento vigente, clave descifrable y configuración utilizable SHALL ser condiciones que **se suman**, no que se sustituyen. Tener configuración utilizable NO SHALL habilitar la inyección de un vendor sin consentimiento externo vigente o sin clave descifrable, y esta acotación NO SHALL leerse como una puerta para saltarse ninguna de las otras dos.

#### Scenario: BYOK gana a la plataforma

- **GIVEN** Ana con clave OpenRouter, consentimiento vigente, cuota de plataforma no agotada, y `AI_CHAIN` con openrouter de plataforma
- **AND** ese vendor con configuración utilizable (modelo presente)
- **WHEN** ejecuta una tarea personal
- **THEN** el primer intento SHALL usar `byok:<ana>:openrouter` si es elegible
- **AND** el ledger del success SHALL llevar ese `providerId`

#### Scenario: Sin consentimiento no usa la clave

- **GIVEN** Ana con clave guardada y consentimiento revocado
- **WHEN** ejecuta una tarea personal
- **THEN** ningún proveedor `byok:` SHALL recibir la petición

#### Scenario: Un vendor sin configuración utilizable no arrastra a los demás

- **GIVEN** Ana con consentimiento vigente y claves descifrables de `openrouter`, `anthropic` y `openai`
- **AND** `openrouter` sin modelo utilizable y los otros dos con configuración utilizable
- **WHEN** se resuelven los proveedores BYOK de la ejecución
- **THEN** NO SHALL inyectarse `byok:<ana>:openrouter`
- **AND** SHALL inyectarse `byok:<ana>:anthropic` y `byok:<ana>:openai`
- **AND** esos dos SHALL conservar su prioridad sobre los proveedores de plataforma

#### Scenario: La configuración utilizable no sustituye al consentimiento ni a la clave

- **GIVEN** un vendor con configuración utilizable pero sin consentimiento externo vigente, o sin clave descifrable
- **WHEN** se resuelven los proveedores BYOK de la ejecución
- **THEN** ese vendor NO SHALL inyectarse
- **AND** la configuración utilizable NO SHALL bastar por sí sola para inyectar ningún proveedor `byok:`

### Requirement: OpenRouter BYOK y data_collection

Cuando el proveedor BYOK es OpenRouter y el modelo configurado (`BYOK_OPENROUTER_MODEL`) termina en `:free`, la petición SHALL incluir `provider.data_collection = "deny"`. Si el modelo no termina en `:free`, la petición NO SHALL forzar `data_collection` ni restringir el modelo a `:free`.

**Sin modelo utilizable, ese proveedor SHALL considerarse no disponible.** "Sin modelo" significa que la variable está ausente o vacía y que no hay valor por defecto que la sustituya. Hoy ese caso **no está contemplado**, y la construcción del proveedor no depende de él: se crearía igual y, al no terminar el modelo en `:free`, con la política en `omit`. El resultado sería el peor de los tres posibles —un proveedor que arranca, acepta la tarea y hace viajar el texto del CV a OpenRouter **sin** `data_collection: deny`, en silencio—, peor que un modelo muerto, que al menos falla ruidosamente. Por tanto:

- Sin modelo utilizable, el proveedor `byok:<userId>:openrouter` NO SHALL construirse ni inyectarse en el universo de la ejecución, y NO SHALL poder enrutarse para ningún usuario, tenga o no clave guardada y consentimiento vigente. La acotación correspondiente de la inyección BYOK general —un vendor sin configuración utilizable no entra en la cadena, y su ausencia no arrastra a los demás vendors— SHALL vivir en el requirement «Inyección BYOK en runTask», que es donde la inyección se declara obligatoria.
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
