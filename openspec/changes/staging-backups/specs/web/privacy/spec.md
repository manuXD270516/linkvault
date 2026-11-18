## MODIFIED Requirements

### Requirement: Ruta pública de aviso de privacidad

El SPA SHALL exponer la ruta pública `/privacidad` (sin exigir sesión) con un aviso que explique, en lenguaje claro al
menos: qué se guarda del CV y dónde; la política de retención aplicable (o que el detalle de prod se documenta según
configuración); el uso de IA / OpenRouter / BYOK y el consentimiento; cómo borrar la cuenta; y las **copias de
seguridad**, en cuatro puntos:

1. existen copias de seguridad **cifradas con una clave propia**, guardadas **fuera del servidor** en servicios de
   almacenamiento de terceros (la categoría, sin nombrar cuentas);
2. lo que se borra desaparece **de inmediato de la aplicación** y **de las copias en un plazo máximo de N semanas**, el
   que documenta el respaldo (`platform/backups`), y ese plazo **no se puede acelerar**;
3. si hubiera que recuperar el servicio desde una copia, se **pueden perder los cambios de las últimas 24 horas**;
4. algo borrado justo antes de una recuperación **puede volver**, y en ese caso el responsable del servicio lo vuelve
   a borrar.

El aviso NO SHALL inventar garantías que el entorno actual no cumpla; cuando la configuración de producción tenga
cifrado en reposo y/o retención documentados, `/privacidad` MAY afirmarlos. NO SHALL afirmar que un dato borrado
desaparece de inmediato de todas partes.

#### Scenario: Abrir /privacidad sin sesión

- **GIVEN** una persona sin sesión
- **WHEN** abre `/privacidad`
- **THEN** SHALL ver el aviso de privacidad
- **AND** NO SHALL redirigirse a `/login`

#### Scenario: El aviso cubre los temas obligatorios

- **WHEN** se revisa el contenido de `/privacidad`
- **THEN** SHALL mencionar almacenamiento de CV, retención, IA/OpenRouter/BYOK y borrado de cuenta
- **AND** NO SHALL afirmar cifrado en reposo ni caducidad automática del CV si el entorno documentado no los tiene

#### Scenario: El aviso explica las copias de seguridad

- **WHEN** se revisa la sección de copias de `/privacidad`
- **THEN** SHALL decir que hay copias cifradas fuera del servidor
- **AND** SHALL dar el plazo máximo en semanas documentado por el respaldo y que no se puede acelerar
- **AND** SHALL decir que se pueden perder las últimas 24 horas y que algo borrado justo antes de una recuperación puede
  volver
