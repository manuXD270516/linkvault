## MODIFIED Requirements

### Requirement: Restauración de la sesión al cargar

Al arrancar, antes de resolver la primera navegación, el SPA SHALL mostrar "Conectando…" e intentar un refresh durante como
máximo 10 segundos; si responde `200`, SHALL restaurar la sesión sin pedir credenciales, y si falla o se agota el tiempo
SHALL continuar sin sesión, cancelar los reintentos pendientes y NO SHALL llamar a logout.

Si la persona recarga o navega con una carga completa mientras el refresh de la restauración está en vuelo, y la API
llegó a rotar el refresh token sin que el navegador recibiera la respuesta, la carga siguiente dentro de los 10 segundos
de esa rotación SHALL restaurar la sesión (la API reemite, `auth/sessions`) sin pasar por `/login` ni llamar a logout.

En una ruta pública (`/oferta/:slug`) NO SHALL intentarse la restauración al arrancar: la página SHALL pintarse sin
esperar a la API de sesión. Quien llega desde un chat, sin cookie de refresh, NO SHALL ver "Conectando…" ni esperar
ningún tiempo de espera antes de ver la oferta. La sesión SHALL resolverse al navegar fuera de esa ruta, en el guard
que corresponda, y NO SHALL resolverse dentro del gesto de pulsar el CTA.

#### Scenario: Recarga con sesión

- **GIVEN** un usuario con sesión
- **WHEN** recarga la página en `/perfil`
- **THEN** el SPA SHALL mostrar `/perfil` sin pasar por `/login`

#### Scenario: Recarga con el refresh de la restauración en vuelo

- **GIVEN** un usuario con sesión cuyo refresh de la restauración ya rotó en la API y cuya respuesta todavía no llegó
- **WHEN** recarga la página en `/perfil` antes de recibir esa respuesta
- **THEN** el SPA SHALL mostrar `/perfil` sin pasar por `/login`
- **AND** NO SHALL llamarse a logout

#### Scenario: API sin respuesta al cargar

- **GIVEN** una API que no responde
- **WHEN** se carga el SPA en `/`
- **THEN** el SPA SHALL mostrar `/login` tras como máximo 10 segundos
- **AND** NO SHALL hacer más peticiones de refresh ni de logout

#### Scenario: La oferta pública no espera a la sesión

- **GIVEN** un navegador sin cookie de refresh
- **WHEN** se carga el SPA en `/oferta/:slug`
- **THEN** NO SHALL llamarse al refresh al arrancar
- **AND** la oferta SHALL verse sin pasar por "Conectando…"

#### Scenario: La sesión se resuelve en el guard, no en el botón

- **GIVEN** un usuario con cookie de refresh válida que abre `/oferta/:slug`
- **WHEN** pulsa "Guardar en LinkVault"
- **THEN** el SPA SHALL navegar a `/registro?import=<slug>` sin esperar a ninguna petición
- **AND** el guard de invitado SHALL restaurar la sesión y llevarlo a `/mis-links` con ese `import`, sin que llegue a
  verse el registro
