## MODIFIED Requirements

### Requirement: Cascada atómica de datos personales

Al borrar la cuenta, la cascada atómica vigente sobre datos personales SHALL, además de las
limpiezas ya especificadas sobre `group_links` (comentarios, note, publicShare, …), ejecutar
`$pull` del `userId` borrado de `knowSomeoneUserIds` en todos los documentos `group_links` donde
figure. El resto de la cascada (links privados, CVs, memberships, etc.) permanece sin cambios
respecto a la spec principal.

#### Scenario: Flag huérfano se limpia

- **GIVEN** Ana marcó know-someone en un link de grupo y luego borra su cuenta
- **WHEN** termina la cascada
- **THEN** el `userId` de Ana NO SHALL permanecer en ningún `knowSomeoneUserIds`
- **AND** el `count` proyectado para otros miembros SHALL reflejar la longitud restante
