import { describe, expect, it } from 'vitest';
import enMessages from '../../../locale/messages.en.xlf' with {
  loader: 'text',
};
import { parseXlfUnits } from '../../../locale/privacy-text';
import type { RequestFailure } from '../../core/api/api-error';
import { renderRequestError } from '../../../testing/request-error-testing';

const UNAVAILABLE =
  'LinkVault no está disponible en este momento. Inténtalo en unos minutos';
const UNEXPECTED = 'Algo salió mal. Inténtalo de nuevo';
const OFFLINE = 'No pudimos conectar con LinkVault. Revisa tu conexión';

function api(
  status: number,
  code: string | null,
  retryAfterMinutes: number | null = null,
): RequestFailure {
  return { kind: 'api', status, code, retryAfterMinutes };
}

describe('RequestError', () => {
  it('offline shows the connection text', () => {
    const view = renderRequestError({ kind: 'offline' });
    expect(view.alert).toBe(OFFLINE);
  });

  it('503 with a fallback code shows unavailable', () => {
    const view = renderRequestError(api(503, 'search_purge_failed'));
    expect(view.alert).toBe(UNAVAILABLE);
  });

  it('502 with a non-api body shows unavailable', () => {
    const view = renderRequestError(api(502, null));
    expect(view.alert).toBe(UNAVAILABLE);
  });

  it('504 without body shows unavailable', () => {
    const view = renderRequestError(api(504, null));
    expect(view.alert).toBe(UNAVAILABLE);
  });

  it('too_many_attempts keeps its minutes', () => {
    expect(renderRequestError(api(429, 'too_many_attempts', 3)).alert).toBe(
      'Demasiados intentos. Vuelve a intentarlo en 3 minutos',
    );
    expect(renderRequestError(api(429, 'too_many_attempts', 1)).alert).toBe(
      'Demasiados intentos. Vuelve a intentarlo en 1 minuto',
    );
    expect(renderRequestError(api(429, 'too_many_attempts')).alert).toBe(
      'Demasiados intentos. Vuelve a intentarlo más tarde',
    );
  });

  it('500 internal_error shows the unexpected text', () => {
    const view = renderRequestError(api(500, 'internal_error'));
    expect(view.alert).toBe(UNEXPECTED);
  });

  it('409 already_owner shows the unexpected text', () => {
    expect(renderRequestError(api(409, 'already_owner')).alert).toBe(
      UNEXPECTED,
    );
  });

  it('a 503 with a local code shows the unexpected text', () => {
    const view = renderRequestError(api(503, 'search_unavailable'));
    expect(view.alert).toBe(UNEXPECTED);
    expect(view.alert).not.toBe(UNAVAILABLE);
  });

  it('a 503 with a code outside the table shows the unexpected text', () => {
    expect(renderRequestError(api(503, 'brand_new_code')).alert).toBe(
      UNEXPECTED,
    );
  });

  it('a non-http failure shows the unexpected text', () => {
    expect(renderRequestError({ kind: 'unknown' }).alert).toBe(UNEXPECTED);
  });

  it('the api message is never shown', () => {
    const failure = {
      ...api(500, 'internal_error'),
      message: 'Internal server error',
    };
    const view = renderRequestError(failure);
    expect(view.host.textContent).not.toContain('Internal server error');
  });

  describe('reference line', () => {
    it('unexpected failure shows Si lo reportas, menciona: 500 · internal_error outside the alert', () => {
      const view = renderRequestError(api(500, 'internal_error'));
      expect(view.reference).toBe(
        'Si lo reportas, menciona: 500 · internal_error',
      );
      expect(
        view.host.querySelector(
          '[role="alert"] [data-testid="error-reference"]',
        ),
      ).toBeNull();
    });

    it('the alert text is exactly the message', () => {
      const view = renderRequestError(api(500, 'internal_error'));
      expect(view.alertCount).toBe(1);
      expect(view.alert).toBe(UNEXPECTED);
    });

    it('a 502 without code shows Si lo reportas, menciona: 502', () => {
      expect(renderRequestError(api(502, null)).reference).toBe(
        'Si lo reportas, menciona: 502',
      );
    });

    it('an unknown body code shows only the status', () => {
      const view = renderRequestError(api(500, 'secret_internal_detail'));
      expect(view.reference).toBe('Si lo reportas, menciona: 500');
      expect(view.host.textContent).not.toContain('secret_internal_detail');
    });

    it('a prototype key is not a known code', () => {
      const view = renderRequestError(api(500, 'toString'));
      expect(view.reference).toBe('Si lo reportas, menciona: 500');
      expect(view.host.textContent).not.toContain('toString');
    });

    it('no reference for an own text', () => {
      expect(
        renderRequestError(api(404, 'member_not_found')).reference,
      ).toBeNull();
    });

    it('no reference when offline', () => {
      expect(renderRequestError({ kind: 'offline' }).reference).toBeNull();
    });

    it('no reference for a non-http failure', () => {
      expect(renderRequestError({ kind: 'unknown' }).reference).toBeNull();
    });
  });

  describe('common texts by code', () => {
    it('member_not_found shows its own text', () => {
      expect(renderRequestError(api(404, 'member_not_found')).alert).toBe(
        'Esa persona ya no está en el grupo. Recarga la página para ver la lista actual',
      );
    });

    it('owner_cannot_leave shows its own text', () => {
      expect(renderRequestError(api(409, 'owner_cannot_leave')).alert).toBe(
        'Ahora eres propietario de este grupo. Recarga la página y nombra propietario a otro miembro para poder salir',
      );
    });

    it('consent_text_outdated shows its own text', () => {
      expect(renderRequestError(api(409, 'consent_text_outdated')).alert).toBe(
        'El texto del permiso cambió. Recarga la página para leer la versión vigente',
      );
    });

    it('vault_unavailable shows its own text', () => {
      expect(renderRequestError(api(503, 'vault_unavailable')).alert).toBe(
        'LinkVault no tiene activado el guardado de claves de IA. Tu clave no se guardó',
      );
    });

    it('own text wins over the status', () => {
      const view = renderRequestError(api(503, 'vault_unavailable'));
      expect(view.alert).not.toBe(UNAVAILABLE);
      expect(view.alert).not.toBe(UNEXPECTED);
    });
  });

  describe('english', () => {
    const units = parseXlfUnits(enMessages);

    it('english unavailable text', () => {
      expect(units.get('error.unavailable')?.target?.trim()).toBe(
        'LinkVault is not available right now. Try again in a few minutes',
      );
    });

    it('english texts of the new ids', () => {
      const expected: Record<string, string> = {
        'error.memberNotFound':
          'That person is no longer in the group. Reload the page to see the current list',
        'error.ownerCannotLeave':
          'You are now the owner of this group. Reload the page and make another member the owner to leave',
        'error.consentTextOutdated':
          'The consent text changed. Reload the page to read the current version',
        'error.vaultUnavailable':
          'Saving AI keys is not enabled in LinkVault. Your key was not saved',
      };
      for (const [id, text] of Object.entries(expected)) {
        expect(units.get(id)?.target?.trim(), id).toBe(text);
      }
      expect(units.get('error.reference')?.target).toContain(
        'If you report it, mention:',
      );
      expect(units.get('error.referenceStatusOnly')?.target).toContain(
        'If you report it, mention:',
      );
    });
  });
});
