/** Lo que el borrador necesita de una acción `follow_up` (design D9). */
export interface FollowUpDraftInput {
  readonly title?: string | undefined;
  readonly company?: string | undefined;
  /** Fecha de postulación (ISO); sin ella el borrador dice «hace un tiempo». */
  readonly appliedAt?: string | undefined;
}

/**
 * Borrador de seguimiento por plantilla (design D9): tres líneas, en el idioma de la interfaz, armadas aquí con
 * `$localize`. Sin IA, sin destinatario y sin guardar nada. No promete adjuntos ni conversaciones previas y cierra con
 * una pregunta abierta sobre el proceso.
 *
 * @param locale idioma de la interfaz (`LOCALE_ID`), solo para dar formato largo a la fecha.
 */
export function followUpDraft(input: FollowUpDraftInput, locale: string): string {
  const title = nonEmpty(input.title) ?? $localize`:@@applications.weeklyPlan.draft.fallbackTitle:la vacante`;
  const company = nonEmpty(input.company) ?? $localize`:@@applications.weeklyPlan.draft.fallbackCompany:su empresa`;
  const date = input.appliedAt === undefined ? null : longDate(input.appliedAt, locale);
  const greeting = $localize`:@@applications.weeklyPlan.draft.greeting:Hola:`;
  const body =
    date === null
      ? $localize`:@@applications.weeklyPlan.draft.bodyUndated:Hace un tiempo me postulé a ${title}:TITLE: en ${company}:COMPANY:. Sigo con mucho interés en el puesto.`
      : $localize`:@@applications.weeklyPlan.draft.bodyDated:Me postulé a ${title}:TITLE: en ${company}:COMPANY: el ${date}:DATE:. Sigo con mucho interés en el puesto.`;
  const question = $localize`:@@applications.weeklyPlan.draft.question:¿Me podrían contar en qué estado está el proceso de selección?`;
  return `${greeting}\n${body}\n${question}`;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function longDate(iso: string, locale: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date);
}
