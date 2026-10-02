import { test } from '@playwright/test';

/**
 * Recorrido con pasos declarados (design D11). Cada paso se ejecuta con `Journey.step`, que lo envuelve en un
 * `test.step` y lo apunta como `<persona>:<paso>`. Al final, `assertDeclared` compara lo ejecutado con la lista que el
 * perfil declara y falla nombrando el paso que falte o sobre: así «no aplicable» es una declaración comprobada, no un
 * `if` que puede tragarse un paso.
 */
export type Person = 'A' | 'B';

/** Clave de un paso ejecutado por una persona: `A:2`, `B:3`… */
export type StepKey = `${Person}:${string}`;

export class Journey {
  private readonly executed: StepKey[] = [];

  /** Ejecuta y apunta un paso. Solo se apunta si termina sin error: un paso que falla ya hace fallar la prueba. */
  async step(person: Person, id: string, title: string, body: () => Promise<void>): Promise<void> {
    await test.step(`step ${id} (${person}): ${title}`, body);
    this.executed.push(`${person}:${id}`);
  }

  /** Falla nombrando los pasos declarados que no se ejecutaron y los ejecutados que no estaban declarados. */
  assertDeclared(profile: string, declared: readonly StepKey[]): void {
    const missing = declared.filter((key) => !this.executed.includes(key));
    const extra = this.executed.filter((key) => !declared.includes(key));
    const repeated = this.executed.filter((key, index) => this.executed.indexOf(key) !== index);
    const problems = [
      ...(missing.length > 0 ? [`declared and not executed: ${missing.map(describe).join(', ')}`] : []),
      ...(extra.length > 0 ? [`executed and not declared: ${extra.map(describe).join(', ')}`] : []),
      ...(repeated.length > 0 ? [`executed more than once: ${repeated.map(describe).join(', ')}`] : []),
    ];
    if (problems.length > 0) {
      throw new Error(`profile ${profile}: the journey does not match its declared steps; ${problems.join('; ')}`);
    }
  }
}

function describe(key: StepKey): string {
  const [person, id] = key.split(':');
  return `step ${id ?? '?'} (${person ?? '?'})`;
}
