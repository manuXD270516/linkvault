## MODIFIED Requirements

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
