## Purpose

Impide que una URL escrita por una persona haga que LinkVault abra conexiones hacia su propia red interna, hacia
servicios de metadatos del proveedor de nube o hacia cualquier dirección que no sea de Internet pública. Define qué
destinos y puertos se aceptan, cómo se garantiza que la dirección comprobada es la que se conecta, en qué descargas se
aplica y que ninguna configuración lo relaja.

## ADDED Requirements

### Requirement: Solo destinos de Internet pública para las descargas iniciadas por datos de usuario

Toda conexión que el sistema abra hacia una URL que proviene de datos de usuario —la página de una oferta, su
`robots.txt` y cada destino de una redirección de cualquiera de los dos— SHALL pasar por un único filtro de salida. El
filtro SHALL resolver el nombre del host y SHALL rechazar la conexión cuando **cualquiera** de las direcciones resueltas
pertenezca a un rango no público; NO SHALL elegir entre las resueltas la que sí está permitida. Los rangos no públicos
SHALL incluir, como mínimo:

- IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`,
  `192.0.2.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4` (multidifusión)
  y `240.0.0.0/4` (reservado, incluida la difusión `255.255.255.255`);
- IPv6: toda dirección fuera de `2000::/3` (salvo la traducción del punto siguiente), y dentro o fuera de él `::/128`,
  `::1/128`, `::/96` (compatibles con IPv4), `::ffff:0:0/96` (mapeadas a IPv4), `100::/64`, `2001::/23` (asignaciones
  de protocolo de IETF), `2001:db8::/32` y `3fff::/20` (documentación), `fc00::/7` (ULA), `fe80::/10` (enlace local),
  `fec0::/10` y `ff00::/8` (multidifusión);
- en `64:ff9b::/96` y `2002::/16`, la dirección IPv4 que llevan dentro SHALL clasificarse con la lista IPv4.

El filtro SHALL rechazar también, antes de resolver nada, un host que sea un nombre sin punto (tras quitar el punto
final), `localhost` o un subdominio de `localhost`, y un host que sea una dirección literal de un rango no público. El
host SHALL clasificarse como `hostname` sin corchetes (un literal IPv6 se juzga sin ellos). El puerto SHALL decidirse
solo con la clase del host, antes de resolver; en producción SHALL aceptarse solo el puerto por defecto del esquema o
los puertos `80` y `443`, sea cual sea el host. La comprobación SHALL hacerse en el
punto donde el cliente HTTP abre cada conexión, de modo que cubra por igual nombres y direcciones literales en cualquier
salto. La clasificación de direcciones, nombres y puertos SHALL vivir en un solo módulo compartido, sin dependencias de
Node, que usen la API y el worker.

#### Scenario: Nombre que resuelve a una dirección privada

- **GIVEN** una URL cuyo host resuelve a una dirección de `10.0.0.0/8`
- **WHEN** el worker intenta descargarla
- **THEN** NO SHALL abrirse ninguna conexión hacia esa dirección
- **AND** la descarga SHALL terminar con el motivo de destino no permitido

#### Scenario: Una de varias direcciones es interna

- **GIVEN** un host que resuelve a una dirección pública y a una de loopback
- **WHEN** el worker intenta descargarlo
- **THEN** la conexión SHALL rechazarse entera
- **AND** NO SHALL conectarse tampoco a la dirección pública

#### Scenario: Dirección literal de loopback

- **GIVEN** una URL cuyo host es una dirección IPv4 de loopback, escrita en notación decimal con puntos o en una
  notación alternativa que el analizador de URLs normaliza
- **WHEN** el worker intenta descargarla
- **THEN** NO SHALL abrirse ninguna conexión
- **AND** la descarga SHALL terminar con el motivo de destino no permitido

#### Scenario: Redirección seguida hacia una dirección literal interna

- **GIVEN** una página pública que responde con una redirección cuyo destino es una dirección literal de loopback
- **WHEN** el cliente sigue esa redirección
- **THEN** NO SHALL abrirse ninguna conexión hacia la dirección de loopback

#### Scenario: Dirección IPv6 mapeada a IPv4

- **GIVEN** una URL cuyo host es una dirección IPv6 de `::ffff:0:0/96`
- **WHEN** el worker intenta descargarla
- **THEN** NO SHALL abrirse ninguna conexión

#### Scenario: Dirección IPv6 fuera del unicast global

- **GIVEN** un host que resuelve a una dirección IPv6 fuera de `2000::/3` que no es de traducción
- **WHEN** el worker intenta descargarlo
- **THEN** NO SHALL abrirse ninguna conexión

#### Scenario: Nombre sin punto

- **GIVEN** una URL cuyo host es un nombre de una sola etiqueta, con o sin punto final
- **WHEN** el worker intenta descargarla
- **THEN** NO SHALL resolverse el nombre ni abrirse ninguna conexión

#### Scenario: Puerto no web

- **GIVEN** una URL de un host público con un puerto distinto de `80` y `443`
- **WHEN** el worker intenta descargarla
- **THEN** NO SHALL abrirse ninguna conexión
- **AND** la descarga SHALL terminar con el motivo de destino no permitido

#### Scenario: Prefijo de traducción con dirección pública dentro

- **GIVEN** un host que resuelve a una dirección de `64:ff9b::/96` cuya IPv4 interna es pública
- **WHEN** el worker intenta descargarlo
- **THEN** la conexión SHALL permitirse

#### Scenario: Destino público

- **GIVEN** un host que solo resuelve a direcciones públicas
- **WHEN** el worker lo descarga
- **THEN** la descarga SHALL seguir su curso habitual, con su cortesía y sus topes

### Requirement: La dirección comprobada es la que se conecta

El filtro SHALL actuar en el momento de abrir cada conexión, dentro de la resolución de nombres del propio cliente HTTP,
de modo que la conexión se abra **exactamente** contra las direcciones que el filtro aprobó, sin una segunda resolución
del nombre entre la comprobación y la conexión. Un cambio de la respuesta DNS entre dos peticiones al mismo host NO SHALL
poder llevar una conexión a una dirección no comprobada. Ninguna conexión SHALL compartirse entre orígenes distintos.
El cliente HTTP de estas descargas NO SHALL usar un proxy tomado del entorno.

#### Scenario: El DNS cambia de respuesta entre la comprobación y la conexión

- **GIVEN** un nombre cuyo resolvedor responde una dirección permitida la primera vez y una prohibida la segunda
- **WHEN** el worker descarga una URL de ese host
- **THEN** la conexión SHALL abrirse contra la dirección que el filtro aprobó en esa misma resolución
- **AND** NO SHALL abrirse ninguna conexión hacia la dirección prohibida
- **AND** el resolvedor SHALL consultarse una sola vez por conexión

#### Scenario: Un salto posterior resuelve a otra dirección

- **GIVEN** una página que redirige dentro del mismo host
- **AND** un resolvedor que, para la conexión del segundo salto, devuelve una dirección privada
- **WHEN** el worker sigue la redirección
- **THEN** NO SHALL abrirse la conexión del segundo salto
- **AND** la descarga SHALL terminar con el motivo de destino no permitido

#### Scenario: Variable de proxy en el entorno

- **GIVEN** el worker arrancado con una variable de proxy HTTP en su entorno
- **WHEN** descarga una página
- **THEN** la conexión SHALL abrirse directamente contra la dirección aprobada del host, sin pasar por el proxy

### Requirement: El filtro no se relaja por configuración

Ninguna variable de entorno ni opción de configuración SHALL ampliar los destinos, rangos o puertos que acepta el filtro,
en ningún entorno. La política del filtro SHALL ser una interfaz (`EgressPolicy`) con tres decisiones —host, dirección y
puerto— que el código de producción construye siempre con la política pública de este requirement; una política más
permisiva SHALL existir solo en el código de tests, inyectada por constructor o por token.

#### Scenario: Página servida en loopback

- **GIVEN** el worker arrancado con su configuración, en cualquier entorno
- **AND** una página de oferta servida en loopback
- **WHEN** el worker intenta descargarla
- **THEN** NO SHALL abrirse la conexión
- **AND** la descarga SHALL terminar con el motivo de destino no permitido

#### Scenario: Tests con un servidor local

- **GIVEN** un test que inyecta en el guardia una política permisiva para loopback
- **AND** una página servida en loopback en un puerto efímero
- **WHEN** el fetcher la descarga
- **THEN** la descarga SHALL hacerse sobre exactamente una conexión
