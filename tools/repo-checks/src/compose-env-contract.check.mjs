/**
 * Comprobación: **`docker-compose.prod.yml` declara todo lo que sus procesos validan al arrancar.**
 *
 * Por qué existe (ADR-048 §2): un proceso al que le falta una variable obligatoria termina con código distinto de
 * cero **antes de escuchar**. Un compose incompleto no arranca degradado: **no arranca**. Y añadir las variables a
 * mano caduca con la primera que alguien añada al código, así que lo que se comprueba es la **correspondencia**
 * contra los esquemas con los que cada proceso valida su entorno.
 *
 * Tres reglas, tomadas del requirement "Contrato de variables de producción":
 *
 *  1. **Unidireccional.** El compose PUEDE declarar variables que el esquema trate como opcionales (`AI_QUOTAS`,
 *     `OPENROUTER_*`…); eso no falla. Lo prohibido es lo contrario —que el esquema exija lo que el compose no da—,
 *     que es lo único que impide arrancar.
 *  2. **Declarada** es la variable a la que el compose da valor en ese servicio: fijo (`NODE_ENV: production`), con
 *     valor por defecto (`${VAR:-…}`) o con sustitución obligatoria (`${VAR:?}`). Un `${VAR}` a secas NO cuenta: si
 *     falta en el entorno, el contenedor recibe cadena vacía y el proceso muere dentro.
 *  3. **Las condicionales van declaradas aquí**, en la tabla `CONDITIONAL_REQUIREMENTS`, y NO se infieren leyendo el
 *     `superRefine` de los esquemas: es TypeScript arbitrario y un grep sobre él fingiría una cobertura que no
 *     tiene. Cuando cambie una rama del código hay que cambiar esta tabla; que eso se note es el objetivo.
 */
import {
  COMPOSE_PATH,
  classifyDeclaration,
  loadCompose,
  relativeToRoot,
  serviceEnvironment,
} from './lib/compose.mjs';
import { fail, pass } from './lib/report.mjs';
import { readSchemaVariables } from './lib/zod-env-schema.mjs';

const NAME = 'compose-env-contract';
const file = relativeToRoot(COMPOSE_PATH);

/** Los dos procesos que validan su entorno al arrancar, con el esquema que usan y sus canarios de lectura. */
const PROCESSES = [
  {
    service: 'api',
    schema: 'apps/api/src/infrastructure/config/api-config.schema.ts',
    canaries: ['NODE_ENV', 'MONGO_URI', 'REDIS_URL', 'AI_CHAIN', 'API_PORT'],
  },
  {
    service: 'worker',
    schema: 'apps/worker/src/infrastructure/config/worker-config.schema.ts',
    canaries: [
      'NODE_ENV',
      'MONGO_URI',
      'REDIS_URL',
      'AI_CHAIN',
      'WORKER_HEALTH_PORT',
    ],
  },
];

/**
 * Obligatorias que **no** salen del esquema zod de la app porque las valida en cadena `parseAiConfig`
 * (`libs/ai/src/infrastructure/config/parse-ai-config.ts`), que los dos procesos invocan al arrancar.
 * `AI_VAULT_KEY` es obligatoria en cuanto `NODE_ENV=production`, con independencia de `AI_CHAIN`, y ha de ser
 * base64 de 32 bytes exactos.
 */
const CHAIN_VALIDATED_REQUIRED = [
  {
    variable: 'AI_VAULT_KEY',
    services: ['api', 'worker'],
    source:
      'libs/ai/src/infrastructure/config/parse-ai-config.ts (parseVaultKey)',
  },
];

/**
 * Condicionales de correo (ADR-034). Desde este change las exigen los **dos** esquemas, así que el compose las pasa
 * siempre en los dos servicios: el compose no sabe qué proveedor elegirá el operador, y con `MAIL_PROVIDER=smtp` o
 * `=resend` el proceso no arranca sin ellas.
 */
const CONDITIONAL_REQUIREMENTS = [
  {
    when: 'MAIL_PROVIDER=smtp',
    requires: ['MAIL_SMTP_HOST', 'MAIL_SMTP_PORT'],
    services: ['api', 'worker'],
    source:
      'superRefine de api-config.schema.ts y worker-config.schema.ts (rama smtp)',
  },
  {
    when: 'MAIL_PROVIDER=resend',
    requires: ['RESEND_API_KEY'],
    services: ['api', 'worker'],
    source:
      'superRefine de api-config.schema.ts y worker-config.schema.ts (rama resend)',
  },
];

/**
 * Valores por defecto que eligen por el operador un comportamiento que **descarta trabajo en silencio**. No es una
 * lista de valores prohibidos: es una lista de defectos peligrosos. `MAIL_PROVIDER=capture` arranca "bien" y nunca
 * entrega un correo, así que el fallo se descubre en la bandeja de entrada de otra persona.
 */
const UNSAFE_DEFAULTS = [
  {
    variable: 'MAIL_PROVIDER',
    services: ['api', 'worker'],
    values: {
      capture:
        'ese proveedor captura los mensajes y no los entrega: el despliegue arrancaría sin enviar ninguna verificación de cuenta',
    },
  },
];

const document = loadCompose();
const findings = [];
let requiredCount = 0;

for (const { service, schema, canaries } of PROCESSES) {
  const environment = serviceEnvironment(document, service);
  if (environment.size === 0) {
    findings.push(
      `${file}: el servicio '${service}' no declara ningún 'environment'`,
    );
    continue;
  }

  const declaredIn = (variable) => {
    if (!environment.has(variable)) {
      return { declared: false };
    }
    const declaration = classifyDeclaration(environment.get(variable));
    return { declared: declaration.kind !== 'bare', declaration };
  };

  /** Dos motivos distintos para "no declarada": no está, o está como `${VAR}` a secas. */
  const describeMissing = (variable, declaration, exigedBy) =>
    declaration === undefined
      ? `${file}: al servicio '${service}' le falta la variable obligatoria '${variable}', que exige ${exigedBy}`
      : `${file}: el servicio '${service}' declara '${variable}' como '${declaration.value}', una sustitución sin valor por defecto ni obligatoriedad: si falta en el entorno, el proceso muere dentro del contenedor en vez de abortar el 'up' (la exige ${exigedBy})`;

  for (const variable of readSchemaVariables(schema, canaries)) {
    if (!variable.required) {
      continue;
    }
    requiredCount += 1;
    const { declared, declaration } = declaredIn(variable.name);
    if (!declared) {
      findings.push(
        describeMissing(
          variable.name,
          declaration,
          `${schema} al arrancar el proceso`,
        ),
      );
    }
  }

  for (const extra of CHAIN_VALIDATED_REQUIRED) {
    if (!extra.services.includes(service)) {
      continue;
    }
    requiredCount += 1;
    const { declared, declaration } = declaredIn(extra.variable);
    if (!declared) {
      findings.push(
        describeMissing(
          extra.variable,
          declaration,
          `en cadena ${extra.source}`,
        ),
      );
    }
  }

  for (const conditional of CONDITIONAL_REQUIREMENTS) {
    if (!conditional.services.includes(service)) {
      continue;
    }
    for (const variable of conditional.requires) {
      if (!declaredIn(variable).declared) {
        findings.push(
          `${file}: el servicio '${service}' no pasa '${variable}', que con ${conditional.when} es obligatoria (${conditional.source})`,
        );
      }
    }
  }

  for (const unsafe of UNSAFE_DEFAULTS) {
    if (
      !unsafe.services.includes(service) ||
      !environment.has(unsafe.variable)
    ) {
      continue;
    }
    const declaration = classifyDeclaration(environment.get(unsafe.variable));
    const chosen =
      declaration.kind === 'fixed'
        ? declaration.value
        : declaration.kind === 'default'
          ? declaration.defaultValue
          : undefined;
    const reason = chosen === undefined ? undefined : unsafe.values[chosen];
    if (reason !== undefined) {
      findings.push(
        `${file}: el servicio '${service}' deja '${unsafe.variable}' en '${chosen}' ${declaration.kind === 'fixed' ? 'con valor fijo' : 'como valor por defecto'}: ${reason}`,
      );
    }
  }
}

if (findings.length > 0) {
  fail(
    NAME,
    findings,
    `declara esas variables en el bloque 'environment' del servicio en ${file}; un proceso sin una obligatoria termina con código distinto de cero antes de escuchar`,
  );
}

pass(
  NAME,
  `${requiredCount} variables obligatorias de 'api' y 'worker' tienen valor en su servicio de ${file}; las condicionales de correo se pasan en los dos. La comprobación es unidireccional: el compose puede declarar opcionales de más`,
);
