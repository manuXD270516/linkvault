import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import Mustache from 'mustache';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type {
  PromptRef,
  PromptRegistry,
  PromptView,
  RenderedPrompt,
} from '../../domain/ports/prompt-registry.port';

// Prompts versionados en archivos (design-v0.2 §4.6, D7 de ai-gateway-core, requisito "Prompts versionados").
// `<promptsDir>/<task>.<version>.md`: front-matter YAML con `task` y `version`, y dos secciones `# system` y `# user`.
// Plantillas Mustache sin lógica renderizadas sin escapar (`escape` por llamada, sin tocar `Mustache.escape` global).

export class InvalidPrompt extends Error {
  override readonly name = 'InvalidPrompt';

  constructor(
    readonly taskName: string,
    readonly promptVersion: string,
    detail: string,
  ) {
    super(
      `Prompt of task "${taskName}" version "${promptVersion}" is not usable: ${detail}`,
    );
  }
}

interface PromptTemplate {
  system: string;
  user: string;
}

const frontMatterSchema = z.object({
  task: z.string().min(1),
  version: z.string().min(1),
});

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?/;
const SECTION_HEADING = /^# (system|user)[ \t]*$/gm;

const noEscape = (value: string): string => value;

export interface FilePromptRegistryOptions {
  /** Directorio de prompts; si es relativo se resuelve contra `process.cwd()` (D7). */
  promptsDir: string;
}

export class FilePromptRegistry implements PromptRegistry {
  private readonly promptsDir: string;
  private readonly templates = new Map<string, Promise<PromptTemplate>>();

  constructor(options: FilePromptRegistryOptions) {
    this.promptsDir = resolve(process.cwd(), options.promptsDir);
  }

  async ensure(ref: PromptRef): Promise<void> {
    await this.template(ref);
  }

  async render(ref: PromptRef, view: PromptView): Promise<RenderedPrompt> {
    const template = await this.template(ref);
    const renderOptions = { escape: noEscape };
    return {
      system: Mustache.render(template.system, view, {}, renderOptions),
      user: Mustache.render(template.user, view, {}, renderOptions),
    };
  }

  private template(ref: PromptRef): Promise<PromptTemplate> {
    const cacheKey = `${ref.taskName}@${ref.promptVersion}`;
    let template = this.templates.get(cacheKey);
    if (template === undefined) {
      template = this.load(ref);
      // Un fallo no se cachea: permite corregir el archivo sin reiniciar en desarrollo.
      template.catch(() => this.templates.delete(cacheKey));
      this.templates.set(cacheKey, template);
    }
    return template;
  }

  private async load(ref: PromptRef): Promise<PromptTemplate> {
    const fileName = `${ref.taskName}.${ref.promptVersion}.md`;
    let raw: string;
    try {
      raw = await readFile(join(this.promptsDir, fileName), 'utf8');
    } catch {
      throw new InvalidPrompt(
        ref.taskName,
        ref.promptVersion,
        `file ${fileName} not found in the prompts directory`,
      );
    }
    return parsePromptFile(ref, raw.replace(/\r\n/g, '\n'));
  }
}

function parsePromptFile(ref: PromptRef, content: string): PromptTemplate {
  const fail = (detail: string): never => {
    throw new InvalidPrompt(ref.taskName, ref.promptVersion, detail);
  };

  const frontMatter = FRONT_MATTER.exec(content);
  if (frontMatter === null) return fail('missing front-matter');

  let metadata: unknown;
  try {
    metadata = parseYaml(frontMatter[1] ?? '');
  } catch {
    return fail('front-matter is not valid YAML');
  }
  const parsed = frontMatterSchema.safeParse(metadata);
  if (!parsed.success) {
    return fail('front-matter must declare task and version');
  }
  if (parsed.data.task !== ref.taskName) {
    return fail(`front-matter task "${parsed.data.task}" does not match`);
  }
  if (parsed.data.version !== ref.promptVersion) {
    return fail(`front-matter version "${parsed.data.version}" does not match`);
  }

  const body = content.slice(frontMatter[0].length);
  const headings = [...body.matchAll(SECTION_HEADING)];
  const [systemHeading, userHeading] = headings;
  if (
    headings.length !== 2 ||
    systemHeading?.[1] !== 'system' ||
    userHeading?.[1] !== 'user'
  ) {
    return fail('body must contain "# system" followed by "# user"');
  }

  const system = body
    .slice(systemHeading.index + systemHeading[0].length, userHeading.index)
    .trim();
  const user = body.slice(userHeading.index + userHeading[0].length).trim();
  if (system.length === 0 || user.length === 0) {
    return fail('"# system" and "# user" sections must not be empty');
  }
  try {
    Mustache.parse(system);
    Mustache.parse(user);
  } catch {
    return fail('template is not valid Mustache');
  }
  return { system, user };
}
