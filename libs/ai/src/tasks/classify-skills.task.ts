import { z } from 'zod';
import type { AiTask, Rng } from '../domain/task';

// Tarea de ejemplo `classify-skills` (D13 de ai-gateway-core): identifica y clasifica las skills de un texto.
// `personal` porque puede recibir texto de un CV. Sin `degrade`: si no hay IA, degrada sin salida.

export const skillCategorySchema = z.enum([
  'language',
  'framework',
  'tool',
  'platform',
  'soft',
  'domain',
  'other',
]);
export type SkillCategory = z.infer<typeof skillCategorySchema>;

export const classifySkillsInputSchema = z.object({
  text: z.string().min(1).max(20_000),
});
export type ClassifySkillsInput = z.infer<typeof classifySkillsInputSchema>;

export const classifySkillsOutputSchema = z.object({
  skills: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        category: skillCategorySchema,
      }),
    )
    .max(60),
});
export type ClassifySkillsOutput = z.infer<typeof classifySkillsOutputSchema>;

interface KnownSkill {
  name: string;
  category: SkillCategory;
  /** Formas en que puede aparecer en el texto, sin distinguir mayúsculas; incluye el nombre. */
  aliases: readonly string[];
}

/** Lista corta embebida para la muestra de `synth` (D13). No pretende ser exhaustiva. */
const KNOWN_SKILLS: readonly KnownSkill[] = [
  { name: 'TypeScript', category: 'language', aliases: ['typescript'] },
  { name: 'JavaScript', category: 'language', aliases: ['javascript'] },
  { name: 'Python', category: 'language', aliases: ['python'] },
  { name: 'Java', category: 'language', aliases: ['java'] },
  { name: 'SQL', category: 'language', aliases: ['sql'] },
  { name: 'NestJS', category: 'framework', aliases: ['nestjs', 'nest.js'] },
  { name: 'Angular', category: 'framework', aliases: ['angular'] },
  { name: 'React', category: 'framework', aliases: ['react', 'react.js'] },
  { name: 'Spring', category: 'framework', aliases: ['spring', 'spring boot'] },
  { name: 'Node.js', category: 'platform', aliases: ['node.js', 'nodejs'] },
  { name: 'AWS', category: 'platform', aliases: ['aws'] },
  { name: 'Kubernetes', category: 'platform', aliases: ['kubernetes', 'k8s'] },
  { name: 'Linux', category: 'platform', aliases: ['linux'] },
  { name: 'MongoDB', category: 'tool', aliases: ['mongodb', 'mongo'] },
  { name: 'PostgreSQL', category: 'tool', aliases: ['postgresql', 'postgres'] },
  { name: 'Redis', category: 'tool', aliases: ['redis'] },
  { name: 'Docker', category: 'tool', aliases: ['docker'] },
  { name: 'Git', category: 'tool', aliases: ['git'] },
  { name: 'Scrum', category: 'domain', aliases: ['scrum'] },
  {
    name: 'Trabajo en equipo',
    category: 'soft',
    aliases: ['trabajo en equipo', 'teamwork'],
  },
  { name: 'Comunicación', category: 'soft', aliases: ['comunicación'] },
  {
    name: 'Inglés',
    category: 'other',
    aliases: ['inglés', 'ingles', 'english'],
  },
];

const ALIAS_PATTERNS = KNOWN_SKILLS.map((skill) => ({
  skill,
  patterns: skill.aliases.map(
    (alias) =>
      new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(alias)}(?![\\p{L}\\p{N}])`,
        'iu',
      ),
  ),
}));

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Muestra determinista para el modo `synth`: las skills de la lista embebida presentes en el texto, en orden de
 * primera aparición. `rng` solo desempata skills que aparecen en la misma posición. Nunca añade skills ausentes.
 */
export function sampleClassifySkills(
  input: ClassifySkillsInput,
  rng: Rng,
): ClassifySkillsOutput {
  const found = ALIAS_PATTERNS.flatMap(({ skill, patterns }) => {
    const positions = patterns
      .map((pattern) => pattern.exec(input.text)?.index)
      .filter((index): index is number => index !== undefined);
    return positions.length === 0
      ? []
      : [{ skill, position: Math.min(...positions) }];
  });
  // Un valor de desempate por skill encontrada, en el orden fijo de la lista: mismo input y semilla, misma salida.
  const ranked = found.map((entry) => ({ ...entry, tieBreak: rng() }));
  ranked.sort((a, b) => a.position - b.position || a.tieBreak - b.tieBreak);

  return {
    skills: ranked
      .slice(0, 60)
      .map(({ skill }) => ({ name: skill.name, category: skill.category })),
  };
}

export const classifySkillsTask: AiTask<
  ClassifySkillsInput,
  ClassifySkillsOutput
> = {
  name: 'classify-skills',
  promptVersion: 'v1',
  inputSchema: classifySkillsInputSchema,
  outputSchema: classifySkillsOutputSchema,
  requires: { jsonMode: true, maxContextTokens: 8_000 },
  temperature: 0,
  budget: { maxTokens: 1_024, maxAttempts: 2 },
  dataSensitivity: 'personal',
  cacheable: false,
  sample: sampleClassifySkills,
};
