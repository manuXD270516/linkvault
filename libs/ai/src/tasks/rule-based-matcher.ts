import type {
  MatchReportCore,
  MissingSkill,
  SkillImportance,
} from '@linkvault/shared';

// Degradación honesta de `match-cv` (B15, ADR-014, ADR-030): cruce por diccionario de las skills de la vacante
// contra el texto del CV. Sin sugerencias: eso es trabajo del modelo.

/** Peso de un requisito imprescindible frente a uno deseable al calcular el score. */
const MUST_WEIGHT = 2;
const NICE_WEIGHT = 1;

/**
 * Alias canónicos → formas en que pueden aparecer en el CV (sin distinguir mayúsculas).
 * La clave es la forma normalizada del nombre declarado en la vacante.
 */
const SKILL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  typescript: ['typescript', 'ts'],
  javascript: ['javascript', 'js'],
  kubernetes: ['kubernetes', 'k8s'],
  postgresql: ['postgresql', 'postgres', 'psql'],
  mongodb: ['mongodb', 'mongo'],
  'node.js': ['node.js', 'nodejs', 'node'],
  'c#': ['c#', 'csharp', 'c-sharp'],
  'c/c++': ['c/c++', 'c++', 'cpp'],
  '.net': ['.net', 'dotnet', 'asp.net'],
  react: ['react', 'react.js', 'reactjs'],
  angular: ['angular'],
  nestjs: ['nestjs', 'nest.js'],
  docker: ['docker'],
  redis: ['redis'],
  aws: ['aws', 'amazon web services'],
  python: ['python'],
  java: ['java'],
  go: ['go', 'golang'],
  sql: ['sql'],
};

export interface JobSkillForMatch {
  name: string;
  importance: SkillImportance;
}

export interface RuleBasedMatchInput {
  jobSkills: readonly JobSkillForMatch[];
  cvText: string;
}

/**
 * Cruza las skills de la vacante contra el texto del CV. Normaliza nombres, aplica alias y deriva un score del
 * peso de `must` frente a `nice`. Sin skills declaradas: score 100 y listas vacías (no hay huecos que reportar).
 */
export function matchByRules(input: RuleBasedMatchInput): MatchReportCore {
  const matchedSkills: string[] = [];
  const missingSkills: MissingSkill[] = [];
  let matchedWeight = 0;
  let totalWeight = 0;

  for (const skill of input.jobSkills) {
    const weight = skill.importance === 'must' ? MUST_WEIGHT : NICE_WEIGHT;
    totalWeight += weight;
    if (cvMentionsSkill(input.cvText, skill.name)) {
      matchedSkills.push(skill.name);
      matchedWeight += weight;
    } else {
      missingSkills.push({ name: skill.name, importance: skill.importance });
    }
  }

  const score =
    totalWeight === 0
      ? 100
      : Math.round((100 * matchedWeight) / totalWeight);

  return {
    score,
    matchedSkills,
    missingSkills,
    suggestions: [],
  };
}

/** `true` si el CV menciona la skill (nombre o alias), con límite de palabra. */
export function cvMentionsSkill(cvText: string, skillName: string): boolean {
  const normalized = normalizeSkillName(skillName);
  const aliases = SKILL_ALIASES[normalized] ?? [normalized];
  return aliases.some((alias) => skillPattern(alias).test(cvText));
}

function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function skillPattern(alias: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(alias)}(?![\\p{L}\\p{N}])`,
    'iu',
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
