## Purpose

Da al SPA un único criterio para explicar el fallo de una petición: qué se dice cuando la pantalla no tiene un mensaje
propio, cómo se distingue un servicio que no responde de un fallo del producto, y la regla de que cada código de error
de la API tiene una decisión de texto escrita, para que ningún código nuevo acabe en el genérico sin que nadie lo
decida.

## ADDED Requirements

### Requirement: Mensajes comunes de fallo de una petición

El componente común de errores del SPA (`lv-request-error`) SHALL elegir el mensaje de un fallo en este orden, y
cada pantalla SHALL mostrar antes sus mensajes propios y delegar en él el resto:

1. La petición no llegó a la API (estado `0`): "No pudimos conectar con LinkVault. Revisa tu conexión".
2. La respuesta trae un código con texto común propio (requirement «Textos comunes por código»): ese texto, sea cual
   sea el estado HTTP.
3. Estado `502`, `503` o `504` **sin código**, o con un código cuya entrada en `API_ERROR_COPY` es `fallback`
   (requirement «Cada código de error tiene una decisión de texto»; p. ej. el proxy durante un despliegue): "LinkVault
   no está disponible en este momento. Inténtalo en unos minutos".
4. Cualquier otro caso: "Algo salió mal. Inténtalo de nuevo". Incluye un `5xx` con un código `local` o `unreachable`
   (lo traduce otra pantalla o el SPA no debería recibirlo: no se sabe si es pasajero), un `5xx` con un código que no
   está en `API_ERROR_COPY`, cualquier `4xx` sin texto común y un error que no es una respuesta HTTP.

El SPA NO SHALL mostrar el `message` del cuerpo de error de la API en ningún caso.

#### Scenario: Sin conexión

- **WHEN** una petición falla con estado `0`
- **THEN** el componente SHALL mostrar "No pudimos conectar con LinkVault. Revisa tu conexión"

#### Scenario: Un 503 con código fallback se anuncia como pasajero

- **WHEN** borrar la cuenta responde `503` con `search_purge_failed` (entrada `fallback`)
- **THEN** el componente SHALL mostrar "LinkVault no está disponible en este momento. Inténtalo en unos minutos"
- **AND** NO SHALL mostrar "Algo salió mal. Inténtalo de nuevo"

#### Scenario: Un 502 sin cuerpo de la API

- **WHEN** una petición responde `502` con un cuerpo que no es de la API
- **THEN** el componente SHALL mostrar "LinkVault no está disponible en este momento. Inténtalo en unos minutos"

#### Scenario: Un 504 del proxy

- **WHEN** una petición responde `504` sin cuerpo
- **THEN** el componente SHALL mostrar "LinkVault no está disponible en este momento. Inténtalo en unos minutos"

#### Scenario: Un 503 con código local fuera de su pantalla

- **WHEN** una petición responde `503` con `search_unavailable` (entrada `local`) y llega al componente común
- **THEN** el componente SHALL mostrar "Algo salió mal. Inténtalo de nuevo"
- **AND** NO SHALL mostrar el texto de servicio no disponible

#### Scenario: Un 503 con un código fuera de la tabla

- **WHEN** una petición responde `503` con un código que no es clave de `API_ERROR_COPY`
- **THEN** el componente SHALL mostrar "Algo salió mal. Inténtalo de nuevo"

#### Scenario: Un 500 es un fallo inesperado

- **WHEN** una petición responde `500` con `internal_error`
- **THEN** el componente SHALL mostrar "Algo salió mal. Inténtalo de nuevo"
- **AND** NO SHALL mostrar el texto de servicio no disponible

#### Scenario: Un código sin texto común fuera de 502-504

- **WHEN** una petición responde `409` con `already_owner`
- **THEN** el componente SHALL mostrar "Algo salió mal. Inténtalo de nuevo"

#### Scenario: Un error que no es una respuesta HTTP

- **WHEN** el fallo no es una respuesta HTTP
- **THEN** el componente SHALL mostrar "Algo salió mal. Inténtalo de nuevo"

#### Scenario: El texto propio gana al estado

- **WHEN** una petición responde `503` con `vault_unavailable`
- **THEN** el componente SHALL mostrar el texto común de `vault_unavailable`
- **AND** NO SHALL mostrar el texto de servicio no disponible

#### Scenario: El message de la API no se muestra

- **WHEN** una petición responde `500` con `internal_error` y `message` "Internal server error"
- **THEN** el texto del componente NO SHALL contener "Internal server error"

#### Scenario: Un aviso propio no se duplica con el común

- **GIVEN** `/notificaciones` en un entorno sin claves VAPID
- **WHEN** la persona activa el push y la API responde `503` con `vapid_unavailable`
- **THEN** ve "El push no está disponible ahora. Los avisos por email siguen activos"
- **AND** la página NO SHALL mostrar el componente común de errores para ese fallo
- **AND** al salir de `/notificaciones` y volver, tampoco SHALL mostrar el componente común de errores para ese fallo

### Requirement: Referencia técnica del fallo

Con los mensajes de servicio no disponible y de fallo inesperado, cuando hubo respuesta HTTP, el componente SHALL
mostrar debajo una línea de referencia "Si lo reportas, menciona: <estado> · <código>" (EN: "If you report it,
mention: <status> · <code>"). El código SHALL mostrarse solo si es una clave propia de `API_ERROR_COPY` (no
heredada de su prototipo, p. ej. `toString`); si la respuesta no
trae código o trae uno que no está en la tabla, la línea SHALL ser "Si lo reportas, menciona: <estado>" (EN: "If you
report it, mention: <status>"). La referencia SHALL quedar fuera del elemento con `role="alert"`, para que el mensaje
anunciado sea solo el texto. El componente NO SHALL mostrar referencia sin conexión, con un error que no es una
respuesta HTTP ni con un texto común por código.

#### Scenario: Referencia de un fallo inesperado

- **WHEN** una petición responde `500` con `internal_error`
- **THEN** el componente SHALL mostrar "Si lo reportas, menciona: 500 · internal_error" fuera del elemento
  `role="alert"`
- **AND** el texto del elemento `role="alert"` SHALL ser exactamente "Algo salió mal. Inténtalo de nuevo"

#### Scenario: Referencia sin código

- **WHEN** una petición responde `502` sin cuerpo de la API
- **THEN** el componente SHALL mostrar "Si lo reportas, menciona: 502"

#### Scenario: Un código desconocido en el cuerpo

- **WHEN** una petición responde `500` con un código que no es clave de `API_ERROR_COPY`
- **THEN** el componente SHALL mostrar "Si lo reportas, menciona: 500"
- **AND** NO SHALL mostrar ese código

#### Scenario: Sin referencia con texto propio

- **WHEN** una petición responde `404` con `member_not_found`
- **THEN** el componente NO SHALL mostrar ninguna línea de referencia

#### Scenario: Sin referencia sin conexión

- **WHEN** una petición falla con estado `0`
- **THEN** el componente NO SHALL mostrar ninguna línea de referencia

### Requirement: Textos comunes por código

El componente común SHALL tener texto propio, en español y en inglés, para estos códigos:

| Código | ES | EN |
| --- | --- | --- |
| `too_many_attempts` | "Demasiados intentos. Vuelve a intentarlo en N minutos" (N = `Retry-After` en minutos redondeado hacia arriba) o, sin `Retry-After`, "Demasiados intentos. Vuelve a intentarlo más tarde" | sin cambio |
| `member_not_found` | "Esa persona ya no está en el grupo. Recarga la página para ver la lista actual" | "That person is no longer in the group. Reload the page to see the current list" |
| `owner_cannot_leave` | "Ahora eres propietario de este grupo. Recarga la página y nombra propietario a otro miembro para poder salir" | "You are now the owner of this group. Reload the page and make another member the owner to leave" |
| `consent_text_outdated` | "El texto del permiso cambió. Recarga la página para leer la versión vigente" | "The consent text changed. Reload the page to read the current version" |
| `vault_unavailable` | "LinkVault no tiene activado el guardado de claves de IA. Tu clave no se guardó" | "Saving AI keys is not enabled in LinkVault. Your key was not saved" |

Un código SHALL tener texto común solo si la persona puede recibirlo por un camino que el SPA ofrece y el mensaje de
servicio no disponible o el de fallo inesperado la llevaría a reintentar algo que vuelve a fallar. Un código que
indica que algo falta por configuración NO SHALL caer en el mensaje de servicio no disponible.

#### Scenario: Miembro que ya se fue

- **GIVEN** el propietario en el detalle de un grupo, con una persona que salió desde otra sesión
- **WHEN** la expulsa y la API responde `404` con `member_not_found`
- **THEN** ve "Esa persona ya no está en el grupo. Recarga la página para ver la lista actual"

#### Scenario: Propietario que intenta salir

- **WHEN** salir del grupo responde `409` con `owner_cannot_leave`
- **THEN** la persona ve "Ahora eres propietario de este grupo. Recarga la página y nombra propietario a otro miembro para poder salir"

#### Scenario: Texto del permiso desactualizado

- **GIVEN** Ana con `/perfil` abierto desde antes de que cambiara la versión del texto del permiso de IA externa
- **WHEN** activa el permiso y la API responde `409` con `consent_text_outdated`
- **THEN** ve "El texto del permiso cambió. Recarga la página para leer la versión vigente"

#### Scenario: Bóveda de claves ausente

- **WHEN** guardar una clave de IA propia responde `503` con `vault_unavailable`
- **THEN** el componente SHALL mostrar "LinkVault no tiene activado el guardado de claves de IA. Tu clave no se guardó"

### Requirement: Cada código de error tiene una decisión de texto

El SPA SHALL mantener una tabla `API_ERROR_COPY` con una entrada por cada valor de `apiErrorCodeSchema` y ninguna más,
y el componente común SHALL leerla para decidir el paso 3 de «Mensajes comunes de fallo de una petición». Cada entrada
SHALL ser de una de estas cuatro clases:

- `common`: el componente común tiene texto propio para el código (requirement «Textos comunes por código»).
- `local`: lo traducen las pantallas o servicios que hacen la petición; la entrada SHALL nombrar al menos un fichero
  del SPA que **compara** el código (no uno que solo lo nombra). Si el código llega al componente común, este lo trata
  como fallo inesperado.
- `fallback`: el mensaje por clase de estado del componente común es el correcto (servicio no disponible con
  `502`-`504`, fallo inesperado con el resto); la entrada SHALL llevar el motivo.
- `unreachable`: el SPA no ofrece ningún camino que lo produzca, o lo resuelve sin mostrar texto (p. ej. cerrando la
  sesión); la entrada SHALL llevar el motivo. Si llegara, el componente lo trata como fallo inesperado.

Un código añadido a `apiErrorCodeSchema` sin su entrada SHALL hacer fallar la verificación del SPA nombrando el código,
con independencia de qué change lo añada. Los textos del componente común y las entradas `common` SHALL coincidir en
los dos sentidos. Las comprobaciones SHALL correr en `web:typecheck` y `web:test`, sin cambiar workflows.

#### Scenario: Un código nuevo sin decisión

- **GIVEN** un change que añade `ai_consent_required` a `apiErrorCodeSchema` sin entrada en `API_ERROR_COPY`
- **WHEN** corre la verificación del SPA
- **THEN** `web:typecheck` y `web:test` SHALL fallar nombrando `ai_consent_required`

#### Scenario: Una entrada para un código que no existe

- **GIVEN** `API_ERROR_COPY` con una entrada `retired_code` que no está en `apiErrorCodeSchema`
- **WHEN** corre `web:test`
- **THEN** SHALL fallar nombrando `retired_code`

#### Scenario: Una exclusión sin motivo

- **GIVEN** una entrada `fallback` o `unreachable` con motivo vacío
- **WHEN** corre `web:test`
- **THEN** SHALL fallar nombrando el código

#### Scenario: Un código común sin texto en el componente

- **GIVEN** una entrada `common` para un código al que el componente no le da texto propio
- **WHEN** corre `web:test`
- **THEN** SHALL fallar nombrando el código

#### Scenario: Un texto del componente sin entrada común

- **GIVEN** el componente con texto propio para `group_full` y su entrada en `local`
- **WHEN** corre `web:test`
- **THEN** SHALL fallar nombrando `group_full`

#### Scenario: Solo los 503 fallback o sin código se anuncian como pasajeros

- **GIVEN** cada código de `apiErrorCodeSchema` en una respuesta `503`
- **WHEN** corre `web:test`
- **THEN** el componente SHALL mostrar el texto de servicio no disponible solo para los códigos `fallback` y para la
  respuesta sin código, y SHALL fallar nombrando cualquier otro código que lo muestre

### Requirement: Textos de error en español e inglés

Los textos nuevos del componente común —servicio no disponible, referencia técnica y textos comunes por código—
SHALL tener identificador i18n explícito, estar en `messages.xlf` como salida de la extracción y tener traducción
inglesa vigente en `messages.en.xlf` (ADR-050). El texto español de "Algo salió mal. Inténtalo de nuevo" y su
identificador `@@error.unknown` NO SHALL cambiar.

#### Scenario: Catálogo al día

- **WHEN** corre `pnpm nx run web:i18n-check` tras añadir los textos
- **THEN** SHALL terminar en verde y `messages.en.xlf` SHALL tener `target` para cada identificador nuevo

#### Scenario: Texto inglés del servicio no disponible

- **GIVEN** el SPA con la traducción inglesa cargada
- **WHEN** una petición responde `503` sin código
- **THEN** el componente SHALL mostrar "LinkVault is not available right now. Try again in a few minutes"
