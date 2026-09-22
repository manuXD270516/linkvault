# platform/runtime-health Specification

## Purpose

Garantiza que `api` y `worker` arranquen de forma predecible, se nieguen a arrancar con una configuración incompleta y
permitan a un operador, a un orquestador o a las pruebas de humo distinguir "el proceso vive" de "el proceso puede
atender", sin exponer datos sensibles ni requerir autenticación.

## Requirements

### Requirement: Configuración validada al arrancar

`api` y `worker` SHALL validar su configuración de entorno antes de aceptar tráfico. Si falta una variable obligatoria
o tiene un formato inválido, el proceso SHALL terminar con código distinto de cero y un mensaje que nombre la variable,
sin incluir su valor.

#### Scenario: Variable obligatoria ausente

- **GIVEN** la variable de conexión a MongoDB sin definir
- **WHEN** se arranca `api`
- **THEN** el proceso SHALL terminar con código distinto de cero
- **AND** el mensaje SHALL nombrar la variable ausente

#### Scenario: El ejemplo de configuración es suficiente

- **GIVEN** un archivo `.env` copiado sin cambios de `.env.example`
- **WHEN** se arrancan `api` y `worker`
- **THEN** ninguno SHALL fallar por validación de configuración

### Requirement: Arranque independiente de las dependencias

`api` y `worker` SHALL arrancar y servir su liveness aunque MongoDB o Redis no estén disponibles en el momento del
arranque, y SHALL recuperar la conexión cuando la dependencia vuelva sin necesidad de reiniciar el proceso.

#### Scenario: Arranque con dependencias apagadas

- **GIVEN** MongoDB y Redis detenidos
- **WHEN** se arranca `api`
- **THEN** el proceso SHALL quedar en ejecución
- **AND** `GET /health/live` SHALL responder 200

#### Scenario: Dependencia que vuelve

- **GIVEN** `api` arrancada con Redis detenido
- **WHEN** Redis se levanta
- **THEN** `GET /health` SHALL pasar a responder 200 sin reiniciar `api`

### Requirement: Liveness

`api` y `worker` SHALL exponer `GET /health/live` sin autenticación y fuera de cualquier prefijo de rutas. SHALL responder
200 en menos de un segundo mientras el proceso esté vivo, independientemente del estado de sus dependencias, con el
nombre del servicio y su versión.

#### Scenario: Proceso vivo

- **WHEN** se hace `GET /health/live`
- **THEN** SHALL responder 200 en menos de un segundo
- **AND** el cuerpo SHALL incluir el nombre del servicio y su versión

#### Scenario: Sin autenticación

- **GIVEN** una petición sin credenciales
- **WHEN** hace `GET /health/live` o `GET /health`
- **THEN** NO SHALL responder 401 ni 403

### Requirement: Readiness sobre las dependencias

`api` y `worker` SHALL exponer `GET /health` sin autenticación y fuera de cualquier prefijo de rutas. SHALL reportar
MongoDB y Redis de forma individual y responder 200 si ambas están disponibles o 503 si alguna no lo está. Cada
comprobación SHALL abortar a los 500 ms y la respuesta completa SHALL llegar en 1500 ms como máximo. El cuerpo SHALL
tener la forma `{ status, service, version, checks: { mongo: { status }, redis: { status } } }`, con `status` igual a
`up` o `down`.

#### Scenario: Todas las dependencias disponibles

- **GIVEN** MongoDB y Redis accesibles
- **WHEN** se hace `GET /health`
- **THEN** SHALL responder 200
- **AND** `checks.mongo.status` y `checks.redis.status` SHALL valer `up`

#### Scenario: Una dependencia caída

- **GIVEN** Redis inaccesible y MongoDB accesible
- **WHEN** se hace `GET /health`
- **THEN** SHALL responder 503
- **AND** `checks.redis.status` SHALL valer `down` y `checks.mongo.status` SHALL valer `up`

#### Scenario: Dependencia que no responde

- **GIVEN** una dependencia que acepta la conexión pero nunca responde
- **WHEN** se hace `GET /health`
- **THEN** SHALL responder 503 en 1500 ms como máximo

### Requirement: Health del worker

`worker` SHALL servir `GET /health/live` y `GET /health` en su propio puerto, distinto del de la API, con el mismo
contrato y el nombre de servicio `worker`.

#### Scenario: El worker responde en su propio puerto

- **GIVEN** `api` y `worker` en ejecución
- **WHEN** se hace `GET /health` contra el puerto del worker
- **THEN** SHALL responder con el mismo contrato que la API
- **AND** `service` SHALL valer `worker`

### Requirement: La salud no filtra información sensible

Las respuestas de `GET /health` y `GET /health/live` NO SHALL incluir cadenas de conexión, credenciales, nombres de
usuario, rutas internas ni mensajes o trazas de los drivers.

#### Scenario: URI con credenciales contra una dependencia inalcanzable

- **GIVEN** una URI de MongoDB con usuario y contraseña que apunta a un puerto sin servicio
- **WHEN** se hace `GET /health`
- **THEN** `checks.mongo.status` SHALL valer `down`
- **AND** el cuerpo NO SHALL contener la URI, el usuario, la contraseña ni el mensaje del driver

### Requirement: Logs sin secretos

Los logs de `api` y `worker` SHALL ser estructurados y NO SHALL contener valores de cabeceras `authorization`, `cookie`
o `set-cookie`, ni de campos `password`, `currentPassword`, `newPassword`, `passwordHash`, `apiKey`, `accessToken` o `refreshToken` situados en el objeto registrado o
hasta dos niveles de anidación por debajo de él. La cabecera `referer` de una petición SHALL registrarse reducida a su
origen y su ruta, sin query string ni fragmento; si no es una URL `http` o `https` absoluta, SHALL registrarse cortada
en su primer `?` o `#`, y si no es una cadena, SHALL registrarse redactada. Una petición sin `referer` NO SHALL ganar
esa clave en el log.

#### Scenario: Petición con cabeceras sensibles

- **WHEN** `api` registra una petición con cabeceras `authorization` y `cookie`
- **THEN** la línea de log SHALL contener esas claves con el valor redactado

#### Scenario: Objeto anidado con secretos

- **WHEN** se registra un objeto con `refreshToken` en el primer nivel de anidación y `apiKey` en el segundo
- **THEN** ninguno de los dos valores SHALL aparecer en la salida

#### Scenario: Cambio de contraseña registrado

- **WHEN** se registra un objeto con `currentPassword`, `newPassword` y `passwordHash` en el primer nivel de anidación
- **THEN** ninguno de esos valores SHALL aparecer en la salida

#### Scenario: Petición desde la página de unirse con un código

- **GIVEN** una petición con `referer: http://localhost:4200/unirse?codigo=<código>#<fragmento>`
- **WHEN** `api` o `worker` registran esa petición
- **THEN** la línea de log SHALL contener `referer` con el valor `http://localhost:4200/unirse`
- **AND** ni el código ni el fragmento SHALL aparecer en la salida

#### Scenario: Referer con el código dentro de returnUrl

- **GIVEN** una petición con `referer: http://localhost:4200/login?returnUrl=%2Funirse%3Fcodigo%3D<código>`
- **WHEN** `api` o `worker` registran esa petición
- **THEN** la línea de log SHALL contener `referer` con el valor `http://localhost:4200/login`
- **AND** el código NO SHALL aparecer en la salida

#### Scenario: Referer que no es una URL absoluta

- **GIVEN** una petición con `referer: /unirse?codigo=<código>#<fragmento>`
- **WHEN** `api` o `worker` registran esa petición
- **THEN** la línea de log SHALL contener `referer` con el valor `/unirse`
- **AND** ni el código ni el fragmento SHALL aparecer en la salida

#### Scenario: Petición sin referer

- **GIVEN** una petición sin cabecera `referer`
- **WHEN** `api` o `worker` registran esa petición
- **THEN** la línea de log NO SHALL contener la clave `referer`

### Requirement: Orquestador de prod usa liveness y readiness

El orquestador de producción (compose y Traefik / healthchecks de contenedor documentados) SHALL usar `GET /health/live`
como comprobación de **liveness** y `GET /health` como comprobación de **readiness** para los servicios `api` y
`worker`. El `HEALTHCHECK` embebido en las imágenes SHALL cubrir solo liveness; compose (u orquestador) SHALL poseer la
readiness. NO SHALL tratar como listo para tráfico un contenedor cuya readiness (`/health`) falle, aunque liveness
responda 200.

#### Scenario: Liveness del contenedor de api

- **GIVEN** el stack de producción arrancado
- **WHEN** el orquestador evalúa la liveness de `api`
- **THEN** SHALL consultar `GET /health/live`
- **AND** un 200 SHALL considerarse proceso vivo

#### Scenario: Readiness del contenedor de worker

- **GIVEN** Redis caído y el worker aún vivo
- **WHEN** el orquestador evalúa la readiness de `worker`
- **THEN** SHALL consultar `GET /health`
- **AND** un 503 SHALL impedir marcar el servicio como listo para tráfico
