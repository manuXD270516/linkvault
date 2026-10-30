import { TestBed } from '@angular/core/testing';
import type { RequestFailure } from '../app/core/api/api-error';
import { RequestError } from '../app/shared/ui/request-error';

/** Renderiza el componente y devuelve el texto del `role="alert"` y el de la línea de referencia (o `null`). */
export function renderRequestError(failure: RequestFailure): {
  alert: string;
  reference: string | null;
  alertCount: number;
  host: HTMLElement;
} {
  const fixture = TestBed.createComponent(RequestError);
  fixture.componentRef.setInput('failure', failure);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const alerts = host.querySelectorAll('[role="alert"]');
  const reference = host.querySelector('[data-testid="error-reference"]');
  const normalize = (text: string | null | undefined): string =>
    (text ?? '').replace(/\s+/g, ' ').trim();
  return {
    alert: normalize(alerts[0]?.textContent),
    reference: reference === null ? null : normalize(reference.textContent),
    alertCount: alerts.length,
    host,
  };
}
