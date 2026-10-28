## Purpose

Define la barra de navegación del SPA autenticado: qué entradas ofrece, en qué orden, cuándo oculta las de funciones
que el despliegue no tiene activas y cómo cabe en una sola fila en pantallas estrechas.

## ADDED Requirements

### Requirement: Entradas de la barra

La barra del SPA autenticado SHALL mostrar la marca «LinkVault», que lleva al inicio, y una única lista de entradas en
este orden: «Grupos», «Solo para mí», «Postulaciones», «Mi CV», «Buscar», «Descubrir» y «Perfil», seguida de «Cerrar
sesión». Las dos presentaciones de la barra (ancha y compacta) SHALL salir de esa misma lista.

#### Scenario: Orden de las entradas

- **GIVEN** Ana con sesión en un despliegue con búsqueda y Descubrir activos
- **WHEN** mira la barra en modo ancho
- **THEN** SHALL ver «Grupos», «Solo para mí», «Postulaciones», «Mi CV», «Buscar», «Descubrir» y «Perfil» en ese orden
- **AND** «Cerrar sesión» SHALL ir después de todas ellas

#### Scenario: Grupos lleva al inicio

- **GIVEN** Ana con sesión en el detalle de un grupo
- **WHEN** activa «Grupos»
- **THEN** SHALL llegar a `/grupos`

### Requirement: Entradas según las capacidades del despliegue

El SPA SHALL pedir las capacidades del despliegue una sola vez por carga de la aplicación, compartiendo la petición
entre quienes las necesiten mientras está en curso. «Buscar» SHALL mostrarse solo si `search` es `true` y «Descubrir»
solo si `discovery` es `true`; una entrada de una función apagada NO SHALL mostrarse, ni deshabilitada. Mientras las
capacidades no hayan llegado, esas dos entradas NO SHALL mostrarse. Si la petición falla o su respuesta no valida, las
dos SHALL mostrarse, como si las capacidades no existieran. La barra SHALL exponer el estado de las capacidades
(`loading`, `ready` o `failed`) en su atributo `data-capabilities`.

#### Scenario: Búsqueda y Descubrir apagados

- **GIVEN** las capacidades `{ search: false, discovery: false }`
- **WHEN** Ana mira la barra
- **THEN** NO SHALL ver «Buscar» ni «Descubrir»
- **AND** SHALL ver el resto de entradas

#### Scenario: Solo Descubrir activo

- **GIVEN** las capacidades `{ search: false, discovery: true }`
- **WHEN** Ana mira la barra
- **THEN** SHALL ver «Descubrir» y NO SHALL ver «Buscar»

#### Scenario: Capacidades aún sin respuesta

- **GIVEN** la petición de capacidades en curso
- **WHEN** Ana mira la barra
- **THEN** NO SHALL ver «Buscar» ni «Descubrir»
- **AND** la barra SHALL tener `data-capabilities="loading"`

#### Scenario: Capacidades recibidas

- **GIVEN** la petición de capacidades respondió `200` con un cuerpo válido
- **WHEN** Ana mira la barra
- **THEN** la barra SHALL tener `data-capabilities="ready"`

#### Scenario: Falla la petición de capacidades

- **GIVEN** la petición de capacidades responde `500` o con un cuerpo que no valida
- **WHEN** Ana mira la barra
- **THEN** SHALL ver «Buscar» y «Descubrir»
- **AND** la barra SHALL tener `data-capabilities="failed"`

#### Scenario: Una sola petición por carga

- **GIVEN** la barra y la página de búsqueda piden las capacidades a la vez
- **WHEN** se completa la carga
- **THEN** el SPA SHALL haber hecho una sola petición a `GET /api/capabilities`

### Requirement: Barra compacta en pantallas estrechas

Por debajo de 1024 px de ancho la barra SHALL ocupar una sola fila con la marca y un botón «Menú», y NO SHALL mostrar
las entradas en la fila; el modo SHALL ser el correcto desde el primer render. El botón SHALL indicar con
`aria-expanded` si el panel está abierto y SHALL apuntar con `aria-controls` a un `<nav>` con nombre accesible
«Navegación principal» que SHALL existir siempre en ese modo, oculto mientras está cerrado. Al abrirlo, el `<nav>`
SHALL desplegarse bajo la barra con las mismas entradas visibles que el modo ancho, como enlaces, y «Cerrar sesión» al
final. El panel SHALL cerrarse al completarse una navegación (con el foco en el contenido principal), al volver a
pulsar el botón y con Escape (con el foco en el botón), y al pasar a modo ancho. Escape SHALL atenderse solo con el
panel abierto y dentro de la cabecera. Desde 1024 px la barra SHALL mostrar las entradas en la fila y NO SHALL mostrar
el botón «Menú».

#### Scenario: Móvil, panel cerrado

- **GIVEN** Ana con sesión en una pantalla de 412 px
- **WHEN** abre `/grupos`
- **THEN** la barra SHALL mostrar la marca y el botón «Menú» con `aria-expanded="false"`
- **AND** el elemento al que apunta `aria-controls` SHALL existir y estar oculto
- **AND** NO SHALL mostrar «Postulaciones» ni ninguna otra entrada fuera del panel

#### Scenario: Primer render en el móvil

- **GIVEN** una pantalla de 412 px
- **WHEN** el Shell se renderiza por primera vez
- **THEN** SHALL estar ya en modo compacto, sin un render previo con las entradas en la fila

#### Scenario: Abrir el panel y navegar

- **GIVEN** Ana en una pantalla de 412 px con el panel cerrado
- **WHEN** pulsa «Menú» y luego el enlace «Mi CV»
- **THEN** el botón SHALL haber pasado a `aria-expanded="true"` y el panel SHALL haber mostrado «Mi CV» como enlace
- **AND** al llegar a `/mi-cv` el panel SHALL cerrarse
- **AND** el foco SHALL quedar en el contenido principal

#### Scenario: Cerrar con Escape

- **GIVEN** el panel abierto
- **WHEN** Ana pulsa Escape dentro de la cabecera
- **THEN** el panel SHALL cerrarse
- **AND** el foco SHALL quedar en el botón «Menú»

#### Scenario: Escape fuera del panel

- **GIVEN** el panel cerrado, o un Escape pulsado fuera de la cabecera
- **WHEN** Ana pulsa Escape
- **THEN** la barra NO SHALL cambiar el estado del panel ni mover el foco

#### Scenario: Pasar a modo ancho con el panel abierto

- **GIVEN** el panel abierto en una pantalla estrecha
- **WHEN** la pantalla pasa a 1024 px o más
- **THEN** el panel SHALL cerrarse y la barra SHALL mostrar las entradas en la fila

#### Scenario: El panel respeta las capacidades

- **GIVEN** las capacidades `{ search: false, discovery: false }` y una pantalla de 412 px
- **WHEN** Ana abre el panel
- **THEN** NO SHALL ver «Buscar» ni «Descubrir»

#### Scenario: Escritorio

- **GIVEN** Ana con sesión en una pantalla de 1280 px
- **WHEN** mira la barra
- **THEN** SHALL ver las entradas en la fila
- **AND** NO SHALL ver el botón «Menú»

### Requirement: Textos de la barra en español e inglés

Los textos nuevos de la barra («Grupos», «Menú» y el nombre accesible «Navegación principal») SHALL existir en español
(por defecto) y en inglés en el catálogo del SPA, con el catálogo fuente regenerado por la extracción.

#### Scenario: Barra en inglés

- **GIVEN** la interfaz en inglés
- **WHEN** Ana mira la barra compacta
- **THEN** SHALL ver «Groups» y «Menu» en inglés
