import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { shareScopeText, shareToggleLabel } from './share-scope';

/** "Qué verán": la misma explicación que acompaña al interruptor del panel (D7). */
@Component({
  selector: 'lv-share-scope-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ title }}</h2>
    <mat-dialog-content>
      <p data-testid="share-scope-text">{{ scope }}</p>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-flat-button type="button" mat-dialog-close i18n="@@applications.share.understood">
        Entendido
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareScopeDialog {
  protected readonly title = shareToggleLabel();
  protected readonly scope = shareScopeText();
}
