// Clave de habilidad (design D3): NFKC, recortada, espacios internos colapsados y en minúsculas.

export const SKILL_KEY_MAX_LENGTH = 60;

/** `null` si la clave queda vacía o supera 60 caracteres: esa habilidad se ignora. */
export function skillKeyOf(name: string): string | null {
  const key = name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return key.length === 0 || key.length > SKILL_KEY_MAX_LENGTH ? null : key;
}

/**
 * Forma a mostrar de una clave: la más frecuente entre las formas originales recortadas (una vez por oferta);
 * en empate, la menor por orden de unidades de código.
 */
export function pickSkillLabel(forms: readonly string[]): string {
  if (forms.length === 0) {
    throw new Error('pickSkillLabel needs at least one form');
  }
  const counts = new Map<string, number>();
  for (const form of forms) {
    counts.set(form, (counts.get(form) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [form, count] of counts) {
    if (count > bestCount || (count === bestCount && form < best)) {
      best = form;
      bestCount = count;
    }
  }
  return best;
}
