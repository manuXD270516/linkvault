// CLI provisional (tarea 1.2 de ai-eval-harness): solo imprime los argumentos recibidos para comprobar el target de Nx.
// Lo reemplaza la implementación real del harness (D2, D6).

export {};

async function main(argv: readonly string[]): Promise<void> {
  process.stdout.write(`eval args: ${JSON.stringify(argv)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
