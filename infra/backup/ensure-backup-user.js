// Asegura el usuario de respaldo de Mongo (ADR-066, design D3 de `staging-backups`). Script de `mongosh`; se ejecuta DENTRO del
// contenedor `mongo` por la entrada estándar, sin montajes nuevos:
//
//   docker compose … exec -T mongo mongosh --quiet --file /dev/stdin < infra/backup/ensure-backup-user.js
//
// Idempotente: crea el usuario si no existe y, si existe, le fija la contraseña y el rol vigentes (cubre un volumen anterior
// al cambio, que `MONGO_INITDB_*` no vuelve a inicializar, y la rotación de la contraseña). Rol integrado `backup` sobre
// `admin`: permite `mongodump --oplog` y no escribe. Todo sale de `process.env` (la raíz y el respaldo); NUNCA se imprime
// una credencial.
const env = process.env;
const rootUser = env.MONGO_INITDB_ROOT_USERNAME;
const rootPassword = env.MONGO_INITDB_ROOT_PASSWORD;
const backupUser = env.MONGO_BACKUP_USER;
const backupPassword = env.MONGO_BACKUP_PASSWORD;

if (!rootUser || !rootPassword) {
  print('ensure-backup-user: faltan las credenciales raíz en el entorno de mongo');
  quit(2);
}
if (!backupUser || !backupPassword) {
  print('ensure-backup-user: faltan MONGO_BACKUP_USER o MONGO_BACKUP_PASSWORD en el entorno de mongo');
  quit(2);
}

const admin = db.getSiblingDB('admin');
if (!admin.auth(rootUser, rootPassword)) {
  print('ensure-backup-user: la autenticación como raíz falló');
  quit(3);
}

const roles = [{ role: 'backup', db: 'admin' }];
if (admin.getUser(backupUser) === null) {
  admin.createUser({ user: backupUser, pwd: backupPassword, roles });
  print('ensure-backup-user: usuario de respaldo creado');
} else {
  admin.updateUser(backupUser, { pwd: backupPassword, roles });
  print('ensure-backup-user: usuario de respaldo actualizado');
}
