# web/groups Specification

## Purpose

Da al SPA la pantalla de entrada del producto: los grupos del usuario, la forma de crear uno o unirse con un código, y el
detalle con sus miembros.

## Requirements

### Requirement: Lista de grupos como inicio

`/grupos` SHALL ser la primera pantalla tras iniciar sesión y mostrar los grupos del usuario con su nombre, su rol y el
número de miembros, recargados cada vez que se entra en la pantalla. SHALL explicar para qué sirve un grupo con la línea
"Un grupo es donde tú y tu círculo juntan las ofertas de empleo que encuentran". Sin grupos SHALL mostrar el estado vacío
"Crea un grupo o únete con un código", con los dos botones correspondientes.

#### Scenario: Estado vacío

- **GIVEN** un usuario con sesión y sin grupos
- **WHEN** abre `/grupos`
- **THEN** SHALL ver la línea que explica qué es un grupo, "Crea un grupo o únete con un código" y los botones de crear y unirse

#### Scenario: Lista con grupos

- **GIVEN** un usuario con dos grupos
- **WHEN** abre `/grupos`
- **THEN** SHALL ver los dos con su nombre, su rol y su número de miembros

#### Scenario: Lista actualizada al volver

- **GIVEN** un usuario que ya vio su lista y a quien después expulsaron de un grupo
- **WHEN** vuelve a `/grupos`
- **THEN** el SPA SHALL pedir la lista de nuevo y NO SHALL mostrar ese grupo

### Requirement: Crear un grupo desde el SPA

La lista SHALL ofrecer crear un grupo pidiendo solo el nombre, validado con las mismas reglas que la API. Al crearlo,
SHALL navegar al detalle del grupo nuevo. Un fallo SHALL mostrarse sin perder el nombre escrito, con el mensaje
"Ya perteneces a 20 grupos, el máximo" para `too_many_groups`.

#### Scenario: Grupo creado

- **GIVEN** un usuario en `/grupos`
- **WHEN** crea el grupo "Backend Bolivia"
- **THEN** el SPA SHALL navegar a `/grupos/:id` de ese grupo y mostrar su nombre

#### Scenario: Límite de grupos

- **WHEN** la creación responde `409` con `too_many_groups`
- **THEN** el SPA SHALL mostrar "Ya perteneces a 20 grupos, el máximo" y conservar el nombre escrito

### Requirement: Unirse con un código desde el SPA

La lista SHALL ofrecer unirse pegando el código, que se envía sin espacios exteriores y en mayúsculas. La ruta
`/unirse?codigo=<código>` SHALL abrir esa misma pantalla con el código ya escrito, SHALL quitar el código de la URL en
cuanto lo lee, para que dentro de la aplicación deje de estar en la URL (con sesión iniciada desde el enlace; antes del
login el código viaja en `returnUrl`, que es inevitable) y SHALL exigir sesión como el resto de rutas
(quien no la tenga vuelve a ella tras iniciar sesión o registrarse). Al unirse, SHALL navegar al detalle del grupo.
`invalid_invite_code` SHALL mostrar "Ese código no corresponde a ningún grupo", `group_full` "Ese grupo ya tiene 50
miembros, el máximo", `too_many_groups` "Ya perteneces a 20 grupos, el máximo" y `too_many_attempts` el mismo mensaje
de demasiados intentos que el resto del SPA: "Demasiados intentos. Vuelve a intentarlo en N minutos", con N tomado de
`Retry-After` en minutos redondeados hacia arriba y el plural correcto, o "Demasiados intentos. Vuelve a intentarlo
más tarde" si la respuesta no trae `Retry-After`; en todos los casos SHALL conservar el código escrito.

#### Scenario: Unirse con un código válido

- **GIVEN** un usuario en `/grupos`
- **WHEN** se une pegando " abcd2345 "
- **THEN** el SPA SHALL enviar `ABCD2345` y navegar al detalle del grupo

#### Scenario: Enlace de invitación

- **GIVEN** un usuario con sesión
- **WHEN** abre `/unirse?codigo=ABCD2345`
- **THEN** SHALL ver el formulario de unirse con `ABCD2345` ya escrito

#### Scenario: Enlace de invitación sin sesión

- **GIVEN** un usuario sin sesión
- **WHEN** abre `/unirse?codigo=ABCD2345` e inicia sesión
- **THEN** SHALL volver a `/unirse?codigo=ABCD2345` con el código escrito

#### Scenario: Enlace de invitación sin cuenta

- **GIVEN** una persona sin cuenta
- **WHEN** abre `/unirse?codigo=ABCD2345`, sigue el enlace a `/registro` y se registra
- **THEN** SHALL volver a `/unirse?codigo=ABCD2345` con el código escrito

#### Scenario: El código no queda en la URL

- **GIVEN** un usuario con sesión
- **WHEN** abre `/unirse?codigo=ABCD2345`
- **THEN** la URL SHALL pasar a `/unirse` sin parámetros y el código SHALL seguir escrito en el formulario

#### Scenario: Código inválido

- **WHEN** la unión responde `404` con `invalid_invite_code`
- **THEN** el SPA SHALL mostrar "Ese código no corresponde a ningún grupo" y conservar el código escrito

#### Scenario: Límite de grupos al unirse

- **WHEN** la unión responde `409` con `too_many_groups`
- **THEN** el SPA SHALL mostrar "Ya perteneces a 20 grupos, el máximo"

#### Scenario: Demasiados intentos al unirse

- **WHEN** la unión responde `429` con `too_many_attempts` y `Retry-After` 540
- **THEN** el SPA SHALL mostrar "Demasiados intentos. Vuelve a intentarlo en 9 minutos" y conservar el código escrito

#### Scenario: Demasiados intentos sin tiempo de espera

- **WHEN** la unión responde `429` con `too_many_attempts` sin cabecera `Retry-After`
- **THEN** el SPA SHALL mostrar "Demasiados intentos. Vuelve a intentarlo más tarde" y conservar el código escrito

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

### Requirement: Acciones del detalle

Salir, expulsar, nombrar propietario y borrar SHALL pedir confirmación antes de llamar a la API; la de borrar SHALL decir a cuántos afecta y cuántas ofertas se pierden, con el
plural correcto y omitiendo la parte de las ofertas cuando el grupo no tiene ninguna: "Se borrará para los N miembros y
se perderán las X ofertas compartidas aquí (las que estén en otros grupos siguen ahí). No se puede deshacer.", con sus
variantes para un solo miembro ("Se borrará solo para ti…"), para una sola oferta ("se perderá 1 oferta") y para ninguna
(el texto sin la parte de ofertas); cuando haya más de un miembro SHALL empezar por "Si solo quieres irte, nombra
propietario a otro miembro y sal del grupo.", antes de ese texto. El recuento SHALL venir del `total` que devuelve el listado de links del grupo, no de los que haya cargados en pantalla. La de nombrar propietario SHALL decir
"«{nombre}» tendrá el rol de propietario de «{grupo}»: podrá renombrarlo, expulsar miembros y borrarlo. Tú seguirás
como miembro y no podrás deshacerlo."; al terminar, el detalle SHALL mostrarse como miembro —sin el código ni las acciones de
owner y con la acción de salir— sin salir de la pantalla. Salir y borrar SHALL navegar a `/grupos` al terminar; expulsar SHALL actualizar la
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
- **THEN** la confirmación SHALL decir "Si solo quieres irte, nombra propietario a otro miembro y sal del grupo. Se borrará para los 3 miembros y se perderán las 37 ofertas compartidas aquí (las que estén en otros grupos siguen ahí). No se puede deshacer."

#### Scenario: Borrado de un grupo en el que estás solo

- **GIVEN** el owner de un grupo con un único miembro
- **WHEN** pulsa borrar
- **THEN** la confirmación SHALL decir "Se borrará solo para ti. No se puede deshacer."

#### Scenario: Expulsar ofrece regenerar el código

- **GIVEN** el owner en el detalle
- **WHEN** expulsa a un miembro y confirma
- **THEN** la lista de miembros SHALL actualizarse sin salir de la pantalla
- **AND** SHALL ofrecer "Regenerar el código para que no pueda volver a entrar"

#### Scenario: Nombrar propietario y salir

- **GIVEN** Ana, owner de "Backend Bolivia", en el detalle con el miembro Beto
- **WHEN** pulsa "Nombrar propietario" sobre Beto y confirma
- **THEN** el detalle SHALL mostrar a Beto como propietario y a Ana como miembro, sin el código de invitación
- **AND** SHALL ofrecer a Ana la acción de salir

#### Scenario: Cancelar la transferencia

- **GIVEN** el owner en el detalle
- **WHEN** pulsa "Nombrar propietario" y cancela la confirmación
- **THEN** el SPA NO SHALL llamar a la API y SHALL seguir siendo owner en pantalla

### Requirement: Textos en español e inglés

Todos los textos visibles de la lista, el detalle, los formularios y los mensajes de error de grupos SHALL estar marcados
para i18n con español como idioma fuente y traducción al inglés.

#### Scenario: Traducciones completas

- **WHEN** se comprueba `messages.en.xlf` tras extraer los mensajes
- **THEN** cada unidad de traducción SHALL tener `target`
