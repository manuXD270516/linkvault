import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

/**
 * Aviso público de privacidad (`/privacidad`, spec web/privacy, D4/D5). Sin sesión: CV (dónde se guarda,
 * cifrado en reposo SSE en prod, sin caducidad automática), IA/OpenRouter/BYOK y cómo borrar la cuenta.
 */
@Component({
  selector: 'lv-privacy-page',
  imports: [MatButtonModule, RouterLink],
  templateUrl: './privacy.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyPage {}
