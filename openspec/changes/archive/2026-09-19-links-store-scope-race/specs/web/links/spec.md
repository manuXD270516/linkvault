## ADDED Requirements

### Requirement: La lista mostrada es la del ámbito abierto

La lista de links SHALL mostrar solo respuestas pedidas para el ámbito abierto (un grupo o `/mis-links`) y por la
última carga de esa lista. Una respuesta, un error o una página siguiente que llegue después de que el usuario cambie de
lista, la lista se cierre o se recargue SHALL descartarse sin tocar lo que se ve. La tarjeta devuelta por una edición
pedida desde otra lista SHALL no reemplazar a la de la lista abierta.

#### Scenario: Cambio rápido de grupo

- **GIVEN** un miembro de los grupos A y B
- **WHEN** abre el grupo A y, antes de que llegue su lista, abre el grupo B
- **AND** la lista de A llega antes que la de B
- **THEN** el grupo B SHALL no mostrar en ningún momento los links de A y SHALL seguir cargando
- **AND** al llegar la de B SHALL mostrar solo los links de B

#### Scenario: La lista vieja llega la última

- **GIVEN** un miembro que abre el grupo A y luego el grupo B
- **WHEN** la lista de B llega antes que la de A
- **THEN** el grupo B SHALL seguir mostrando solo los links de B

#### Scenario: Error tardío de otro grupo

- **GIVEN** un miembro que abre el grupo A y luego el grupo B
- **WHEN** la lista de A falla después de abrir B
- **THEN** el grupo B SHALL no mostrar ningún error y SHALL seguir cargando hasta que llegue su lista

#### Scenario: La lista abierta falla

- **GIVEN** un miembro que abre el grupo B
- **WHEN** la carga de la lista de B falla
- **THEN** el grupo B SHALL mostrar el error y dejar de cargar

#### Scenario: Salir del grupo antes de pedir su lista

- **GIVEN** un miembro que entra en el detalle del grupo A
- **WHEN** sale de la pantalla antes de que se sepa que el grupo existe
- **THEN** SHALL no pedirse la lista de A
- **AND** la pantalla siguiente SHALL no mostrar los links de A

#### Scenario: Página siguiente de otro grupo

- **GIVEN** un miembro que pidió "cargar más" en el grupo A
- **WHEN** abre el grupo B antes de que llegue esa página
- **THEN** la página de A SHALL no añadirse a la lista de B
- **AND** "cargar más" SHALL no quedar en curso en B

#### Scenario: Página siguiente de una lista recargada

- **GIVEN** un miembro que pidió "cargar más" en un grupo
- **WHEN** la lista se recarga (por ejemplo, al volver el foco a la pestaña) antes de que llegue esa página
- **THEN** la lista SHALL quedarse con la primera página recargada, sin links repetidos

#### Scenario: Lista cerrada antes de que llegue

- **GIVEN** un miembro que abre un grupo
- **WHEN** la lista se cierra (al entrar en el detalle de otro grupo) antes de que llegue su respuesta
- **THEN** la lista SHALL seguir vacía y sin carga en curso al llegar la respuesta

#### Scenario: Dos recargas de la misma lista

- **GIVEN** una lista con dos recargas en vuelo (por ejemplo, tras guardar y al volver el foco a la pestaña)
- **WHEN** la primera responde después de la segunda
- **THEN** la lista SHALL quedarse con la respuesta de la segunda

#### Scenario: Guardar, importar o quitar terminado en otra lista

- **GIVEN** un miembro que guarda un link, pega un chat o quita un link en el grupo A
- **WHEN** abre el grupo B antes de que responda la acción
- **THEN** el grupo B SHALL no recargarse por ella ni mostrar el contador de lecturas de esa importación
- **AND** lo guardado o importado SHALL quedar en el grupo A y verse al volver a él

#### Scenario: La acción responde tras volver a la lista

- **GIVEN** un miembro que pega un chat en el grupo A, abre el grupo B y vuelve al grupo A
- **WHEN** la importación responde con A abierto de nuevo
- **THEN** la lista de A SHALL recargarse y mostrar el contador de lecturas de esa importación

#### Scenario: Importación cuya recarga falla

- **GIVEN** un miembro que pega un chat en un grupo
- **WHEN** la importación responde pero la recarga de la lista falla
- **THEN** la lista SHALL mostrar el error y SHALL no mostrar un contador de lecturas que no avanzaría

#### Scenario: Edición que responde en otra lista

- **GIVEN** un link compartido en los grupos A y B, editado desde el grupo A
- **WHEN** el miembro abre el grupo B antes de que responda la edición
- **THEN** la tarjeta de ese link en B SHALL seguir mostrando quién lo compartió en B
- **AND** la corrección SHALL verse en la siguiente recarga de B o al volver a A
