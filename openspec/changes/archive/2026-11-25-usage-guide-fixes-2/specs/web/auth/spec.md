## ADDED Requirements

### Requirement: Los avisos del cambio de contraseña no se acumulan

El formulario "Cambiar la contraseña" de `/perfil` SHALL mostrar solo el resultado del **último** intento. Cada
intento —también el que el propio SPA rechaza sin llamar a la API porque un campo no es válido— SHALL borrar antes el
aviso de la API y la confirmación del intento anterior ("La contraseña actual no es correcta", "Contraseña cambiada…"
o el error genérico). Editar los campos sin volver a enviar NO SHALL borrarlo.

Los errores de "Contraseña actual" y "Nueva contraseña" SHALL ocupar el alto que necesiten y empujar lo que viene
detrás (subíndice dinámico de Angular Material, `subscriptSizing="dynamic"`): un error de dos líneas NO SHALL montarse
sobre otro texto.

#### Scenario: Un intento inválido borra el aviso del anterior

- **GIVEN** Ana en `/perfil` que intentó cambiar la contraseña con la actual equivocada y ve "La contraseña actual no
  es correcta"
- **WHEN** escribe la actual correcta y una nueva demasiado corta, y pulsa "Cambiar contraseña"
- **THEN** SHALL ver "La nueva contraseña debe tener al menos 10 caracteres y no puede ser tu email"
- **AND** NO SHALL ver "La contraseña actual no es correcta"
- **AND** el SPA NO SHALL haber llamado a la API en ese intento

#### Scenario: Un cambio anterior no convive con un error nuevo

- **GIVEN** Ana que acaba de ver "Contraseña cambiada. Cerramos tu sesión en los demás dispositivos."
- **WHEN** vuelve a enviar el formulario con la contraseña actual vacía
- **THEN** NO SHALL ver "Contraseña cambiada…"
- **AND** SHALL ver el error del campo "Contraseña actual"

#### Scenario: Escribir no borra el aviso

- **GIVEN** Ana que ve "La contraseña actual no es correcta"
- **WHEN** cambia el texto de "Contraseña actual" sin enviar
- **THEN** el aviso SHALL seguir visible hasta el siguiente envío

#### Scenario: El error largo no se monta sobre otro texto

- **GIVEN** Ana en `/perfil`
- **WHEN** el campo "Nueva contraseña" muestra su error de longitud
- **THEN** el subíndice de los campos "Contraseña actual" y "Nueva contraseña" SHALL ser dinámico
- **AND** lo que viene detrás del campo SHALL quedar debajo del error, no encima
