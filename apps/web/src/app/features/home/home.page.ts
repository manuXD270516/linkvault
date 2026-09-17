import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'lv-home-page',
  templateUrl: './home.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {}
