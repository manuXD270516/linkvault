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
const AI_SDK_IMPORTS = '@typescript-eslint/no-restricted-imports';

const rows: readonly RuleRow[] = [
  {
    name: 'production code of api imports a type:test-util project',
    filePath: 'apps/api/src/app/probe.ts',
    code: "import { RedisPingDouble } from '@linkvault/testing';\n\nexport const probe = RedisPingDouble;\n",
    expectedRuleIds: [BOUNDARIES],
  },
  {
    // tools/workspace-rules (type:tooling) no tiene alias a propósito: nadie debe importarlo. La fila usa
    // una ruta relativa, que la regla rechaza igualmente.
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
    // Las apps no tienen alias: una lib solo podría alcanzarlas por ruta relativa, que la regla rechaza.
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
    name: 'a domain folder of api imports infrastructure',
    filePath: 'apps/api/src/modules/probe/domain/probe.ts',
    code: "import { Schema } from 'mongoose';\n\nexport const probe = Schema;\n",
    expectedRuleIds: [DOMAIN_IMPORTS],
  },
  {
    name: 'an infrastructure folder of api imports infrastructure',
    filePath: 'apps/api/src/modules/probe/infrastructure/probe.ts',
    code: "import { Schema } from 'mongoose';\n\nexport const probe = Schema;\n",
    expectedRuleIds: [],
    unexpectedRuleIds: [DOMAIN_IMPORTS],
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
    },
    60_000,
  );
});
