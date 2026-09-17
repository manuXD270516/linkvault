import type { AiTask, AiTaskName } from '../domain/task';

// Registro de tareas de IA (D2 de ai-gateway-core, requisito "Punto de entrada único" de task-execution).
// Lo usan AiModule al arrancar y el modo synth del mock para encontrar `task.sample`.

export type AnyAiTask = AiTask<unknown, unknown>;

/** Intentos por proveedor: 1 sin reparación, 2 con una reparación (D3). */
const ALLOWED_MAX_ATTEMPTS: ReadonlySet<number> = new Set([1, 2]);

export class InvalidTaskRegistration extends Error {
  override readonly name = 'InvalidTaskRegistration';

  constructor(
    readonly taskName: string,
    detail: string,
  ) {
    super(`Cannot register AI task "${taskName}": ${detail}`);
  }
}

export class TaskRegistry {
  private readonly tasks = new Map<AiTaskName, AnyAiTask>();

  constructor(tasks: Iterable<AnyAiTask> = []) {
    for (const task of tasks) this.register(task);
  }

  /** Lanza `InvalidTaskRegistration` si el nombre ya existe o `budget.maxAttempts` no es 1 ni 2. */
  register(task: AnyAiTask): void {
    if (this.tasks.has(task.name)) {
      throw new InvalidTaskRegistration(
        task.name,
        'a task with this name is already registered',
      );
    }
    if (!ALLOWED_MAX_ATTEMPTS.has(task.budget.maxAttempts)) {
      throw new InvalidTaskRegistration(
        task.name,
        `budget.maxAttempts must be 1 or 2, got ${String(task.budget.maxAttempts)}`,
      );
    }
    this.tasks.set(task.name, task);
  }

  get(name: string): AnyAiTask | undefined {
    return this.tasks.get(name as AiTaskName);
  }

  list(): readonly AnyAiTask[] {
    return [...this.tasks.values()];
  }
}
