// =====================================================================================================================
// Cuentas no invitadas en staging (design D16 de `staging-host`, tarea 9.12).
// =====================================================================================================================
// La URL de staging es pública desde la primera emisión del certificado (Certificate Transparency, ADR-051 §5), así que
// cualquiera puede darse de alta. En vez de restringir el alta, se vigila: este script cuenta las cuentas cuyo id no
// está en la lista de invitados (`LV_INVITED_IDS`, que vive en el host, fuera del repositorio, porque son datos
// personales) ni en la de excluidos (`LV_EXCLUDED_IDS`: el autor y las cuentas E2E, que pasa el operador). Se ejecuta
// semanalmente, siempre por el envoltorio, que antes pasa `infra/staging/assert-readonly.mjs` y define las dos listas
// por `--eval`:
//
//   STAGING_SSH_DEST=… STAGING_EXCLUDED_IDS_FILE=… bash infra/staging/run.sh infra/staging/uninvited.mongosh.js
//
// Solo lee y solo devuelve recuentos: un objeto JSON en una línea, sin ids ni emails. Qué hacer si `uninvitedUsers` no
// es 0: RUNBOOK, «Cuentas no invitadas».
// =====================================================================================================================
'use strict';

const HEX_ID = /^[0-9a-f]{24}$/;

function idList(name, value, { allowEmpty }) {
  if (!Array.isArray(value)) {
    throw new Error(
      `${name} no está definido: ejecuta este script con infra/staging/run.sh`,
    );
  }
  if (value.length === 0 && !allowEmpty) {
    throw new Error(
      `${name} está vacía: tiene que contener al menos el id del autor`,
    );
  }
  value.forEach((id) => {
    if (typeof id !== 'string' || !HEX_ID.test(id)) {
      throw new Error(
        `${name} contiene un valor que no es un id de 24 caracteres hexadecimales`,
      );
    }
  });
  return value.map((id) => ObjectId(id));
}

// Antes de invitar (línea base, tarea 10.6) la lista de invitados está vacía; la de excluidos nunca.
const invited = idList('LV_INVITED_IDS', globalThis.LV_INVITED_IDS, {
  allowEmpty: true,
});
const excluded = idList('LV_EXCLUDED_IDS', globalThis.LV_EXCLUDED_IDS, {
  allowEmpty: false,
});
const lv = db.getSiblingDB('linkvault');

print(
  JSON.stringify({
    uninvitedUsers: lv.users.countDocuments({
      _id: { $nin: invited.concat(excluded) },
    }),
    invitedIds: invited.length,
    excludedIds: excluded.length,
  }),
);
