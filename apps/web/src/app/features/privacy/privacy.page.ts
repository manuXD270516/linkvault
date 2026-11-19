import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

/**
 * Aviso público de privacidad (`/privacidad`, spec web/privacy, D4/D5). Sin sesión: CV (dónde se guarda,
 * cifrado en reposo SSE en prod, sin caducidad automática), IA/OpenRouter/BYOK, cómo borrar la cuenta y las copias de
 * seguridad (ADR-066: cifradas fuera del servidor, plazo máximo de borrado, últimas 24 h y lo borrado que puede volver).
 */
@Component({
  selector: 'lv-privacy-page',
  imports: [MatButtonModule, RouterLink],
  templateUrl: './privacy.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyPage {}
