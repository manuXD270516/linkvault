# web/byok Specification

## Purpose

En el perfil, la persona gestiona sus claves de IA propias: las pega, ve un hint, las rota o las revoca, y entiende con claridad cuándo el CV puede salir a un vendor y cuándo las claves están guardadas pero inactivas.

## Requirements

### Requirement: Gestión de claves en perfil

`/perfil` SHALL ofrecer, para cada vendor soportado, estado configurado/no configurado, acción de guardar o rotar (input de clave, sin echo), hint visible si hay clave, y acción de revocar con confirmación. Tras guardar o revocar, la UI SHALL reflejar el listado del API sin mostrar la clave completa.

#### Scenario: Guarda OpenAI

- **GIVEN** Ana en `/perfil` sin clave OpenAI
- **WHEN** pega una clave y guarda
- **THEN** ve el hint y el vendor como configurado
- **AND** el valor pegado ya no aparece en el campo

#### Scenario: Revoca

- **GIVEN** Ana con Anthropic configurado
- **WHEN** confirma la revocación
- **THEN** ese vendor pasa a no configurado

### Requirement: Aviso de destino del dato

Junto al formulario BYOK, la UI SHALL mostrar un aviso que nombre el vendor y diga que, con el permiso de IA externa vigente, texto del CV y de la oferta puede salir hacia ese proveedor. Si el vendor es OpenRouter y el modelo de entorno no termina en `:free`, el aviso SHALL indicar además que LinkVault no fuerza `data_collection: deny` en ese caso.

Cuando un vendor **no tiene configuración utilizable** —la que permite construir su proveedor, según «Inyección BYOK en runTask» de `ai/byok`; hoy, OpenRouter sin modelo utilizable—, la UI SHALL mostrar un **aviso de indisponibilidad de ese vendor**, distinto del aviso de política de datos. Son dos estados distintos y NO SHALL confundirse: «no forzamos `data_collection: deny`» describe un vendor que **sí** se usa con una política más laxa; la indisponibilidad describe un vendor que **no se usa en absoluto**. Con un vendor sin configuración utilizable, la UI NO SHALL mostrar para él el aviso de `data_collection`, porque afirmaría un envío que no va a ocurrir.

El aviso de indisponibilidad SHALL decir, en este orden: que ese vendor no está disponible ahora mismo por la configuración de la instancia; que la clave guardada **sigue guardada y cifrada** y no se ha borrado; que **no se usará** para ninguna tarea mientras dure esa situación, ni siquiera con el permiso de IA externa vigente; y qué puede hacer la persona: **configurar o usar otro vendor** de los soportados, o **pedir a quien administra la instancia** que configure el modelo de ese vendor. NO SHALL pedir a la persona que cambie su clave ni sugerir que el problema está en ella.

La UI SHALL tomar ese estado del campo de disponibilidad que devuelve el API de claves —presente para **cada vendor soportado, tenga o no clave guardada**, según «Guardar y revocar una clave por vendor» de `ai/byok`— y NO SHALL deducirlo de tener clave guardada ni de reglas escritas en el cliente, para que no pueda decir «disponible» sobre un proveedor que el servidor no construye.

La indisponibilidad SHALL presentarse **por vendor**: los demás vendors SHALL seguir mostrando su aviso de destino del dato con normalidad y NO SHALL presentarse como indisponibles.

#### Scenario: Ve el aviso al configurar

- **GIVEN** Ana en la sección de claves
- **WHEN** mira el formulario de un vendor
- **THEN** lee el aviso de destino del dato con el nombre del vendor

#### Scenario: OpenRouter sin sufijo free

- **GIVEN** el modelo de entorno de OpenRouter BYOK no termina en `:free`
- **WHEN** Ana mira el formulario de OpenRouter
- **THEN** el aviso SHALL decir que LinkVault no fuerza `data_collection: deny` en ese caso

#### Scenario: Vendor sin configuración utilizable

- **GIVEN** el API informa de que OpenRouter no tiene configuración utilizable y Ana tiene su clave guardada
- **WHEN** Ana mira el formulario de OpenRouter
- **THEN** SHALL leer un aviso de que ese vendor no está disponible por la configuración de la instancia
- **AND** SHALL leer que su clave sigue guardada y cifrada y que no se usará mientras dure
- **AND** SHALL leer que puede usar otro vendor soportado o pedir a quien administra la instancia que configure el modelo

#### Scenario: Los dos avisos no se confunden

- **GIVEN** el mismo vendor indisponible por configuración
- **WHEN** Ana mira su formulario
- **THEN** NO SHALL mostrarse para él el aviso de que LinkVault no fuerza `data_collection: deny`
- **AND** con un vendor con modelo utilizable que no termina en `:free`, SHALL mostrarse el aviso de `data_collection` y NO el de indisponibilidad

#### Scenario: La indisponibilidad es de un vendor, no de todos

- **GIVEN** Ana con claves de OpenRouter, OpenAI y Anthropic, y solo OpenRouter sin configuración utilizable
- **WHEN** abre la sección de claves
- **THEN** solo OpenRouter SHALL mostrar el aviso de indisponibilidad
- **AND** OpenAI y Anthropic SHALL mostrar su aviso de destino del dato con normalidad

### Requirement: Claves guardadas con consentimiento off

Si hay al menos un `keyHint` y el consentimiento externo no está vigente, la UI SHALL decir con claridad que las claves siguen guardadas pero **no se usan** hasta que vuelva a dar el permiso (y que revocar el permiso no las borró).

Ese aviso y el **aviso de indisponibilidad** de «Aviso de destino del dato» pueden aplicar al mismo vendor a la vez, y entonces se desmienten: «no se usan hasta que vuelvas a dar el permiso» es **literalmente falso** para un vendor sin configuración utilizable, porque dar el permiso no lo activa. Por tanto SHALL regir esta **precedencia, vendor a vendor**:

- Para un vendor **sin configuración utilizable**, el aviso de indisponibilidad SHALL **sustituir** al de consentimiento apagado. La UI NO SHALL mostrar los dos a la vez sobre ese vendor, y NO SHALL prometerle a la persona que ese vendor se activará al restaurar el permiso.
- Para los **demás** vendors, el aviso de consentimiento apagado SHALL seguir aplicando con normalidad, con su texto íntegro, aunque otro vendor esté indisponible.
- La precedencia NO SHALL leerse como que la indisponibilidad borra la información de que la clave sigue guardada: el propio aviso de indisponibilidad ya SHALL decir que la clave sigue guardada y cifrada.

#### Scenario: Consentimiento retirado con hint visible

- **GIVEN** Ana con OpenAI configurado y consentimiento revocado
- **WHEN** abre `/perfil`
- **THEN** ve el hint del vendor
- **AND** lee que las claves no se usan mientras el permiso esté off

#### Scenario: Vendor indisponible con el consentimiento apagado

- **GIVEN** Ana con claves de OpenRouter y OpenAI, el consentimiento externo revocado y OpenRouter sin configuración utilizable
- **WHEN** abre `/perfil`
- **THEN** OpenRouter SHALL mostrar solo el aviso de indisponibilidad, no el de consentimiento apagado
- **AND** NO SHALL decirse sobre OpenRouter que se usará cuando vuelva a dar el permiso
- **AND** OpenAI SHALL mostrar el aviso de consentimiento apagado con normalidad
- **AND** SHALL seguir leyéndose que la clave de OpenRouter sigue guardada y cifrada
