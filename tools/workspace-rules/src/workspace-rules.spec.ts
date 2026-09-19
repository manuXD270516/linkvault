import { ESLint } from 'eslint';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { WORKSPACE_ROOT } from './workspace-root';

// Test tabular de las reglas de la spec `workspace` (D4 de bootstrap-monorepo). ESLint se instancia con la
// configuración real del repo y lintText recibe rutas virtuales: los archivos no existen en disco.
// Cada fila compara solo los ruleIds de las reglas bajo prueba, para que otras reglas (p. ej. imports sin
// usar) no hagan frágil la tabla.

const RULES_UNDER_TEST = [
  '@nx/enforce-module-boundaries',
  'no-restricted-imports',
  '@typescript-eslint/no-restricted-imports',
  'no-restricted-syntax',
  '@typescript-eslint/no-explicit-any',
  'no-console',
] as const;

type RuleUnderTest = (typeof RULES_UNDER_TEST)[number];

interface RuleRow {
  readonly name: string;
  /** Ruta relativa a la raíz del repo; el test la convierte en absoluta. */
  readonly filePath: string;
  readonly code: string;
  readonly expectedRuleIds: readonly RuleUnderTest[];
  readonly unexpectedRuleIds?: readonly RuleUnderTest[];
}

const BOUNDARIES = '@nx/enforce-module-boundaries';
const DOMAIN_IMPORTS = 'no-restricted-imports';
/** Los límites entre módulos de api (D8 de groups) usan la misma regla base que el dominio, con su propia lista. */
const MODULE_IMPORTS = 'no-restricted-imports';
/** El bloque de `libs/ai/src/evals` usa la misma regla base que el dominio, con su propia lista (D1 de ai-eval-harness). */
const EVALS_IMPORTS = 'no-restricted-imports';
const AI_SDK_IMPORTS = '@typescript-eslint/no-restricted-imports';
/** `import()` y `require()` de SDKs; en este repo no-restricted-syntax solo se usa para eso. */
const AI_SDK_SYNTAX = 'no-restricted-syntax';
const AI_SDK_RULES: readonly RuleUnderTest[] = [AI_SDK_IMPORTS, AI_SDK_SYNTAX];
/** La spec exige que el error de SDKs nombre la ruta permitida. */
const AI_PROVIDERS_PATH = 'libs/ai/src/infrastructure/providers';

const rows: readonly RuleRow[] = [
  {
    name: 'production code of api imports a type:test-util project',
    filePath: 'apps/api/src/app/probe.ts',
    code: "import { RedisPingDouble } from '@linkvault/testing';\n\nexport const probe = RedisPingDouble;\n",
    expectedRuleIds: [BOUNDARIES],
  },
  {
    // tools/workspace-rules (type:tooling) no tiene alias a propósito: nadie debe importarlo, así que la única
    // forma de alcanzarlo es una ruta relativa. Lo que dispara aquí es la comprobación de import relativo entre
    // proyectos de @nx/enforce-module-boundaries (mismo ruleId), que corta antes de evaluar tags. El escenario
    // observable de la spec (el lint falla) se cumple; la restricción por tag (type:app solo depende de type:lib)
    // queda cubierta indirectamente por la fila anterior, que la dispara por tag. Ver design.md D2.
    name: 'production code of api imports a type:tooling project',
    filePath: 'apps/api/src/app/probe.ts',
    code: "import { WORKSPACE_ROOT } from '../../../../tools/workspace-rules/src/index';\n\nexport const probe = WORKSPACE_ROOT;\n",
    expectedRuleIds: [BOUNDARIES],
  },
  {
    name: 'test file of api imports a type:test-util project of its platform',
    filePath: 'apps/api/src/app/probe.spec.ts',
    code: "import { RedisPingDouble } from '@linkvault/testing';\n\nexport const probe = RedisPingDouble;\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [BOUNDARIES],
  },
  {
    name: 'test file of web imports tools/testing (platform:node)',
    filePath: 'apps/web/src/app/probe.spec.ts',
    code: "import { RedisPingDouble } from '@linkvault/testing';\n\nexport const probe = RedisPingDouble;\n",
    expectedRuleIds: [BOUNDARIES],
  },
  {
    name: 'test file of libs/shared imports @linkvault/ai',
    filePath: 'libs/shared/src/probe.spec.ts',
    code: "import { FixtureMissing } from '@linkvault/ai';\n\nexport const probe = FixtureMissing;\n",
    expectedRuleIds: [BOUNDARIES],
  },
  {
    // Las apps no tienen alias, así que una lib solo puede alcanzarlas por ruta relativa. Lo que dispara aquí es
    // la comprobación de import relativo entre proyectos de @nx/enforce-module-boundaries (mismo ruleId), que corta
    // antes de evaluar tags. El escenario observable de la spec (el lint falla) se cumple; la restricción por tag
    // (type:lib solo depende de type:lib) queda cubierta indirectamente por las filas lib -> lib que sí la evalúan
    // por tag (shared -> ai). Ver design.md D2.
    name: 'a lib imports an app',
    filePath: 'libs/ai/src/probe.ts',
    code: "import { AppModule } from '../../../apps/api/src/app/app.module';\n\nexport const probe = AppModule;\n",
    expectedRuleIds: [BOUNDARIES],
  },
  {
    name: 'production code of libs/shared imports @linkvault/ai',
    filePath: 'libs/shared/src/probe.ts',
    code: "import { FixtureMissing } from '@linkvault/ai';\n\nexport const probe = FixtureMissing;\n",
    expectedRuleIds: [BOUNDARIES],
  },
  {
    name: 'production code of web imports @linkvault/ai',
    filePath: 'apps/web/src/app/probe.ts',
    code: "import { FixtureMissing } from '@linkvault/ai';\n\nexport const probe = FixtureMissing;\n",
    expectedRuleIds: [BOUNDARIES],
  },
  {
    name: 'worker imports an AI provider SDK',
    filePath: 'apps/worker/src/app/probe.ts',
    code: "import OpenAI from 'openai';\n\nexport const probe = OpenAI;\n",
    expectedRuleIds: [AI_SDK_IMPORTS],
  },
  {
    name: 'worker imports the Anthropic SDK',
    filePath: 'apps/worker/src/app/probe.ts',
    code: "import Anthropic from '@anthropic-ai/sdk';\n\nexport const probe = Anthropic;\n",
    expectedRuleIds: [AI_SDK_IMPORTS],
  },
  {
    name: 'worker imports an AI provider SDK dynamically',
    filePath: 'apps/worker/src/app/probe.ts',
    code: "export const probe = (): Promise<unknown> => import('openai');\n",
    expectedRuleIds: [AI_SDK_SYNTAX],
  },
  {
    name: 'worker requires an AI provider SDK',
    filePath: 'apps/worker/src/app/probe.ts',
    code: "declare const require: (id: string) => unknown;\n\nexport const probe = require('ollama');\n",
    expectedRuleIds: [AI_SDK_SYNTAX],
  },
  {
    name: 'libs/ai providers folder imports an AI provider SDK dynamically',
    filePath: 'libs/ai/src/infrastructure/providers/probe.ts',
    code: "export const probe = (): Promise<unknown> => import('openai');\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [AI_SDK_SYNTAX],
  },
  {
    name: 'libs/ai providers folder requires an AI provider SDK',
    filePath: 'libs/ai/src/infrastructure/providers/probe.ts',
    code: "declare const require: (id: string) => unknown;\n\nexport const probe = require('ollama');\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [AI_SDK_SYNTAX],
  },
  {
    name: 'libs/ai providers folder imports an AI provider SDK',
    filePath: 'libs/ai/src/infrastructure/providers/probe.ts',
    code: "import OpenAI from 'openai';\n\nexport const probe = OpenAI;\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [AI_SDK_IMPORTS],
  },
  {
    name: 'libs/ai domain imports the framework and an AI provider SDK at once',
    filePath: 'libs/ai/src/domain/probe.ts',
    code: "import { Injectable } from '@nestjs/common';\nimport OpenAI from 'openai';\n\nexport const probe = [Injectable, OpenAI];\n",
    expectedRuleIds: [DOMAIN_IMPORTS, AI_SDK_IMPORTS],
  },
  {
    name: 'a domain folder of api imports infrastructure (El dominio importa el framework)',
    filePath: 'apps/api/src/modules/probe/domain/probe.ts',
    code: "import { Schema } from 'mongoose';\n\nexport const probe = Schema;\n",
    expectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    name: 'a domain folder of api imports @nestjs/common (El dominio importa el framework)',
    filePath: 'apps/api/src/modules/probe/domain/probe.ts',
    code: "import { Injectable } from '@nestjs/common';\n\nexport const probe = Injectable;\n",
    expectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    name: 'a domain folder of api imports bullmq (El dominio importa el framework)',
    filePath: 'apps/api/src/modules/probe/domain/probe.ts',
    code: "import { Queue } from 'bullmq';\n\nexport const probe = Queue;\n",
    expectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    // link-enrichment (ADR-022): el parser de HTML y el de `robots.txt` viven en `infrastructure/`; el dominio recibe
    // un `PageContent` ya parseado y una decisión de robots ya tomada.
    name: 'a domain folder of the worker imports the HTML parser',
    filePath: 'apps/worker/src/modules/probe/domain/probe.ts',
    code: "import { load } from 'cheerio/slim';\n\nexport const probe = load;\n",
    expectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    name: 'a domain folder of the worker imports the robots.txt parser',
    filePath: 'apps/worker/src/modules/probe/domain/probe.ts',
    code: "import robotsParser from 'robots-parser';\n\nexport const probe = robotsParser;\n",
    expectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    name: 'a domain folder of the worker imports the object storage client',
    filePath: 'apps/worker/src/modules/probe/domain/probe.ts',
    code: "import { S3Client } from '@aws-sdk/client-s3';\n\nexport const probe = S3Client;\n",
    expectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    name: 'libs/ai domain imports the application layer',
    filePath: 'libs/ai/src/domain/x.ts',
    code: "import { RunTaskUseCase } from '../application/run-task.usecase';\n\nexport const probe = RunTaskUseCase;\n",
    expectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    // Anclado por segmento (D1 de ai-gateway-core): `application.entity` no es la carpeta `application`.
    name: 'a domain folder of the applications module imports its own entity',
    filePath: 'apps/api/src/modules/applications/domain/x.ts',
    code: "import { Application } from './application.entity';\n\nexport const probe = Application;\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [DOMAIN_IMPORTS],
  },
  // Dominio por módulo de api (D2 de auth-users), sobre módulos reales: el bloque por módulo reemplaza al genérico, así
  // que las filas de mongoose y ../application comprueban que conserva la lista de DOMAIN_RESTRICTED_PATTERNS.
  {
    name: 'El dominio importa otro módulo',
    filePath: 'apps/api/src/modules/auth/domain/probe.ts',
    code: "import { User } from '../../users/domain/user';\n\nexport const probe = User;\n",
    expectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    name: 'a nested file of the auth domain imports the users module',
    filePath: 'apps/api/src/modules/auth/domain/sub/probe.ts',
    code: "import { User } from '../../../users/domain/user';\n\nexport const probe = User;\n",
    expectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    name: 'the users domain imports the auth module',
    filePath: 'apps/api/src/modules/users/domain/probe.ts',
    code: "import { PasswordPolicy } from '../../auth/domain/password-policy';\n\nexport const probe = PasswordPolicy;\n",
    expectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    name: 'the auth domain imports mongoose',
    filePath: 'apps/api/src/modules/auth/domain/probe.ts',
    code: "import { Schema } from 'mongoose';\n\nexport const probe = Schema;\n",
    expectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    name: 'the auth domain imports its application layer',
    filePath: 'apps/api/src/modules/auth/domain/probe.ts',
    code: "import { LoginUseCase } from '../application/x';\n\nexport const probe = LoginUseCase;\n",
    expectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    name: 'El dominio importa su propio módulo',
    filePath: 'apps/api/src/modules/auth/domain/probe.ts',
    code: "import { PasswordPolicy } from './password-policy';\n\nexport const probe = PasswordPolicy;\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    // Una carpeta propia llamada como otro módulo no es ese módulo: el patrón exige subir con `../`.
    name: 'the auth domain imports its own folder named like another module',
    filePath: 'apps/api/src/modules/auth/domain/probe.ts',
    code: "import { User } from './users/domain/user';\n\nexport const probe = User;\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [DOMAIN_IMPORTS],
  },
  // Entrada pública entre módulos de api (D8 de groups), sobre módulos reales: `application/` e `infrastructure/`
  // solo alcanzan de otro módulo su facade, sus errores de dominio y sus dobles de test; `domain/` no tiene ninguna
  // de esas excepciones y `presentation/` queda fuera de la regla.
  {
    name: 'Un módulo lee el repositorio de otro',
    filePath: 'apps/api/src/modules/groups/application/probe.ts',
    code: "import { MongoUserRepository } from '../../users/infrastructure/mongo-user.repository';\n\nexport const probe = MongoUserRepository;\n",
    expectedRuleIds: [MODULE_IMPORTS],
  },
  {
    name: 'Un módulo usa la entrada pública de otro (la fachada)',
    filePath: 'apps/api/src/modules/groups/application/probe.ts',
    code: "import { UsersFacade } from '../../users/application/users.facade';\n\nexport const probe = UsersFacade;\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [MODULE_IMPORTS],
  },
  {
    name: 'Un módulo usa la entrada pública de otro (los errores de dominio)',
    filePath: 'apps/api/src/modules/groups/application/probe.ts',
    code: "import { UserNotFound } from '../../users/domain/errors';\n\nexport const probe = UserNotFound;\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [MODULE_IMPORTS],
  },
  {
    name: 'Un test usa el doble en memoria de otro módulo',
    filePath: 'apps/api/src/modules/groups/infrastructure/probe.spec.ts',
    code: "import { InMemoryUserRepository } from '../../users/application/testing/in-memory-user.repository';\n\nexport const probe = InMemoryUserRepository;\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [MODULE_IMPORTS],
  },
  {
    name: 'Cableado de Nest entre módulos',
    filePath: 'apps/api/src/modules/groups/presentation/probe.ts',
    code: "import { UsersModule } from '../../users/presentation/users.module';\n\nexport const probe = UsersModule;\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [MODULE_IMPORTS],
  },
  {
    name: 'El dominio no usa la entrada pública de otro',
    filePath: 'apps/api/src/modules/auth/domain/probe.ts',
    code: "import { UserNotFound } from '../../users/domain/errors';\n\nexport const probe = UserNotFound;\n",
    expectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    name: 'Acceso directo a las colecciones de grupos',
    filePath: 'apps/api/src/modules/users/application/probe.ts',
    code: "import { MongoGroupRepository } from '../../groups/infrastructure/mongo-group.repository';\n\nexport const probe = MongoGroupRepository;\n",
    expectedRuleIds: [MODULE_IMPORTS],
  },
  {
    // Spec links/sharing, "Acceso directo a las colecciones de links" (applications-tracking).
    name: 'Acceso directo a las colecciones de links (repositorio)',
    filePath: 'apps/api/src/modules/groups/infrastructure/probe.ts',
    code: "import { MongoJobLinkRepository } from '../../links/infrastructure/mongo-job-link.repository';\n\nexport const probe = MongoJobLinkRepository;\n",
    expectedRuleIds: [MODULE_IMPORTS],
  },
  {
    name: 'Acceso directo a las colecciones de links (schemas)',
    filePath: 'apps/api/src/modules/users/application/probe.ts',
    code: "import { jobLinkSchema } from '../../links/infrastructure/link.schemas';\n\nexport const probe = jobLinkSchema;\n",
    expectedRuleIds: [MODULE_IMPORTS],
  },
  {
    name: 'Un módulo usa la fachada de links',
    filePath: 'apps/api/src/modules/groups/infrastructure/probe.ts',
    code: "import { LinksFacade } from '../../links/application/links.facade';\n\nexport const probe = LinksFacade;\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [MODULE_IMPORTS],
  },
  {
    name: 'an infrastructure folder of api imports infrastructure (La infraestructura importa el framework)',
    filePath: 'apps/api/src/modules/probe/infrastructure/probe.ts',
    code: "import { Schema } from 'mongoose';\n\nexport const probe = Schema;\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    name: 'libs/ai evals imports ai.module',
    filePath: 'libs/ai/src/evals/runner/x.ts',
    code: "import { AiModule } from '../../ai.module';\n\nexport const probe = AiModule;\n",
    expectedRuleIds: [EVALS_IMPORTS],
  },
  {
    // `..` desde evals/runner resuelve a evals/index o src/index: cualquier barrel de libs/ai arrastra ai.module.
    name: 'libs/ai evals imports an index through ..',
    filePath: 'libs/ai/src/evals/runner/x.ts',
    code: "import * as ai from '..';\n\nexport const probe = ai;\n",
    expectedRuleIds: [EVALS_IMPORTS],
  },
  {
    name: 'libs/ai evals imports a concrete domain file',
    filePath: 'libs/ai/src/evals/runner/x.ts',
    code: "import { DEFAULT_DATA_SENSITIVITY } from '../../domain/task';\n\nexport const probe = DEFAULT_DATA_SENSITIVITY;\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [EVALS_IMPORTS],
  },
  {
    // El bloque de evals usa la regla base: la de SDKs (typescript-eslint) sigue aplicando sobre evals/.
    name: 'libs/ai evals imports an AI provider SDK',
    filePath: 'libs/ai/src/evals/runner/x.ts',
    code: "import OpenAI from 'openai';\n\nexport const probe = OpenAI;\n",
    expectedRuleIds: [AI_SDK_IMPORTS],
  },
  {
    name: 'libs/ai evals imports the Nest framework',
    filePath: 'libs/ai/src/evals/runner/x.ts',
    code: "import { Injectable } from '@nestjs/common';\n\nexport const probe = Injectable;\n",
    expectedRuleIds: [EVALS_IMPORTS],
  },
  {
    name: 'libs/ai evals imports mongoose',
    filePath: 'libs/ai/src/evals/runner/x.ts',
    code: "import { Schema } from 'mongoose';\n\nexport const probe = Schema;\n",
    expectedRuleIds: [EVALS_IMPORTS],
  },
  {
    name: 'libs/ai evals imports ioredis',
    filePath: 'libs/ai/src/evals/runner/x.ts',
    code: "import Redis from 'ioredis';\n\nexport const probe = Redis;\n",
    expectedRuleIds: [EVALS_IMPORTS],
  },
  {
    name: 'libs/ai evals imports the test doubles of application/testing',
    filePath: 'libs/ai/src/evals/runner/x.ts',
    code: "import * as doubles from '../../application/testing/in-memory-ports';\n\nexport const probe = doubles;\n",
    expectedRuleIds: [EVALS_IMPORTS],
  },
  {
    name: 'libs/ai evals imports an index through ./index',
    filePath: 'libs/ai/src/evals/runner/x.ts',
    code: "import * as barrel from './index';\n\nexport const probe = barrel;\n",
    expectedRuleIds: [EVALS_IMPORTS],
  },
  {
    // Anclado al segmento completo: `./indexer` no es un index.
    name: 'libs/ai evals imports a file whose name starts with index',
    filePath: 'libs/ai/src/evals/runner/x.ts',
    code: "import * as indexer from './indexer';\n\nexport const probe = indexer;\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [EVALS_IMPORTS],
  },
  {
    name: 'product code declares an explicit any',
    filePath: 'libs/shared/src/probe.ts',
    code: 'export const probe: any = 1;\n',
    expectedRuleIds: ['@typescript-eslint/no-explicit-any'],
  },
  {
    name: 'product code calls console.log',
    filePath: 'apps/worker/src/app/probe.ts',
    code: "export function probe(): void {\n  console.log('probe');\n}\n",
    expectedRuleIds: ['no-console'],
  },
];

function isRuleUnderTest(ruleId: string | null): ruleId is RuleUnderTest {
  return RULES_UNDER_TEST.some((rule) => rule === ruleId);
}

describe('workspace lint rules', () => {
  let eslint: ESLint;

  beforeAll(() => {
    eslint = new ESLint({ cwd: WORKSPACE_ROOT });
  });

  it.each(rows)(
    '$name',
    async ({ filePath, code, expectedRuleIds, unexpectedRuleIds = [] }) => {
      const [result] = await eslint.lintText(code, {
        filePath: join(WORKSPACE_ROOT, filePath),
      });

      expect(result).toBeDefined();
      const messages = result?.messages ?? [];
      expect(messages.filter((message) => message.fatal)).toEqual([]);

      const reported = [
        ...new Set(
          messages.map((message) => message.ruleId).filter(isRuleUnderTest),
        ),
      ].sort();

      expect(reported).toEqual([...expectedRuleIds].sort());
      for (const ruleId of unexpectedRuleIds) {
        expect(reported).not.toContain(ruleId);
      }

      const sdkMessages = messages.filter((message) =>
        AI_SDK_RULES.some((rule) => rule === message.ruleId),
      );
      for (const message of sdkMessages) {
        expect(message.message).toContain(AI_PROVIDERS_PATH);
      }
    },
    60_000,
  );
});
