## MODIFIED Requirements

### Requirement: Logs sin secretos

Los logs de `api` y `worker` SHALL ser estructurados y NO SHALL contener valores de cabeceras `authorization`, `cookie`
o `set-cookie`, ni de campos `password`, `currentPassword`, `newPassword`, `passwordHash`, `apiKey`, `accessToken` o `refreshToken` situados en el objeto registrado o
hasta dos niveles de anidación por debajo de él.

#### Scenario: Petición con cabeceras sensibles

- **WHEN** `api` registra una petición con cabeceras `authorization` y `cookie`
- **THEN** la línea de log SHALL contener esas claves con el valor redactado

#### Scenario: Objeto anidado con secretos

- **WHEN** se registra un objeto con `refreshToken` en el primer nivel de anidación y `apiKey` en el segundo
- **THEN** ninguno de los dos valores SHALL aparecer en la salida

#### Scenario: Cambio de contraseña registrado

- **WHEN** se registra un objeto con `currentPassword`, `newPassword` y `passwordHash` en el primer nivel de anidación
- **THEN** ninguno de esos valores SHALL aparecer en la salida
