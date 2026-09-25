# web/i18n Specification

## Purpose

Garantiza que el catálogo de traducciones del SPA se deriva siempre de sus fuentes (plantillas y `$localize`) y que su
traducción inglesa está completa y al día respecto al texto español. Así quien desarrolla puede fiarse del catálogo inglés
sin revisarlo a mano, y ninguna desviación entre fuentes, catálogo y traducción pasa sin que una comprobación automática la
detecte.

## Requirements

### Requirement: El catálogo fuente es la salida de la extracción

El catálogo fuente versionado del SPA (`apps/web/src/locale/messages.xlf`) SHALL ser, byte a byte, la salida de la
extracción de mensajes sobre las fuentes vigentes: los textos marcados para i18n en plantillas y los de `$localize` en
código. La comprobación del catálogo SHALL reproducir la extracción sin modificar ningún fichero versionado, y SHALL fallar
si su resultado difiere del catálogo fuente. Al fallar, SHALL indicar el comando que regenera el catálogo y SHALL clasificar
la diferencia en: unidades nuevas, unidades eliminadas, unidades cuyo texto cambió, o sin cambios de unidades (mismas
unidades con el mismo texto; difieren ubicación, orden o formato). SHALL nombrar los identificadores de las tres primeras
clases. La comprobación SHALL dar el mismo veredicto en Windows y en el runner Linux de CI.

#### Scenario: Catálogo al día

- **GIVEN** un catálogo fuente regenerado con la extracción tras el último cambio de fuentes
- **WHEN** se ejecuta la comprobación del catálogo
- **THEN** SHALL pasar
- **AND** ningún fichero versionado SHALL haber cambiado

#### Scenario: Texto nuevo sin extraer

- **GIVEN** una plantilla con un texto nuevo marcado para i18n con el identificador `profile.byok.newHint`
- **AND** un catálogo fuente sin ese identificador
- **WHEN** se ejecuta la comprobación del catálogo
- **THEN** SHALL fallar nombrando `profile.byok.newHint` como unidad nueva
- **AND** SHALL indicar el comando que regenera el catálogo

#### Scenario: Texto nuevo en código sin extraer

- **GIVEN** un aviso nuevo escrito con `$localize` y el identificador `links.snack.newNotice`
- **AND** un catálogo fuente sin ese identificador
- **WHEN** se ejecuta la comprobación del catálogo
- **THEN** SHALL fallar nombrando `links.snack.newNotice` como unidad nueva

#### Scenario: Texto español cambiado sin extraer

- **GIVEN** una plantilla cuyo texto con el identificador `discovery.submit` cambió de «Buscar» a «Buscar vacantes»
- **WHEN** se ejecuta la comprobación del catálogo sin haber re-extraído
- **THEN** SHALL fallar nombrando `discovery.submit` como unidad con texto cambiado

#### Scenario: Solo se movieron líneas

- **GIVEN** una plantilla en la que se insertaron líneas encima de textos ya extraídos, sin cambiar ningún texto
- **WHEN** se ejecuta la comprobación del catálogo sin haber re-extraído
- **THEN** SHALL fallar indicando que no hay cambios de unidades
- **AND** NO SHALL listar ninguna unidad como nueva, eliminada o con texto cambiado

#### Scenario: Catálogo editado a mano

- **GIVEN** un catálogo fuente con el texto de una unidad recortado a mano respecto al de su plantilla
- **WHEN** se ejecuta la comprobación del catálogo
- **THEN** SHALL fallar nombrando esa unidad como unidad con texto cambiado

### Requirement: Traducción inglesa completa

El catálogo inglés (`apps/web/src/locale/messages.en.xlf`) SHALL contener exactamente las mismas unidades que el catálogo
fuente, y cada una SHALL tener traducción.

#### Scenario: Unidad sin traducir

- **GIVEN** un catálogo fuente con la unidad `profile.byok.newHint`
- **AND** un catálogo inglés sin esa unidad
- **WHEN** se ejecutan las pruebas de traducciones
- **THEN** SHALL fallar nombrando la diferencia de unidades

#### Scenario: Unidad huérfana en inglés

- **GIVEN** un catálogo inglés con una unidad que ya no existe en el catálogo fuente
- **WHEN** se ejecutan las pruebas de traducciones
- **THEN** SHALL fallar nombrando la diferencia de unidades

### Requirement: Traducción inglesa vigente

Para cada unidad, el texto español que el catálogo inglés guarda como original SHALL coincidir con el texto de esa unidad
en el catálogo fuente, sin contar diferencias de espacios en blanco. Cambiar el texto español de una unidad SHALL obligar a
actualizar ese original en el mismo cambio, de modo que la traducción de esa unidad aparezca en el diff que se revisa.

#### Scenario: Texto español cambiado sin revisar la traducción

- **GIVEN** la unidad `discovery.submit` con el texto «Buscar vacantes» en el catálogo fuente
- **AND** el catálogo inglés con el original «Buscar» y la traducción «Search»
- **WHEN** se ejecutan las pruebas de traducciones
- **THEN** SHALL fallar nombrando `discovery.submit`

#### Scenario: Solo cambian espacios

- **GIVEN** la unidad `discovery.submit` con el texto « Buscar » en el catálogo fuente
- **AND** el catálogo inglés con el original «Buscar»
- **WHEN** se ejecutan las pruebas de traducciones
- **THEN** SHALL pasar
