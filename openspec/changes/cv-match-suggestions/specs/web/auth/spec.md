## MODIFIED Requirements

### Requirement: Perfil, cambio de contraseña y logout

El SPA SHALL ofrecer `/perfil` con el email en solo lectura, `displayName` editable y un formulario de cambio de
contraseña ("Contraseña actual" y "Nueva contraseña", con mostrar u ocultar), y un botón de cerrar sesión visible en las
rutas autenticadas. Tras cambiar la contraseña SHALL mostrar "Contraseña cambiada. Cerramos tu sesión en los demás
dispositivos." y continuar con la sesión actual, renovando el access token en la petición siguiente. Los errores del cambio
de contraseña SHALL mostrarse así: `invalid_credentials` → "La contraseña actual no es correcta"; `too_many_attempts` → el
mismo mensaje de demasiados intentos del login; `400` → "La nueva contraseña debe tener al menos 10 caracteres y no puede ser
tu email"; y "Nueva contraseña" SHALL mostrar la pista "Mínimo 10 caracteres". Cerrar sesión SHALL llamar a logout, borrar la sesión local y navegar a
`/login` aunque la llamada falle.

`/perfil` SHALL mostrar además una sección **"IA y privacidad"** con los tres controles que alimentan el contexto de los
análisis. Cada uno SHALL guardarse con `PATCH /api/users/me` enviando **solo su campo**, SHALL aplicarse al responder y,
si la API falla, SHALL volver al valor anterior mostrando el error. Ninguno SHALL pedir confirmación y ninguno SHALL
mostrar ni enviar texto del CV.

1. **Consentimiento para proveedores externos** (`aiConsent.externalProviders`): un interruptor rotulado "Permitir que
   un proveedor de IA externo analice mi CV", acompañado siempre —sin desplegar nada— del texto honesto, que SHALL
   decir las cuatro cosas: **qué se envía** ("el texto de tu CV y la descripción de la oferta"), **a quién** (el
   proveedor externo que lo recibiría, hoy OpenRouter), **qué se sustituye antes de enviarlo** (email, teléfonos,
   dirección, documento de identidad y URL, por marcadores) y **que se puede quitar cuando quieras**. SHALL añadir qué
   pasa sin él: "Sin este permiso, tu CV se analiza dentro de LinkVault o recibes un análisis básico." El texto NO SHALL
   prometer nada que LinkVault no pueda comprobar, en particular que el proveedor externo no conserve lo enviado, ni que
   lo enviado vaya anónimo, ni que se pedirá permiso en el momento del análisis.
   - **Activar** SHALL enviar, junto al valor, la **versión del texto que el SPA mostró**, y NUNCA una versión que no
     mostró. Con el permiso activo, la pantalla SHALL mostrar la fecha en que se concedió y la versión aceptada. Si el
     perfil devuelve una versión distinta de la mostrada, el SPA NO SHALL cambiar el estado del interruptor por su
     cuenta.
   - **Revocar** SHALL poder hacerse en cualquier momento, en un clic, y SHALL confirmar con "Permiso retirado. Tus
     próximos análisis no saldrán de LinkVault." NO SHALL afirmar que se borra lo ya enviado a un tercero.
2. **Idioma de los análisis de IA** (`outputLanguage`): un selector con exactamente esa etiqueta, con "Español" e
   "Inglés" como opciones. Cambiarlo NO SHALL cambiar el idioma de la interfaz, y la pantalla SHALL decirlo.
3. **Redacción del nombre propio** (`redactName`): un interruptor rotulado "Ocultar mi nombre a los proveedores
   externos", con el texto "Sustituimos tu nombre por un marcador antes de enviar el texto." SHALL seguir visible y
   editable aunque el consentimiento esté desactivado, indicando que solo tiene efecto cuando se usa un proveedor
   externo.

#### Scenario: Guardar el nombre

- **GIVEN** un usuario en `/perfil`
- **WHEN** cambia `displayName` y guarda
- **THEN** el SPA SHALL enviar `PATCH /api/users/me` solo con `displayName` y mostrar el perfil devuelto

#### Scenario: Cambiar la contraseña

- **GIVEN** un usuario en `/perfil`
- **WHEN** envía la contraseña actual correcta y una nueva válida
- **THEN** el SPA SHALL mostrar "Contraseña cambiada. Cerramos tu sesión en los demás dispositivos." y seguir en `/perfil` con sesión
- **AND** la siguiente petición a `/api` SHALL completarse tras un único refresh

#### Scenario: Contraseña actual incorrecta en el perfil

- **WHEN** el cambio de contraseña responde `401` con `invalid_credentials`
- **THEN** el formulario SHALL mostrar "La contraseña actual no es correcta"

#### Scenario: Logout con red caída

- **GIVEN** un usuario con sesión y la API inaccesible
- **WHEN** pulsa cerrar sesión
- **THEN** el SPA SHALL navegar a `/login` sin sesión local

#### Scenario: El texto dice qué se envía y a quién

- **GIVEN** Ana en `/perfil` con el consentimiento desactivado
- **WHEN** mira la sección "IA y privacidad"
- **THEN** SHALL leer, sin desplegar nada, qué se envía, a qué proveedor externo, qué se sustituye antes y que puede
  quitarlo cuando quiera
- **AND** SHALL leer qué ocurre si no lo da

#### Scenario: Dar el permiso deja constancia

- **GIVEN** Ana con `aiConsent.externalProviders` `false`
- **WHEN** activa el interruptor
- **THEN** el SPA SHALL enviar `PATCH /api/users/me` solo con el consentimiento y la versión del texto que mostró
- **AND** al responder SHALL verse la fecha de concesión y esa versión

#### Scenario: Quitar el permiso en un clic

- **GIVEN** Ana con el consentimiento activo
- **WHEN** desactiva el interruptor
- **THEN** NO SHALL pedirse ninguna confirmación y SHALL verse "Permiso retirado. Tus próximos análisis no saldrán de
  LinkVault."
- **AND** el mensaje NO SHALL decir que se borra lo ya enviado

#### Scenario: El texto cambió después de aceptarlo

- **GIVEN** Ana con el consentimiento activo, aceptado sobre una versión anterior del texto
- **WHEN** abre `/perfil` y el SPA muestra la versión vigente
- **THEN** la pantalla SHALL avisar de que el texto cambió y de que **ese permiso ya no está en vigor**, pidiéndole que
  lo lea y lo acepte de nuevo
- **AND** NO SHALL presentar el permiso como activo, porque un consentimiento sobre una versión anterior no autoriza
  ningún envío a un proveedor externo
- **AND** SHALL mostrar la fecha y la versión que ella aceptó, para que sepa a qué dijo que sí
- **AND** el SPA NO SHALL enviar ningún consentimiento sin que ella lo pida

#### Scenario: El idioma de los análisis no es el de la pantalla

- **GIVEN** Ana con la interfaz en español
- **WHEN** elige "Inglés" en "Idioma de los análisis de IA"
- **THEN** el SPA SHALL enviar solo `outputLanguage`
- **AND** la interfaz SHALL seguir en español

#### Scenario: Ocultar el nombre sin haber dado el permiso

- **GIVEN** Ana con el consentimiento desactivado
- **WHEN** mira el control de ocultar su nombre
- **THEN** SHALL poder activarlo
- **AND** SHALL leer que solo tiene efecto cuando se usa un proveedor externo

#### Scenario: La API falla al guardar un control de IA

- **GIVEN** la API devolviendo `500`
- **WHEN** Ana activa el consentimiento
- **THEN** el interruptor SHALL volver a desactivado y SHALL verse el error

### Requirement: Textos en español e inglés

Todos los textos visibles de login, registro, perfil y mensajes de error SHALL estar marcados para i18n con
español como idioma fuente y traducción al inglés. El texto del consentimiento y los rótulos de los tres controles de IA
SHALL estar entre ellos. El texto del consentimiento SHALL ser **una sola unidad de traducción por idioma**, NO SHALL
componerse concatenando trozos, y su **versión SHALL identificar el contenido, no el idioma**: cambiar la redacción en
español o en inglés SHALL exigir una versión nueva.

#### Scenario: Traducciones completas

- **WHEN** se comprueba `messages.en.xlf` tras extraer los mensajes
- **THEN** cada unidad de traducción SHALL tener `target`

#### Scenario: El consentimiento se traduce entero

- **WHEN** se revisan los mensajes de la sección "IA y privacidad"
- **THEN** el texto del consentimiento SHALL ser una única unidad de traducción con su versión en inglés
- **AND** NO SHALL construirse uniendo varias unidades

#### Scenario: Reescribir el texto en inglés obliga a versionar

- **GIVEN** un texto de consentimiento en su versión vigente
- **WHEN** se cambia solo su redacción en inglés
- **THEN** SHALL publicarse con una versión nueva
