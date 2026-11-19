/**
 * Comprobación: los procesos del respaldo y de la restauración NO deshacen el aislamiento por proceso (ADR-066, design D2,
 * requirement «Los procesos del respaldo no deshacen el aislamiento por proceso» de `platform/backups`).
 *
 * Regla de fondo: **ningún proceso puede consultar los datos y además salir a Internet.** Aquí se traduce en reglas sobre la
 * configuración de Compose **resuelta** (lo resuelto es lo que corre):
 *
 *  1. cada servicio `backup-*` / `restore-*` declara `networks` explícitas, sin la red `default`;
 *  2. ninguno tiene `network_mode` ni `ports`;
 *  3. todos llevan `logging.driver: none` (su salida estándar ES el volcado: con `json-file` quedaría en claro en disco);
 *  4. ninguno está a la vez en una red con salida y en una de datos (`data-*`, `store-*`);
 *  5. ninguno comparte red con `api` ni con `worker`;
 *  6. `data-backup` y `store-backup` son `internal: true` y sus miembros son EXACTAMENTE `mongo`+`backup-mongo` y
 *     `object-store`+`backup-objects`+`restore-objects` (Q3 (b): no hay `backup-identity`);
 *  7. en el override de restauración (`-p linkvault-restore`): ningún servicio publica puertos, el único en una red con salida es
 *     `backup-push` (y sin redes de datos), `traefik`, `web` y `worker` están deshabilitados (perfil `never`) y ningún
 *     volumen se comparte con otro proyecto.
 *
 * Cómo lee: en CI y donde haya `docker`, `docker compose … config --format json` volcado a un fichero temporal y leído con
 * `node` (nunca por tubería). Fuera de CI y sin `docker`, los ficheros crudos con las mismas reglas (`!reset` y `!override`
 * entendidos). En CI, la falta de `docker` es un fallo: un verde sin haber resuelto nada no vale.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { WORKSPACE_ROOT, relativeToRoot } from './lib/compose.mjs';
import { fail, pass } from './lib/report.mjs';

const NAME = 'backup-isolation';
const PROD = join(WORKSPACE_ROOT, 'docker-compose.prod.yml');
const BACKUP = join(WORKSPACE_ROOT, 'infra/backup/docker-compose.backup.yml');
const RESTORE = join(WORKSPACE_ROOT, 'infra/backup/docker-compose.restore.yml');
const ENV_FILE = join(WORKSPACE_ROOT, 'infra/ci/verify.env');

const isBackupService = (name) =>
  name.startsWith('backup-') || name.startsWith('restore-');
const isDataNetwork = (name) =>
  name.startsWith('data-') || name.startsWith('store-');

/** Miembros esperados de las dos redes internas del respaldo: `[servicios del respaldo obligatorios, opcionales]`. */
const EXPECTED_MEMBERS = {
  'data-backup': { fixed: ['mongo'], backup: ['backup-mongo'], optional: [] },
  'store-backup': {
    fixed: ['object-store'],
    backup: ['backup-objects', 'restore-objects'],
    optional: [],
  },
};

// --- Modelo común --------------------------------------------------------------------------------------------------------

/**
 * @typedef {{ networks: string[], networkMode?: string, ports: unknown[], loggingDriver?: string, profiles: string[] }} Svc
 * @typedef {{ services: Record<string, Svc>, networks: Record<string, { internal: boolean }>, volumes: Record<string, { name?: string, external: boolean }> }} Model
 */

/** Modelo desde la salida de `docker compose config --format json`. */
function modelFromResolved(json) {
  /** @type {Model} */
  const model = { services: {}, networks: {}, volumes: {} };
  for (const [name, svc] of Object.entries(json.services ?? {})) {
    const networks = svc.networks ? Object.keys(svc.networks) : ['default'];
    model.services[name] = {
      networks,
      networkMode: svc.network_mode,
      ports: svc.ports ?? [],
      loggingDriver: svc.logging?.driver,
      profiles: svc.profiles ?? [],
    };
  }
  for (const [name, net] of Object.entries(json.networks ?? {})) {
    model.networks[name] = { internal: net?.internal === true };
  }
  for (const [name, vol] of Object.entries(json.volumes ?? {})) {
    model.volumes[name] = {
      name: vol?.name,
      external: vol?.external === true || vol?.external?.name !== undefined,
    };
  }
  return model;
}

/**
 * Un nodo del documento con la etiqueta `!reset` o `!override` de Compose reemplaza al valor de los ficheros anteriores en
 * vez de sumarse. `yaml` deja la etiqueta en `node.tag` (con un aviso de etiqueta sin resolver, que aquí no importa).
 */
function readKey(doc, path) {
  const node = doc.getIn(path, true);
  if (node === undefined)
    return { present: false, replace: false, value: undefined };
  const tag = node && typeof node === 'object' ? node.tag : undefined;
  const value =
    node && typeof node === 'object' && typeof node.toJSON === 'function'
      ? node.toJSON()
      : node;
  return {
    present: true,
    replace: tag === '!reset' || tag === '!override',
    value,
  };
}

/** Modelo desde los ficheros crudos (sin `docker`): suma servicios y redes de cada fichero en orden. */
function modelFromRaw(files) {
  /** @type {Model} */
  const model = { services: {}, networks: {}, volumes: {} };
  for (const file of files) {
    const doc = parseDocument(readFileSync(file, 'utf8'));
    const json = doc.toJSON() ?? {};
    for (const [name, net] of Object.entries(json.networks ?? {})) {
      model.networks[name] = {
        internal:
          (net ?? {}).internal === true ||
          model.networks[name]?.internal === true,
      };
    }
    for (const name of Object.keys(json.volumes ?? {})) {
      model.volumes[name] = { name: undefined, external: false };
    }
    for (const [name, raw] of Object.entries(json.services ?? {})) {
      const svc = (model.services[name] ??= {
        networks: [],
        ports: [],
        profiles: [],
      });
      const nets = readKey(doc, ['services', name, 'networks']);
      if (nets.present) {
        const list = Array.isArray(nets.value)
          ? nets.value
          : Object.keys(nets.value ?? {});
        svc.networks = nets.replace
          ? list
          : [...new Set([...svc.networks, ...list])];
      }
      const ports = readKey(doc, ['services', name, 'ports']);
      if (ports.present)
        svc.ports = ports.replace
          ? (ports.value ?? [])
          : [...svc.ports, ...(ports.value ?? [])];
      const profiles = readKey(doc, ['services', name, 'profiles']);
      if (profiles.present)
        svc.profiles = profiles.replace
          ? (profiles.value ?? [])
          : [...new Set([...svc.profiles, ...(profiles.value ?? [])])];
      if (raw?.network_mode !== undefined) svc.networkMode = raw.network_mode;
      if (raw?.logging?.driver !== undefined)
        svc.loggingDriver = raw.logging.driver;
    }
  }
  // Un servicio sin `networks` cae en `default`, igual que lo resuelto por Compose.
  for (const svc of Object.values(model.services)) {
    if (svc.networks.length === 0) svc.networks = ['default'];
  }
  return model;
}

// --- Reglas ---------------------------------------------------------------------------------------------------------------

/**
 * @param {Model} model
 * @param {{ restore: boolean, project: string }} options
 * @returns {string[]} hallazgos
 */
export function evaluate(model, { restore, project }) {
  const findings = [];
  const services = model.services;
  const isEgress = (net) =>
    model.networks[net] !== undefined && !model.networks[net].internal;
  const netsOf = (service) => services[service]?.networks ?? [];

  for (const [name, svc] of Object.entries(services)) {
    if (!isBackupService(name)) continue;
    if (svc.networks.length === 0 || svc.networks.includes('default')) {
      findings.push(
        `${name}: no declara \`networks\` explícitas o está en la red por defecto (regla: redes explícitas, sin \`default\`)`,
      );
    }
    if (svc.networkMode !== undefined) {
      findings.push(
        `${name}: declara \`network_mode: ${svc.networkMode}\` (regla: sin network_mode)`,
      );
    }
    if (svc.ports.length > 0) {
      findings.push(`${name}: publica puertos (regla: sin \`ports\`)`);
    }
    if (svc.loggingDriver !== 'none') {
      findings.push(
        `${name}: logging.driver es '${svc.loggingDriver ?? 'por defecto'}' (regla: \`logging.driver: none\`; su salida estándar es el volcado)`,
      );
    }
    const egress = svc.networks.filter(isEgress);
    const data = svc.networks.filter(isDataNetwork);
    for (const e of egress) {
      for (const d of data) {
        findings.push(
          `${name}: está a la vez en la red con salida '${e}' y en la red de datos '${d}' (regla: ningún proceso consulta datos y además sale a Internet)`,
        );
      }
    }
    for (const other of ['api', 'worker']) {
      for (const net of svc.networks) {
        if (netsOf(other).includes(net)) {
          findings.push(
            `${name}: comparte la red '${net}' con '${other}' (regla: ningún proceso del respaldo comparte red con api ni worker)`,
          );
        }
      }
    }
  }

  for (const [net, expected] of Object.entries(EXPECTED_MEMBERS)) {
    if (model.networks[net] === undefined) {
      findings.push(`red '${net}': no existe`);
      continue;
    }
    if (!model.networks[net].internal) {
      findings.push(
        `red '${net}': no es \`internal: true\` (regla: las redes de datos del respaldo son internas)`,
      );
    }
    const members = Object.keys(services)
      .filter((s) => services[s].networks.includes(net))
      .sort();
    const required = [...expected.fixed, ...expected.backup];
    const allowed = new Set([...required, ...expected.optional]);
    for (const member of members) {
      if (!allowed.has(member))
        findings.push(
          `red '${net}': '${member}' no debería ser miembro (miembros exactos: ${[...allowed].sort().join(', ')})`,
        );
    }
    for (const must of required) {
      if (!members.includes(must))
        findings.push(`red '${net}': falta '${must}' entre sus miembros`);
    }
  }

  if (restore) {
    for (const [name, svc] of Object.entries(services)) {
      if (svc.ports.length > 0)
        findings.push(
          `${name}: publica puertos en el override de restauración (regla: ningún servicio publica puertos)`,
        );
      // Un servicio deshabilitado (perfil `never`) no arranca: sus redes no cuentan, pero sus puertos sí (arriba).
      const egress = svc.profiles.includes('never')
        ? []
        : svc.networks.filter(isEgress);
      if (egress.length > 0 && name !== 'backup-push') {
        findings.push(
          `${name}: está en la red con salida '${egress[0]}' en la restauración (regla: el único servicio con salida es backup-push)`,
        );
      }
      if (name === 'backup-push' && svc.networks.some(isDataNetwork)) {
        findings.push(
          'backup-push: está en una red de datos (regla: sin redes de datos)',
        );
      }
    }
    for (const name of ['traefik', 'web', 'worker']) {
      if (
        services[name] !== undefined &&
        !services[name].profiles.includes('never')
      ) {
        findings.push(
          `${name}: no está deshabilitado (perfil 'never') en el override de restauración`,
        );
      }
    }
    for (const [name, vol] of Object.entries(model.volumes)) {
      if (vol.external)
        findings.push(
          `volumen '${name}': es externo (regla: volúmenes del proyecto, nunca los de otro)`,
        );
      if (vol.name !== undefined && !vol.name.startsWith(`${project}_`)) {
        findings.push(
          `volumen '${name}': se llama '${vol.name}' y no empieza por '${project}_' (regla: ningún volumen compartido con linkvault-prod)`,
        );
      }
    }
  }
  return findings;
}

// --- Ejecución --------------------------------------------------------------------------------------------------------------

function dockerAvailable() {
  const probe = spawnSync('docker', ['compose', 'version'], {
    encoding: 'utf8',
  });
  return probe.status === 0;
}

function resolveWithDocker(files, project, extra) {
  const dir = mkdtempSync(join(tmpdir(), 'backup-isolation-'));
  const out = join(dir, 'config.json');
  try {
    const args = ['compose', '-p', project];
    for (const file of files) args.push('-f', file);
    args.push('--env-file', ENV_FILE, ...extra, 'config', '--format', 'json');
    const run = spawnSync('docker', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (run.status !== 0) {
      throw new Error(
        `docker compose config falló (${run.status}): ${(run.stderr ?? '').split('\n').slice(0, 5).join(' | ')}`,
      );
    }
    writeFileSync(out, run.stdout);
    return modelFromResolved(JSON.parse(readFileSync(out, 'utf8')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const inCi = process.env.CI === 'true' || process.env.CI === '1';
const useDocker = dockerAvailable();
if (inCi && !useDocker) {
  fail(
    NAME,
    [
      'en CI se exige `docker compose config --format json`, y `docker` no está disponible: no se resuelve nada, así que no se da verde',
    ],
    'instala docker en el corredor',
  );
}

/**
 * Q3 (b), design D3: `backup-objects` lee con la identidad S3 de la APLICACIÓN, que PUEDE escribir y borrar. Lo único que lo
 * impide es lo que hacen sus scripts, así que se vigila que `read-objects.sh` y `list-objects.sh` solo lean del almacén: ninguna orden
 * de escritura de `rclone`, y `rclone copy` solo con `store:` como ORIGEN.
 */
const READER_SCRIPTS = [
  'infra/backup/read-objects.sh',
  'infra/backup/list-objects.sh',
];
const WRITE_VERBS =
  /\brclone\s+(?:delete|deletefile|purge|rmdir|rmdirs|sync|move|moveto|rcat|mkdir|copyto|touch|cleanup|bisync|settier)\b/;
export function readOnlyFindings(
  readFile = (file) => readFileSync(join(WORKSPACE_ROOT, file), 'utf8'),
) {
  const out = [];
  for (const file of READER_SCRIPTS) {
    readFile(file)
      .split(/\r?\n/)
      .forEach((line, index) => {
        const code = line.replace(/#.*$/, '');
        if (WRITE_VERBS.test(code))
          out.push(
            `${file}:${index + 1}: el lector de objetos usa una orden de escritura de rclone (lee con la identidad de la aplicación, que puede escribir)`,
          );
        const copy = code.match(/\brclone\s+copy\s+(\S+)\s+(\S+)/);
        if (copy && /^"?store:/.test(copy[2]))
          out.push(
            `${file}:${index + 1}: \`rclone copy\` con el almacén como destino (el lector solo lee)`,
          );
      });
  }
  return out;
}

const findings = [];
const scopes = [];
try {
  findings.push(...readOnlyFindings());
  const backupFiles = [PROD, BACKUP];
  const restoreFiles = existsSync(RESTORE)
    ? [PROD, BACKUP, RESTORE]
    : undefined;
  const mode = useDocker
    ? 'docker compose config --format json'
    : 'ficheros crudos';
  const backupModel = useDocker
    ? resolveWithDocker(backupFiles, 'linkvault-prod', [])
    : modelFromRaw(backupFiles);
  for (const f of evaluate(backupModel, {
    restore: false,
    project: 'linkvault-prod',
  })) {
    findings.push(`${relativeToRoot(BACKUP)}: ${f}`);
  }
  scopes.push(
    `${Object.keys(backupModel.services).filter(isBackupService).length} servicios del respaldo (${mode})`,
  );
  if (restoreFiles) {
    const restoreModel = useDocker
      ? resolveWithDocker(restoreFiles, 'linkvault-restore', [
          '--profile',
          'never',
        ])
      : modelFromRaw(restoreFiles);
    for (const f of evaluate(restoreModel, {
      restore: true,
      project: 'linkvault-restore',
    })) {
      findings.push(`${relativeToRoot(RESTORE)}: ${f}`);
    }
    scopes.push('override de restauración');
  }
} catch (error) {
  findings.push(
    `no se pudo leer la configuración: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (findings.length > 0) {
  fail(
    NAME,
    findings,
    'el respaldo no puede deshacer D18: ver design D2 de `staging-backups` y ADR-066 §2',
  );
}
pass(NAME, scopes.join('; '));
