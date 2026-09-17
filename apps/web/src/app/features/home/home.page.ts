import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SessionStore } from '../../core/auth/session.store';

@Component({
  selector: 'lv-home-page',
  templateUrl: './home.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  private readonly session = inject(SessionStore);

  protected readonly displayName = computed(() => this.session.user()?.displayName ?? '');
}
