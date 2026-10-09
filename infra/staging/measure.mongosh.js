// =====================================================================================================================
// Medición de los primeros usuarios de staging (design D15 de `staging-host`, tarea 10.3).
// =====================================================================================================================
// Plan, umbrales y regla de decisión: RUNBOOK, «Paso 6 sexdecies — Operar staging», «Plan de medición de los primeros
// usuarios». Se ejecuta siempre por el envoltorio, que antes pasa `infra/staging/assert-readonly.mjs` sobre este
// fichero y define la lista de excluidos por `--eval`:
//
//   STAGING_SSH_DEST=… STAGING_EXCLUDED_IDS_FILE=… bash infra/staging/run.sh infra/staging/measure.mongosh.js
//
// Solo lee y solo devuelve recuentos: imprime un único objeto JSON, en una línea, cuyos valores son todos números; ni
// ids, ni emails, ni textos. La lista de excluidos (`LV_EXCLUDED_IDS`: el autor y las cuentas E2E con alias `+e2e`)
// se aplica **por `userId` en cada métrica**: lo de esas cuentas no cuenta en ninguna, tampoco sus grupos, links,
// postulaciones, CV ni análisis.
//
// Claves de la salida (todas sin los excluidos):
//   users                     cuentas.
//   activatedUsers            personas con su primer link guardado en menos de 48 h desde el alta (umbral de
//                             activación).
//   usersWith3PlusLinks       personas con 3 o más links guardados (umbral de uso; medido el día 14 desde la
//                             invitación, con la línea base en 0, son los de esos 14 días).
//   groups                    grupos cuyo owner no está excluido.
//   membersInLargestGroup     miembros no excluidos del grupo que más tiene, sea de quien sea (el del autor incluido):
//                             es la comprobación de 10.7, «al menos dos miembros distintos del autor».
//   links                     links distintos guardados (lista privada o compartidos en un grupo).
//   applications              postulaciones.
//   groupVisibleApplications  postulaciones con visibilidad de grupo que ve otro miembro no excluido de un grupo donde
//                             está el link (umbral de uso de grupo; la visibilidad se deriva igual que la aplicación,
//                             ADR-024 §6).
//   cvs                       CV subidos.
//   analyses                  análisis de encaje pedidos, en cualquier estado.
//   roadmaps                  roadmaps pedidos, en cualquier estado.
//   aiGenerated               análisis terminados más roadmaps listos (umbral de uso de IA).
// =====================================================================================================================
'use strict';

const HEX_ID = /^[0-9a-f]{24}$/;
const ACTIVATION_WINDOW_MS = 48 * 60 * 60 * 1000;

function idList(name, value) {
  if (!Array.isArray(value)) {
    throw new Error(
      `${name} no está definido: ejecuta este script con infra/staging/run.sh`,
    );
  }
  if (value.length === 0) {
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

const excluded = idList('LV_EXCLUDED_IDS', globalThis.LV_EXCLUDED_IDS);
const notExcluded = { $nin: excluded };
const lv = db.getSiblingDB('linkvault');

// Cada link guardado por persona: su lista privada y lo que compartió en un grupo, una vez por par persona-link y con
// la fecha del primer guardado.
const saves = lv.user_links
  .aggregate([
    { $match: { userId: notExcluded } },
    { $project: { _id: 0, userId: 1, linkId: 1, at: '$savedAt' } },
    {
      $unionWith: {
        coll: 'group_links',
        pipeline: [
          { $match: { sharedBy: notExcluded } },
          {
            $project: {
              _id: 0,
              userId: '$sharedBy',
              linkId: 1,
              at: '$sharedAt',
            },
          },
        ],
      },
    },
    {
      $group: {
        _id: { userId: '$userId', linkId: '$linkId' },
        at: { $min: '$at' },
      },
    },
  ])
  .toArray();

const linksByUser = new Map();
const firstSaveByUser = new Map();
const distinctLinks = new Set();
saves.forEach((row) => {
  const user = row._id.userId.toHexString();
  distinctLinks.add(row._id.linkId.toHexString());
  linksByUser.set(user, (linksByUser.get(user) || 0) + 1);
  const first = firstSaveByUser.get(user);
  if (first === undefined || row.at < first) {
    firstSaveByUser.set(user, row.at);
  }
});

let users = 0;
let activatedUsers = 0;
lv.users.find({ _id: notExcluded }, { createdAt: 1 }).forEach((user) => {
  users += 1;
  const first = firstSaveByUser.get(user._id.toHexString());
  if (
    first !== undefined &&
    first.getTime() - user.createdAt.getTime() < ACTIVATION_WINDOW_MS
  ) {
    activatedUsers += 1;
  }
});

let usersWith3PlusLinks = 0;
linksByUser.forEach((count) => {
  if (count >= 3) {
    usersWith3PlusLinks += 1;
  }
});

const memberCounts = lv.group_members
  .aggregate([
    { $match: { userId: notExcluded } },
    { $group: { _id: '$groupId', members: { $sum: 1 } } },
  ])
  .toArray()
  .map((row) => row.members);

const visible = lv.applications
  .aggregate([
    { $match: { userId: notExcluded, visibility: 'group' } },
    {
      $lookup: {
        from: 'group_links',
        localField: 'linkId',
        foreignField: 'linkId',
        as: 'shared',
      },
    },
    { $unwind: '$shared' },
    {
      $lookup: {
        from: 'group_members',
        let: { groupId: '$shared.groupId' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$groupId', '$$groupId'] },
              userId: notExcluded,
            },
          },
          { $project: { _id: 0, userId: 1 } },
        ],
        as: 'members',
      },
    },
    {
      $match: {
        $expr: {
          $and: [
            { $in: ['$userId', '$members.userId'] },
            {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: '$members',
                      cond: { $ne: ['$$this.userId', '$userId'] },
                    },
                  },
                },
                0,
              ],
            },
          ],
        },
      },
    },
    { $group: { _id: '$_id' } },
    { $count: 'n' },
  ])
  .toArray()
  .map((row) => row.n);

const analysesDone = lv.ai_analyses.countDocuments({
  userId: notExcluded,
  status: 'done',
});
const roadmapsReady = lv.roadmaps.countDocuments({
  userId: notExcluded,
  status: 'ready',
});

print(
  JSON.stringify({
    users,
    activatedUsers,
    usersWith3PlusLinks,
    groups: lv.group_members.countDocuments({
      role: 'owner',
      userId: notExcluded,
    }),
    membersInLargestGroup: Math.max(0, ...memberCounts),
    links: distinctLinks.size,
    applications: lv.applications.countDocuments({ userId: notExcluded }),
    groupVisibleApplications: Math.max(0, ...visible),
    cvs: lv.cv_documents.countDocuments({ userId: notExcluded }),
    analyses: lv.ai_analyses.countDocuments({ userId: notExcluded }),
    roadmaps: lv.roadmaps.countDocuments({ userId: notExcluded }),
    aiGenerated: analysesDone + roadmapsReady,
  }),
);
