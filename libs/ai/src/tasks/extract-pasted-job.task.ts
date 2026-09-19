import {
  extractJobOutputSchema,
  PASTED_TEXT_MAX_LENGTH,
  type ExtractJobOutput,
} from '@linkvault/shared';
import { z } from 'zod';
import type { AiTask, Rng } from '../domain/task';
import { sampleExtractJob } from './extract-job.task';

// Tarea `extract-pasted-job` (D2 de paste-job-description): del texto que una persona copió y pegó a una vacante
// estructurada, con **la misma salida** que `extract-job` —`{ isJobPosting, preview | null }`— para que `api` la mezcle
// en el preview igual que el worker mezcla lo leído de la página.
//
// Es una tarea aparte, y no `extract-job` con otra entrada, porque lo pegado no es una página publicada: es lo que la
// persona copió, y puede traer el nombre del reclutador, trozos de un chat o mensajes de terceros. Por eso es
// `personal` (ADR-018 §11): sin el consentimiento de quien pega no va a un proveedor externo, y si va, pasa por el
// `PiiRedactor`. Su prompt es propio (`extract-pasted-job.v1.md`), derivado del de `extract-job` más la regla de no
// reproducir nombres de personas en `summary`; tocar el de `extract-job` obligaría a una `v2` y a regrabar los fixtures
// de las páginas, que no cambian. Su clave determinista no se cruza con la de las páginas: el nombre de la tarea es
// parte de ella.
//
// El texto llega **ya pasado por `scrubContactDetails`** (`libs/shared`), así que sin emails ni teléfonos y en una sola
// línea. `outputLanguage` es fijo `es`, como en `extract-job`: el preview es compartido (ADR-022 §6).

/**
 * Título o empresa que la persona escribió aparte en el diálogo de pegado. Una cadena vacía o de solo espacios cuenta
 * como no escrita: así `''` y la ausencia dan la misma clave determinista, y quien llama no tiene que acordarse de
 * quitarla.
 */
const knownHeaderSchema = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
  });

/**
 * Entrada de la tarea: el texto pegado, ya limpio, y como contexto el título y la empresa escritos aparte, para que el
 * modelo no invente un título que el texto copiado del móvil no trae. Todo forma parte de la clave determinista.
 *
 * El texto se recorta a `PASTED_TEXT_MAX_LENGTH` en vez de rechazarse, como en `extract-job`: `api` ya rechaza un texto
 * más largo antes de limpiarlo, y la limpieza nunca lo alarga, así que el recorte solo es una defensa para que un
 * llamador distinto no convierta un texto largo en un `ZodError`. Las claves ausentes se omiten del objeto parseado.
 */
export const extractPastedJobInputSchema = z
  .object({
    text: z.string().trim().min(1),
    knownTitle: knownHeaderSchema,
    knownCompany: knownHeaderSchema,
  })
  .transform(({ text, knownTitle, knownCompany }) => ({
    text: text.slice(0, PASTED_TEXT_MAX_LENGTH),
    ...(knownTitle === undefined ? {} : { knownTitle }),
    ...(knownCompany === undefined ? {} : { knownCompany }),
  }));
export type ExtractPastedJobInput = z.output<
  typeof extractPastedJobInputSchema
>;

export { extractJobOutputSchema as extractPastedJobOutputSchema };
export type ExtractPastedJobOutput = ExtractJobOutput;

const TITLE_MAX_LENGTH = 120;

/**
 * Muestra determinista para el modo `synth` del mock. Reutiliza las reglas de `extract-job` para decidir si es una
 * oferta y leer modalidad, nivel, habilidades e idiomas, con dos diferencias:
 *
 * - el título y la empresa escritos aparte mandan; sin ellos, el título es la primera frase del texto (llega en una
 *   sola línea) y la empresa queda en `null`, porque adivinarla es trabajo del modelo;
 * - `summary` queda vacío: copiar el texto, como hace la muestra de páginas, reproduciría el nombre del reclutador.
 */
export function sampleExtractPastedJob(
  input: ExtractPastedJobInput,
  rng: Rng,
): ExtractPastedJobOutput {
  const base = sampleExtractJob({ text: input.text }, rng);
  const title = input.knownTitle ?? firstSentence(input.text);
  if (!base.isJobPosting || base.preview === null || title === null) {
    return { isJobPosting: false, preview: null };
  }
  return {
    isJobPosting: true,
    preview: {
      ...base.preview,
      title: title.slice(0, TITLE_MAX_LENGTH),
      company: input.knownCompany ?? null,
      location: null,
      summary: '',
    },
  };
}

export const extractPastedJobTask: AiTask<
  ExtractPastedJobInput,
  ExtractPastedJobOutput
> = {
  name: 'extract-pasted-job',
  promptVersion: 'v1',
  inputSchema: extractPastedJobInputSchema,
  outputSchema: extractJobOutputSchema,
  // Los mismos límites que `extract-job`: 8 000 tokens es el contexto del Ollama local y caben los 20 000 caracteres
  // que admite el pegado más el prompt.
  requires: { jsonMode: true, maxContextTokens: 8_000 },
  temperature: 0,
  budget: { maxTokens: 1_536, maxAttempts: 2 },
  dataSensitivity: 'personal',
  sample: sampleExtractPastedJob,
};

/** Primera frase no vacía del texto, o `null`. */
function firstSentence(text: string): string | null {
  const sentence = /^[^.!?\n]+/u.exec(text.trim())?.[0]?.trim();
  return sentence === undefined || sentence === '' ? null : sentence;
}
