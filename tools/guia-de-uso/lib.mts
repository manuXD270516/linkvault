/**
 * Utilidades del script de capturas de la guía de uso: registro de casos con su resultado, capturas numeradas con
 * máscaras, lectura de Mailpit y estado compartido entre fases. No depende de `apps/` ni de `libs/` salvo lo que
 * importa `capture.mts` (la oferta y el CV versionados del camino crítico).
 */
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const WEB = process.env['GUIA_WEB'] ?? 'http://localhost:4300';
export const API = process.env['GUIA_API'] ?? 'http://localhost:3100';
export const MAIL = process.env['GUIA_MAIL'] ?? 'http://localhost:8125';
export const WEB_EN = process.env['GUIA_WEB_EN'] ?? 'http://localhost:4301/en';
export const OUT_DIR =
  process.env['GUIA_OUT'] ?? join(process.cwd(), 'docs', 'guia-de-uso', 'img');
export const STATE_FILE =
  process.env['GUIA_STATE'] ??
  join(process.cwd(), 'tools', 'guia-de-uso', '.state.json');
export const RESULTS_FILE =
  process.env['GUIA_RESULTS'] ??
  join(process.cwd(), 'tools', 'guia-de-uso', 'resultados.json');

/** Contraseñas inventadas, solo para esta pila desechable. */
export const PASSWORDS = {
  ana: 'guia-ana-clave-uno-2026',
  anaNueva: 'guia-ana-clave-dos-2026',
  anaOtra: 'guia-ana-clave-tres-2026',
  beto: 'guia-beto-clave-2026',
  carla: 'guia-carla-clave-2026',
  diego: 'guia-diego-clave-2026',
};

export interface CaseResult {
  id: string;
  section: string;
  title: string;
  ok: boolean;
  seen: string;
  shots: string[];
}

/** Estado que sobrevive entre ejecuciones parciales (`--only=`), no entre pilas. */
export interface State {
  runId: string;
  [key: string]: string | number | boolean | undefined;
}

export function loadState(): State {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
  }
  return { runId: String(Date.now()) };
}

export function saveState(state: State): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function pad(n: number): string {
  return String(n).padStart(3, '0');
}

/** Registro de casos y de capturas, con numeración global por orden de ejecución. */
export class Recorder {
  readonly results: CaseResult[] = [];
  private counter = 0;
  private current: CaseResult | undefined;

  constructor(
    readonly outDir: string,
    startAt = 0,
  ) {
    this.counter = startAt;
    mkdirSync(outDir, { recursive: true });
  }

  get next(): number {
    return this.counter;
  }

  /** Ejecuta un caso: un fallo (excepción) se anota como FALLO con su mensaje y el script sigue. */
  async run(
    section: string,
    id: string,
    title: string,
    fn: () => Promise<string | void>,
  ): Promise<void> {
    const entry: CaseResult = {
      id,
      section,
      title,
      ok: false,
      seen: '',
      shots: [],
    };
    this.current = entry;
    this.results.push(entry);
    try {
      const seen = await fn();
      entry.ok = true;
      entry.seen = seen ?? '';
      process.stdout.write(`  OK    ${id} ${title}\n`);
    } catch (error) {
      entry.ok = false;
      entry.seen = (error instanceof Error ? error.message : String(error))
        .split('\n')
        .slice(0, 6)
        .join(' | ');
      process.stdout.write(`  FALLO ${id} ${title}\n        ${entry.seen}\n`);
    } finally {
      this.current = undefined;
    }
  }

  /** Captura con máscara de lo sensible; devuelve el nombre del fichero. */
  async shot(
    page: Page,
    slug: string,
    options: { full?: boolean; mask?: Locator[]; locator?: Locator } = {},
  ): Promise<string> {
    this.counter += 1;
    const name = `${pad(this.counter)}-${slug}.png`;
    const dialogOpen =
      (await page.locator('.mat-mdc-dialog-container').count()) > 0;
    const masks = [
      ...(dialogOpen ? dialogMasks(page) : defaultMasks(page)),
      ...(options.mask ?? []),
    ];
    const target = options.locator;
    if (target !== undefined) {
      await target.screenshot({
        path: join(this.outDir, name),
        mask: masks,
        animations: 'disabled',
      });
    } else {
      await page.screenshot({
        path: join(this.outDir, name),
        fullPage: dialogOpen ? false : (options.full ?? true),
        mask: masks,
        animations: 'disabled',
      });
    }
    this.current?.shots.push(name);
    return name;
  }

  save(file: string): void {
    writeFileSync(file, `${JSON.stringify(this.results, null, 2)}\n`);
  }
}

/** Con un diálogo abierto, las máscaras de la página de fondo taparían el diálogo: solo se enmascara lo del diálogo. */
function dialogMasks(page: Page): Locator[] {
  const dialog = page.locator('.mat-mdc-dialog-container');
  return [
    dialog.locator('input[type="password"]'),
    dialog.locator('[data-testid="cv-preview-text"]'),
    dialog.locator('[data-testid="match-suggestion-cv"]'),
    dialog.getByLabel(/código/i),
    page.locator('[data-testid="invite-code"]'),
    page.locator('[data-testid="invitation-fallback"]'),
  ];
}

/** Campos que nunca deben verse en una captura: contraseñas, código de invitación, claves de IA y texto de CV. */
function defaultMasks(page: Page): Locator[] {
  return [
    page.locator('input[type="password"]'),
    page.locator('[data-testid="invite-code"]'),
    page.locator('[data-testid^="profile-byok-key-"]'),
    page.locator('[data-testid="cv-preview-text"]'),
    page.locator('[data-testid="match-suggestion-cv"]'),
    page.locator('[data-testid="invitation-fallback"]'),
  ];
}

/** Arma una página del contexto con la sesión de la persona (login por API; la cookie queda en el contexto). */
export async function loginByApi(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<void> {
  const response = await context.request.post(`${API}/api/auth/login`, {
    headers: { 'X-Requested-With': 'linkvault' },
    data: { email, password },
  });
  if (!response.ok()) {
    throw new Error(`login por API de ${email}: ${response.status()}`);
  }
}

interface MailMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Snippet: string;
}

export async function mailMessages(
  request: APIRequestContext,
): Promise<MailMessage[]> {
  const response = await request.get(`${MAIL}/api/v1/messages?limit=100`);
  const body = (await response.json()) as { messages: MailMessage[] };
  return body.messages;
}

/** Primer enlace del cuerpo del último correo para `to` cuyo asunto contiene `subject`. */
export async function mailLink(
  request: APIRequestContext,
  to: string,
  subject: string,
  pattern: RegExp,
): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const messages = await mailMessages(request);
    const found = messages.find(
      (m) =>
        m.Subject.includes(subject) &&
        m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()),
    );
    if (found !== undefined) {
      const detail = (await (
        await request.get(`${MAIL}/api/v1/message/${found.ID}`)
      ).json()) as {
        Text: string;
        HTML: string;
      };
      const match = pattern.exec(`${detail.Text}\n${detail.HTML}`);
      if (match !== null) {
        return match[0].replace(/&amp;/g, '&');
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no llegó el correo «${subject}» para ${to}`);
}

export async function newActor(
  browser: Browser,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: WEB,
    viewport: { width: 1280, height: 800 },
    locale: 'es-ES',
    ...options,
  });
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();
  return { context, page };
}
