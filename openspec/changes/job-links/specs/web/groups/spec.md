## MODIFIED Requirements

### Requirement: Detalle del grupo

`/grupos/:id` SHALL mostrar el nombre del grupo y la lista de miembros con su nombre, su rol y su fecha de alta. Los links compartidos en el grupo se muestran según la spec `web/links`. Si el usuario es `owner`, SHALL mostrar además el código de invitación con la advertencia "Quien tenga
este código puede entrar y ver los nombres de los miembros. Regenéralo si se filtró.", un botón que copia el mensaje de invitación
"Únete a «{nombre}» en LinkVault: {enlace} (código {código})", donde `{enlace}` es la URL absoluta del SPA con
`/unirse?codigo=<código>`, y las acciones de renombrar, regenerar el código, expulsar a
un miembro y borrar el grupo. Si no es owner, SHALL mostrar la acción de salir y ninguna acción de owner. Un `404` SHALL
mostrar "Ese grupo no existe o ya no perteneces a él" con un enlace a `/grupos`, y SHALL quitar ese grupo de la lista
guardada.

#### Scenario: Detalle como owner

- **GIVEN** el owner de un grupo con dos miembros
- **WHEN** abre el detalle
- **THEN** SHALL ver el código de invitación con su advertencia, el botón de copiar la invitación, los dos miembros con su fecha de alta y las acciones de renombrar, regenerar, expulsar y borrar

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

### Requirement: Acciones del detalle

Salir, expulsar y borrar SHALL pedir confirmación antes de llamar a la API; la de borrar SHALL decir a cuántos afecta y cuántas ofertas se pierden, con el
plural correcto y omitiendo la parte de las ofertas cuando el grupo no tiene ninguna: "Se borrará para los N miembros y
se perderán las X ofertas compartidas aquí (las que estén en otros grupos siguen ahí). No se puede deshacer.", con sus
variantes para un solo miembro ("Se borrará solo para ti…"), para una sola oferta ("se perderá 1 oferta") y para ninguna
(el texto sin la parte de ofertas). El recuento SHALL venir del `total` que devuelve el listado de links del grupo, no de los que haya cargados en pantalla. Salir y borrar SHALL navegar a `/grupos` al terminar; expulsar SHALL actualizar la
lista de miembros en la misma pantalla y ofrecer "Regenerar el código para que no pueda volver a entrar", oferta que ya
cuenta como confirmación. Regenerar el código desde su botón SHALL pedir confirmación diciendo "Los miembros actuales siguen dentro; solo dejará de servir el código anterior" y
SHALL mostrar el nuevo.

#### Scenario: Salir del grupo

- **GIVEN** un miembro en el detalle
- **WHEN** pulsa salir y confirma
- **THEN** el SPA SHALL navegar a `/grupos` y el grupo NO SHALL aparecer en la lista

#### Scenario: Cancelar el borrado

- **GIVEN** el owner en el detalle
- **WHEN** pulsa borrar y cancela la confirmación
- **THEN** el SPA NO SHALL llamar a la API y SHALL seguir en el detalle

#### Scenario: Borrado informado

- **GIVEN** el owner de un grupo con 3 miembros y 37 ofertas, de las que la primera página trae 2
- **WHEN** pulsa borrar
- **THEN** la confirmación SHALL decir "Se borrará para los 3 miembros y se perderán las 37 ofertas compartidas aquí (las que estén en otros grupos siguen ahí). No se puede deshacer."

#### Scenario: Borrado de un grupo en el que estás solo

- **GIVEN** el owner de un grupo con un único miembro
- **WHEN** pulsa borrar
- **THEN** la confirmación SHALL decir "Se borrará solo para ti. No se puede deshacer."

#### Scenario: Expulsar ofrece regenerar el código

- **GIVEN** el owner en el detalle
- **WHEN** expulsa a un miembro y confirma
- **THEN** la lista de miembros SHALL actualizarse sin salir de la pantalla
- **AND** SHALL ofrecer "Regenerar el código para que no pueda volver a entrar"
