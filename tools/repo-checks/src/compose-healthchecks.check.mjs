/**
 * Comprobación: **todos** los servicios de `docker-compose.prod.yml` declaran `healthcheck`.
 *
 * Por qué existe: `docker compose up --wait` solo espera a los servicios que tienen healthcheck; uno sin él se da
 * por listo en cuanto el contenedor arranca, aunque el proceso de dentro esté muriendo. Un servicio nuevo sin
 * healthcheck no rompe nada visible — deja de comprobarse en silencio, que es la avería que este change persigue.
 *
 * Qué NO comprueba: si el healthcheck es *bueno* (que decida por el contenido y no por el código de estado). Eso lo
 * exige el requirement "Compose de producción" y vive en el propio compose; aquí solo se comprueba que exista.
 */
import { COMPOSE_PATH, loadCompose, relativeToRoot } from './lib/compose.mjs';
import { fail, pass } from './lib/report.mjs';

const NAME = 'compose-healthchecks';

const document = loadCompose();
const services = Object.entries(document.services ?? {});
const file = relativeToRoot(COMPOSE_PATH);

const findings = [];
for (const [service, definition] of services) {
  const healthcheck = definition?.healthcheck;
  if (healthcheck === undefined || healthcheck === null) {
    findings.push(`${file}: el servicio '${service}' no declara healthcheck`);
    continue;
  }
  if (healthcheck.disable === true) {
    findings.push(
      `${file}: el servicio '${service}' declara 'healthcheck.disable: true', que equivale a no tenerlo`,
    );
    continue;
  }
  if (!healthcheck.test) {
    findings.push(
      `${file}: el healthcheck del servicio '${service}' no declara 'test'`,
    );
  }
}

if (findings.length > 0) {
  fail(
    NAME,
    findings,
    `añade un healthcheck a esos servicios en ${file}; sin él, 'up --wait' los da por listos sin mirar nada`,
  );
}

pass(
  NAME,
  `${services.length} servicios de ${file} con healthcheck: ${services
    .map(([service]) => service)
    .join(', ')}`,
);
