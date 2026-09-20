## MODIFIED Requirements

### Requirement: Quitar un link desde el SPA

Cada link SHALL ofrecer quitarlo a quien lo compartió y al `owner` del grupo, con una confirmación que diga "Se quita de
este grupo; la oferta sigue disponible en otros grupos." cuando el link no tiene comentarios en el grupo. Si los tiene,
SHALL decir cuántos se borran con él, con el plural correcto: "Se quita de este grupo junto con su comentario; la oferta
sigue disponible en otros grupos." o "Se quita de este grupo junto con sus N comentarios; la oferta sigue disponible en
otros grupos.". El número SHALL salir del contador que trae el link, no de los comentarios que haya en pantalla. Si el
link tiene enlace público, la confirmación SHALL añadir "Su enlace público dejará de funcionar." En la
vista privada, cualquier link propio SHALL poder quitarse. Al confirmarse, la lista SHALL actualizarse sin recargar.

#### Scenario: Quitar un enlace que no era una oferta

- **GIVEN** un miembro que importó por error un enlace de un vídeo
- **WHEN** lo quita y confirma
- **THEN** el link SHALL desaparecer de la lista sin recargar

#### Scenario: Sin permiso para quitar

- **GIVEN** un miembro que no es owner viendo un link compartido por otra persona
- **WHEN** mira ese link
- **THEN** NO SHALL ver la acción de quitarlo

#### Scenario: Quitar un link con comentarios

- **GIVEN** un link del grupo con 4 comentarios, de los que la tarjeta muestra 2
- **WHEN** quien lo compartió pulsa quitarlo
- **THEN** la confirmación SHALL decir "Se quita de este grupo junto con sus 4 comentarios; la oferta sigue disponible
  en otros grupos."

#### Scenario: Quitar un link publicado

- **GIVEN** un link del grupo con enlace público y sin comentarios
- **WHEN** quien lo compartió pulsa quitarlo
- **THEN** la confirmación SHALL decir además que su enlace público dejará de funcionar
