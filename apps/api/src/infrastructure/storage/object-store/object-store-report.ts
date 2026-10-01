// Salida del script `object-store` (design D4 de `object-store`): una línea por comprobación, legible en el log de la
// verificación del artefacto y del despliegue, y la lista de lo que no quedó como se exige, que decide el código de
// salida. Nunca lleva valores de credenciales ni claves de objetos de CV.

export type ReportLevel = 'ok' | 'note' | 'fail';

export interface ReportLine {
  readonly level: ReportLevel;
  readonly text: string;
}

export class ObjectStoreReport {
  private readonly entries: ReportLine[] = [];

  /** Lo que quedó como se exige. */
  ok(text: string): void {
    this.entries.push({ level: 'ok', text });
  }

  /** Una observación que no es un fallo (p. ej. «este almacén no tiene políticas de bucket»). */
  note(text: string): void {
    this.entries.push({ level: 'note', text });
  }

  /** Algo que no quedó como se exige. Nombra el bucket y la propiedad. */
  fail(text: string): void {
    this.entries.push({ level: 'fail', text });
  }

  get lines(): readonly ReportLine[] {
    return this.entries;
  }

  get failures(): readonly string[] {
    return this.entries
      .filter((entry) => entry.level === 'fail')
      .map((entry) => entry.text);
  }

  get passed(): boolean {
    return this.failures.length === 0;
  }

  /** Texto para la consola: `ok    …`, `note  …`, `FAIL  …` y un resumen final con lo que falló. */
  render(command: string): string {
    const body = this.entries.map((entry) => {
      const tag =
        entry.level === 'ok'
          ? 'ok  '
          : entry.level === 'note'
            ? 'note'
            : 'FAIL';
      return `${tag}  ${entry.text}`;
    });
    const summary = this.passed
      ? `${command}: ok`
      : `${command}: FAILED (${this.failures.length}): ${this.failures.join('; ')}`;
    return `${[...body, summary].join('\n')}\n`;
  }
}
