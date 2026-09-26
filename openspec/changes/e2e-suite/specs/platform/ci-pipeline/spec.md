## ADDED Requirements

### Requirement: Suite end-to-end a demanda en un runner limpio

El repositorio SHALL tener un workflow que ejecute la suite end-to-end **con el mismo comando que en local**, en un
runner recién aprovisionado, sin servicios declarados en el runner y con las versiones de Node, pnpm y Playwright que
fija el repositorio.

- SHALL poder lanzarse **a mano** sobre cualquier rama y en los **pull requests que llevan la etiqueta `e2e`**. NO SHALL
  ejecutarse en cada push ni en cada pull request mientras no se haya decidido con los minutos medidos, y NO SHALL ser
  un check obligatorio para fusionar.
- SHALL ejecutar el perfil `local` y el ensayo del perfil `remote` contra la misma pila, y SHALL fallar si falla
  cualquiera de los dos.
- SHALL subir, **también cuando falla**, el informe HTML de Playwright y las trazas y vídeos de los fallos, con una
  retención acotada.
- SHALL poder ejecutar el perfil `remote` contra **staging**. El origen de staging y las credenciales de sus cuentas de
  prueba SHALL venir de la configuración del repositorio, **no** de un campo libre del lanzamiento, y las credenciales NO
  SHALL enviarse a ningún otro origen. Sin origen de staging configurado, esa corrida SHALL **fallar** diciendo que no
  hay destino declarado; NO SHALL terminar en verde.
- Los valores que lleguen del lanzamiento o del evento SHALL pasar a los comandos como variables de entorno, no
  interpolados en el texto del comando.

#### Scenario: Lanzamiento manual sobre una rama

- **WHEN** se lanza el workflow a mano sobre una rama
- **THEN** SHALL ejecutar el comando de la suite en un runner limpio con el perfil `local` y el ensayo `remote`
- **AND** SHALL publicar el informe HTML como artefacto de la corrida

#### Scenario: Pull request sin la etiqueta

- **GIVEN** un pull request sin la etiqueta `e2e`
- **WHEN** se abre o se actualiza
- **THEN** la suite end-to-end NO SHALL ejecutarse

#### Scenario: Fallo con artefactos

- **GIVEN** una corrida en la que falla una prueba
- **WHEN** termina el workflow
- **THEN** SHALL terminar en rojo
- **AND** SHALL haber subido el informe HTML y la traza y el vídeo de la prueba que falló

#### Scenario: Staging pedido sin destino

- **GIVEN** un repositorio sin origen de staging configurado
- **WHEN** se lanza el workflow contra staging
- **THEN** SHALL terminar en rojo diciendo que no hay destino de staging declarado
- **AND** NO SHALL ejecutar ninguna prueba
