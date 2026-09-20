## MODIFIED Requirements

### Requirement: Detalle del grupo

`/grupos/:id` SHALL mostrar el nombre del grupo y la lista de miembros con su nombre, su rol y su fecha de alta. Los links compartidos en el grupo se muestran según la spec `web/links`. Si el usuario es `owner`, SHALL mostrar además el código de invitación con la advertencia "Quien tenga
este código puede entrar y ver los nombres de los miembros. Regenéralo si se filtró.", un botón que copia el mensaje de invitación
"Únete a «{nombre}» en LinkVault: {enlace} (código {código})", donde `{enlace}` es la URL absoluta del SPA con
`/unirse?codigo=<código>`, y las acciones de renombrar, regenerar el código, expulsar a
un miembro, "Nombrar propietario" sobre cada miembro que no sea él mismo y borrar el grupo; en lugar de la acción de salir SHALL mostrar "Para
salir, nombra propietario a otro miembro", o, si es el único miembro, "Eres el único miembro: para irte, borra el grupo".
Si no es owner, SHALL mostrar la acción de salir y ninguna acción de owner. En español los textos SHALL decir siempre
"propietario", nunca "owner". Un `404` SHALL
mostrar "Ese grupo no existe o ya no perteneces a él" con un enlace a `/grupos`, y SHALL quitar ese grupo de la lista
guardada.

Si el usuario es `owner`, SHALL mostrar además un interruptor "Los links nuevos se comparten con un enlace público" con
el estado actual del grupo y la aclaración "Solo afecta a lo que se guarde a partir de ahora; los links que ya están no
cambian.". Cambiarlo SHALL llamar a la API y reflejarse sin recargar; un error SHALL dejar el interruptor como estaba.
Quien no es owner NO SHALL ver ese interruptor.

#### Scenario: Detalle como owner

- **GIVEN** el owner de un grupo con dos miembros
- **WHEN** abre el detalle
- **THEN** SHALL ver el código de invitación con su advertencia, el botón de copiar la invitación, los dos miembros con su fecha de alta y las acciones de renombrar, regenerar, expulsar, "Nombrar propietario" y borrar
- **AND** SHALL ver "Para salir, nombra propietario a otro miembro" en lugar de la acción de salir

#### Scenario: Nombrar propietario sobre los demás

- **GIVEN** Ana, owner de un grupo con los miembros Beto y Carla
- **WHEN** abre el detalle
- **THEN** SHALL ver "Nombrar propietario" sobre Beto y sobre Carla
- **AND** NO SHALL verlo sobre sí misma

#### Scenario: Owner solo en su grupo

- **GIVEN** el owner de un grupo en el que es el único miembro
- **WHEN** abre el detalle
- **THEN** SHALL ver "Eres el único miembro: para irte, borra el grupo" y NO SHALL ver "Nombrar propietario"

#### Scenario: Detalle como miembro

- **GIVEN** un miembro que no es owner
- **WHEN** abre el detalle
- **THEN** SHALL ver los miembros y la acción de salir
- **AND** NO SHALL ver el código de invitación ni las acciones de owner

#### Scenario: Invitación copiada

- **GIVEN** el owner de "Backend Bolivia" en el detalle
- **WHEN** copia la invitación
- **THEN** el texto copiado SHALL ser el mensaje de invitación con el nombre del grupo, el código y un enlace absoluto que
  empieza por `http` y contiene `/unirse?codigo=`

#### Scenario: Grupo sin links todavía

- **GIVEN** un miembro de un grupo recién creado
- **WHEN** abre el detalle
- **THEN** SHALL ver el estado vacío de la lista de links que define la spec `web/links`

#### Scenario: Grupo ajeno

- **GIVEN** un usuario que no es miembro
- **WHEN** abre `/grupos/:id` de ese grupo
- **THEN** SHALL ver "Ese grupo no existe o ya no perteneces a él" con un enlace a `/grupos`

#### Scenario: El owner apaga los enlaces públicos por defecto

- **GIVEN** el owner de un grupo con el interruptor encendido
- **WHEN** lo apaga
- **THEN** SHALL verse apagado sin recargar
- **AND** SHALL seguir viéndose "Solo afecta a lo que se guarde a partir de ahora; los links que ya están no cambian."

#### Scenario: Un miembro no ve el interruptor

- **GIVEN** un miembro que no es owner
- **WHEN** abre el detalle
- **THEN** NO SHALL ver el interruptor de los enlaces públicos por defecto
