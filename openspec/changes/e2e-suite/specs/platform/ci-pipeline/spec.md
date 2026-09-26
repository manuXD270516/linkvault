## ADDED Requirements

### Requirement: Suite end-to-end a demanda en un runner limpio

El repositorio SHALL tener un workflow que ejecute la suite end-to-end **con el mismo comando que en local**, en un
runner recién aprovisionado, sin servicios declarados en el runner y con las versiones de Node, pnpm y Playwright que
fija el repositorio.

- SHALL lanzarse **solo a mano**, sobre cualquier rama. NO SHALL ejecutarse en ningún push ni pull request mientras
  no se haya decidido otro disparador con los minutos medidos, y NO SHALL ser un check obligatorio para fusionar.
- Dos corridas contra staging NO SHALL ejecutarse a la vez ni cancelarse entre sí.
- SHALL ejecutar el perfil `local`, y el ensayo del perfil `remote` contra la misma pila **cuando el lanzamiento lo
  pide**, y SHALL fallar si falla cualquiera de los dos.
- SHALL subir, **también cuando falla**, el informe HTML de Playwright y las trazas y vídeos de los fallos, con una
  retención acotada.
- SHALL poder ejecutar el perfil `remote` contra **staging**, **solo desde `main`**. El origen de staging y las
  credenciales de sus cuentas de prueba SHALL venir de la configuración del repositorio, **no** de un campo libre del
  lanzamiento, y las credenciales NO SHALL enviarse a ningún otro origen. Estos guardias evitan accidentes, no
  autorizan: quien puede lanzar el workflow sobre `main` puede usar esas credenciales. Pedir staging desde otra rama, o
  sin origen de staging configurado, SHALL **fallar** diciendo por qué; NO SHALL terminar en verde.
- Los valores que lleguen del lanzamiento o del evento SHALL pasar a los comandos como variables de entorno, no
  interpolados en el texto del comando.

#### Scenario: Lanzamiento manual sobre una rama

- **WHEN** se lanza el workflow a mano sobre una rama, sin pedir el ensayo remoto
- **THEN** SHALL ejecutar el comando de la suite en un runner limpio con el perfil `local`
- **AND** NO SHALL ejecutar el ensayo `remote`
- **AND** SHALL publicar el informe HTML como artefacto de la corrida

#### Scenario: Lanzamiento manual con ensayo remoto

- **WHEN** se lanza el workflow a mano pidiendo el ensayo remoto
- **THEN** SHALL ejecutar el perfil `local` y después el ensayo `remote` contra la misma pila

#### Scenario: Un pull request no la lanza

- **GIVEN** un pull request abierto
- **WHEN** se actualiza o se le pone cualquier etiqueta
- **THEN** la suite end-to-end NO SHALL ejecutarse

#### Scenario: Fallo con artefactos

- **GIVEN** una corrida en la que falla una prueba
- **WHEN** termina el workflow
- **THEN** SHALL terminar en rojo
- **AND** SHALL haber subido el informe HTML y la traza y el vídeo de la prueba que falló

#### Scenario: Staging pedido desde otra rama

- **WHEN** se lanza el workflow contra staging sobre una rama que no es `main`
- **THEN** SHALL terminar en rojo diciendo que staging solo se lanza desde `main`
- **AND** NO SHALL ejecutar ninguna prueba ni leer las credenciales de staging

#### Scenario: Staging pedido sin destino

- **GIVEN** un repositorio sin origen de staging configurado
- **WHEN** se lanza el workflow contra staging desde `main`
- **THEN** SHALL terminar en rojo diciendo que no hay destino de staging declarado
- **AND** NO SHALL ejecutar ninguna prueba
