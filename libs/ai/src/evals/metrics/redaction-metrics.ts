import {
  PiiRedactor,
  type RedactionOptions,
} from '../../application/pii-redactor';
import type {
  GoldenCase,
  GoldenPiiAnnotation,
} from '../evaluable-task';
import { literalHaystack } from '../golden.schema';
import { meanOfDefined } from '../metrics/name-set';
import type { MetricValue } from '../metrics/metric';

// Métricas de redacción para tareas `personal` con anotaciones (ADR-030 §2/§14, tareas 6.9–6.11). Se calculan
// aplicando el redactor como si el proveedor fuera `external`, con `redactName` activado y el `personName` del caso,
// sin contactar a nadie y contando también los casos degradados.

export const REDACTION_SKILL_LOSS = 'redaction_skill_loss';
export const PII_LEAK_RATE = 'pii_leak_rate';
export const PII_KNOWN_GAP_RATE = 'pii_known_gap_rate';

export type RedactFn = (
  input: unknown,
  options: RedactionOptions,
) => unknown;

const defaultRedactor = new PiiRedactor();

export const defaultExternalRedact: RedactFn = (input, options) =>
  defaultRedactor.redact(input, options).value;

export interface CaseRedactionScores {
  id: string;
  /** `null` si el caso no anota `skills`. */
  skillLoss: number | null;
  /** `null` si no hay anotaciones de PII sin `knownGap`. */
  leakRate: number | null;
  /** `null` si el caso no anota PII. */
  knownGapRate: number | null;
  /** Huecos conocidos que siguen apareciendo tras redactar. */
  observedGaps: readonly { gapId: string; caseId: string }[];
  /** Tipos de PII sin marca que siguen literales (para el reporte; nunca el valor). */
  leakedTypes: readonly string[];
}

export interface RedactionMetricsResult {
  metrics: readonly MetricValue[];
  cases: readonly CaseRedactionScores[];
  /** `id` de casos con skill loss ≠ 0. */
  skillLossCaseIds: readonly string[];
  /** `id` de casos con fuga ≠ 0. */
  leakCaseIds: readonly string[];
  /** Huecos observados con el `id` del caso. */
  observedGaps: readonly { gapId: string; caseId: string }[];
  /** Huecos marcados que ya no se observan. */
  closedGaps: readonly { gapId: string; caseId: string }[];
}

/** ¿El golden trae alguna anotación de redacción computable? */
export function hasRedactionAnnotations(
  cases: readonly GoldenCase<unknown, unknown>[],
): boolean {
  return cases.some(
    (c) => (c.pii?.length ?? 0) > 0 || (c.skills?.length ?? 0) > 0,
  );
}

export function scoreCaseRedaction(
  goldenCase: GoldenCase<unknown, unknown>,
  redact: RedactFn = defaultExternalRedact,
): CaseRedactionScores {
  const options: RedactionOptions = {
    redactName: true,
    ...(goldenCase.personName === undefined
      ? {}
      : { personName: goldenCase.personName }),
  };
  const redacted = redact(goldenCase.input, options);
  const haystack = literalHaystack(redacted);

  const skills = goldenCase.skills ?? [];
  const skillLoss =
    skills.length === 0
      ? null
      : skills.filter((term) => !haystack.includes(term)).length / skills.length;

  const pii = goldenCase.pii ?? [];
  const withoutGap = pii.filter((a) => a.knownGap === undefined);
  const leakRate =
    withoutGap.length === 0
      ? null
      : withoutGap.filter((a) => haystack.includes(a.value)).length /
        withoutGap.length;
  const leakedTypes = withoutGap
    .filter((a) => haystack.includes(a.value))
    .map((a) => a.type);

  const knownGapRate =
    pii.length === 0
      ? null
      : pii.filter(
          (a) => a.knownGap !== undefined && haystack.includes(a.value),
        ).length / pii.length;

  const observedGaps = pii.flatMap((a) =>
    a.knownGap !== undefined && haystack.includes(a.value)
      ? [{ gapId: a.knownGap, caseId: goldenCase.id }]
      : [],
  );

  return {
    id: goldenCase.id,
    skillLoss,
    leakRate,
    knownGapRate,
    observedGaps,
    leakedTypes,
  };
}

/**
 * Agrega las tres métricas como media de los casos con anotaciones computables. `pii_known_gap_rate` es informativa.
 */
export function computeRedactionMetrics(
  cases: readonly GoldenCase<unknown, unknown>[],
  redact: RedactFn = defaultExternalRedact,
): RedactionMetricsResult | null {
  if (!hasRedactionAnnotations(cases)) return null;

  const scored = cases.map((c) => scoreCaseRedaction(c, redact));
  const skillLossCaseIds = scored
    .filter((s) => s.skillLoss !== null && s.skillLoss !== 0)
    .map((s) => s.id);
  const leakCaseIds = scored
    .filter((s) => s.leakRate !== null && s.leakRate !== 0)
    .map((s) => s.id);
  const observedGaps = scored.flatMap((s) => s.observedGaps);

  const closedGaps = cases.flatMap((goldenCase) => {
    const score = scored.find((s) => s.id === goldenCase.id);
    if (score === undefined) return [];
    return (goldenCase.pii ?? []).flatMap((a: GoldenPiiAnnotation) => {
      if (a.knownGap === undefined) return [];
      const stillLeaking = score.observedGaps.some(
        (g) => g.gapId === a.knownGap && g.caseId === goldenCase.id,
      );
      return stillLeaking
        ? []
        : [{ gapId: a.knownGap, caseId: goldenCase.id }];
    });
  });

  const metrics: MetricValue[] = [
    {
      name: REDACTION_SKILL_LOSS,
      kind: 'blocking',
      direction: 'lower',
      value: meanOfDefined(scored.map((s) => s.skillLoss)),
    },
    {
      name: PII_LEAK_RATE,
      kind: 'blocking',
      direction: 'lower',
      value: meanOfDefined(scored.map((s) => s.leakRate)),
    },
    {
      name: PII_KNOWN_GAP_RATE,
      kind: 'informational',
      direction: 'lower',
      value: meanOfDefined(scored.map((s) => s.knownGapRate)),
    },
  ];

  return {
    metrics,
    cases: scored,
    skillLossCaseIds,
    leakCaseIds,
    observedGaps,
    closedGaps,
  };
}
