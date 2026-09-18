import {
  extractJobOutputSchema,
  PREVIEW_SKILLS_MAX,
  PREVIEW_SUMMARY_MAX_LENGTH,
  type ExtractJobOutput,
  type JobModality,
  type JobSeniority,
  type JobSkill,
} from '@linkvault/shared';
import { z } from 'zod';
import type { AiTask, Rng } from '../domain/task';

// Tarea `extract-job` (D7 de link-enrichment): del texto limpio de una página a una vacante estructurada.
// `public` porque la página es pública y su lectura no depende del consentimiento de nadie; el texto llega ya sin
// emails ni teléfonos del anuncio (los quita `infrastructure/html/` del worker), así que no hay PII que redactar.
//
// La salida NO es `jobPreviewSchema` a secas, sino `{ isJobPosting, preview | null }`: con un schema que exige
// `title`, un modelo a temperatura 0 inventa un título para un vídeo de YouTube. El discriminador es lo que permite
// que el motivo `not_a_job` del enriquecimiento exista.
//
// `outputLanguage` es fijo `es` y por eso el prompt no lo interpola, sino que pide español en firme: el `JobLink` es
// canónico y compartido, así que su preview no puede depender de las preferencias de quien lo guardó. Quien llama deja
// `ctx.outputLanguage` sin poner. De ahí que una vacante en inglés se espere resumida y titulada en español; lo único
// que no se traduce es `company`, que es un nombre propio.

/**
 * Longitud máxima del texto que se envía al proveedor, recortada aquí y no al contexto del proveedor elegido: la clave
 * determinista se calcula antes del routing (ADR-018 §3), así que una entrada que dependiera del proveedor haría
 * inservibles los fixtures, la caché y la línea base.
 */
export const EXTRACT_JOB_TEXT_MAX_LENGTH = 24_000;

/**
 * Entrada de la tarea: el texto limpio de la página, recortado por el propio schema. Recortar en vez de rechazar es
 * deliberado: una página larga es normal y `runTask` propaga el `ZodError` de un input inválido, lo que convertiría
 * una vacante extensa en un job fallido en vez de en una extracción sobre sus primeros 24 000 caracteres.
 */
export const extractJobInputSchema = z
  .object({ text: z.string().min(1) })
  .transform(({ text }) => ({
    text: text.slice(0, EXTRACT_JOB_TEXT_MAX_LENGTH),
  }));
export type ExtractJobInput = z.output<typeof extractJobInputSchema>;

export { extractJobOutputSchema, type ExtractJobOutput };

/**
 * Señales de que lo leído es **un** aviso de empleo, para la muestra de `synth`. Son marcas del cuerpo de una oferta,
 * no del vocabulario del sector: "empleos" o "trabajo" aparecen igual en la portada de una bolsa, que es justo la
 * trampa que el discriminador existe para no caer.
 */
const JOB_POSTING_MARKERS: readonly RegExp[] = [
  /\bvacante\b/iu,
  /\bbuscamos\b/iu,
  /\bconvocatoria\b/iu,
  /\brequisitos\b/iu,
  /\bresponsabilidades\b/iu,
  /\bpostula\w*\b/iu,
  /\bofrecemos\b/iu,
  /\bwe\s+are\s+(?:looking\s+for|hiring)\b/iu,
  /\brequirements\b/iu,
  /\bresponsibilities\b/iu,
  /\bwhat\s+you(?:'ll| will)\s+do\b/iu,
];

const MODALITY_MARKERS: readonly { modality: JobModality; pattern: RegExp }[] =
  [
    {
      modality: 'remote',
      pattern: /\b(?:remot\w+|teletrabajo|home\s?office)\b/iu,
    },
    { modality: 'hybrid', pattern: /\b(?:h[íi]brid\w+|hybrid)\b/iu },
    { modality: 'onsite', pattern: /\b(?:presencial|on-?site|in-?office)\b/iu },
  ];

const SENIORITY_MARKERS: readonly {
  seniority: JobSeniority;
  pattern: RegExp;
}[] = [
  { seniority: 'intern', pattern: /\b(?:pasant\w+|practicante|intern)\b/iu },
  { seniority: 'lead', pattern: /\b(?:lead|l[íi]der|jefe|head\s+of)\b/iu },
  { seniority: 'senior', pattern: /\b(?:senior|sr\.?)\b/iu },
  { seniority: 'junior', pattern: /\b(?:junior|jr\.?|trainee)\b/iu },
  {
    seniority: 'mid',
    pattern: /\b(?:semi\s?senior|ssr\.?|mid-?level|mid)\b/iu,
  },
];

/** Tecnologías de la lista corta embebida para la muestra de `synth`; no pretende ser exhaustiva. */
const KNOWN_TECHNOLOGIES: readonly string[] = [
  'TypeScript',
  'JavaScript',
  'Python',
  'Java',
  'Go',
  'SQL',
  'NestJS',
  'Angular',
  'React',
  'Vue',
  'Django',
  'Spring',
  'Node.js',
  'AWS',
  'Azure',
  'Kubernetes',
  'Docker',
  'Linux',
  'MongoDB',
  'PostgreSQL',
  'MySQL',
  'Redis',
  'Git',
  'Terraform',
  'Figma',
  'Excel',
  'Power BI',
];

/** Desde aquí lo que se pide es deseable, no obligatorio. */
const NICE_TO_HAVE =
  /\b(?:deseable|valorad\w+|valoramos|se\s+valora|plus|nice\s+to\s+have|opcional)\b/iu;

const LANGUAGE_MARKERS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'Inglés', pattern: /\b(?:ingl[ée]s|english)\b/iu },
  { name: 'Portugués', pattern: /\b(?:portugu[ée]s|portuguese)\b/iu },
  { name: 'Francés', pattern: /\b(?:franc[ée]s|french)\b/iu },
];

/** `Empresa: Acme`, `Company: Acme`. Solo una etiqueta explícita: adivinar la empresa es trabajo del modelo. */
const COMPANY_LABEL = /^[ \t]*(?:empresa|company)[ \t]*:[ \t]*(.+)$/imu;
const LOCATION_LABEL =
  /^[ \t]*(?:ubicaci[óo]n|location|ciudad)[ \t]*:[ \t]*(.+)$/imu;

const TITLE_MAX_LENGTH = 120;

/**
 * Muestra determinista para el modo `synth` del mock: reglas sobre el texto, nunca datos inventados. `rng` solo
 * desempata tecnologías que aparecen en la misma posición, igual que en `classify-skills`.
 */
export function sampleExtractJob(
  input: ExtractJobInput,
  rng: Rng,
): ExtractJobOutput {
  const title = firstNonEmptyLine(input.text);
  const isJobPosting =
    title !== null && JOB_POSTING_MARKERS.some((m) => m.test(input.text));
  if (!isJobPosting || title === null) {
    return { isJobPosting: false, preview: null };
  }

  return {
    isJobPosting: true,
    preview: {
      title: title.slice(0, TITLE_MAX_LENGTH),
      company: labelled(input.text, COMPANY_LABEL),
      location: labelled(input.text, LOCATION_LABEL),
      modality: sampleModality(input.text),
      seniority: sampleSeniority(input.text),
      salary: null,
      skills: sampleSkills(input.text, rng),
      languages: LANGUAGE_MARKERS.filter(({ pattern }) =>
        pattern.test(input.text),
      ).map(({ name }) => ({ name, level: null })),
      summary: collapse(input.text).slice(0, PREVIEW_SUMMARY_MAX_LENGTH),
      postedAt: null,
      expiresAt: null,
    },
  };
}

export const extractJobTask: AiTask<ExtractJobInput, ExtractJobOutput> = {
  name: 'extract-job',
  promptVersion: 'v1',
  inputSchema: extractJobInputSchema,
  outputSchema: extractJobOutputSchema,
  // 8 000 tokens es el contexto declarado por el Ollama local (`OLLAMA_MAX_CONTEXT_TOKENS`, 8192): pedir más dejaría
  // a `extract-job` sin ningún proveedor elegible y la degradaría siempre en local.
  requires: { jsonMode: true, maxContextTokens: 8_000 },
  temperature: 0,
  // Un preview completo con sus skills y su resumen cabe de sobra; 2 intentos = una reparación por proveedor.
  budget: { maxTokens: 1_536, maxAttempts: 2 },
  dataSensitivity: 'public',
  sample: sampleExtractJob,
};

function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed;
  }
  return null;
}

function labelled(text: string, pattern: RegExp): string | null {
  const value = pattern.exec(text)?.[1]?.trim();
  return value === undefined || value === '' ? null : value;
}

function sampleModality(text: string): JobModality {
  return (
    MODALITY_MARKERS.find(({ pattern }) => pattern.test(text))?.modality ??
    'unknown'
  );
}

function sampleSeniority(text: string): JobSeniority {
  return (
    SENIORITY_MARKERS.find(({ pattern }) => pattern.test(text))?.seniority ??
    'unknown'
  );
}

/** Tecnologías presentes en el texto, en orden de aparición; obligatorias hasta el bloque de "deseable". */
function sampleSkills(text: string, rng: Rng): JobSkill[] {
  const niceToHaveAt =
    NICE_TO_HAVE.exec(text)?.index ?? Number.POSITIVE_INFINITY;
  const found = KNOWN_TECHNOLOGIES.flatMap((name) => {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`,
      'iu',
    );
    const position = pattern.exec(text)?.index;
    return position === undefined ? [] : [{ name, position, tieBreak: rng() }];
  });
  found.sort((a, b) => a.position - b.position || a.tieBreak - b.tieBreak);

  return found
    .slice(0, PREVIEW_SKILLS_MAX)
    .map(({ name, position }) => ({ name, required: position < niceToHaveAt }));
}

function collapse(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
