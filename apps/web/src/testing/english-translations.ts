import { clearTranslations, loadTranslations } from '@angular/localize';
import enMessages from '../locale/messages.en.xlf' with { loader: 'text' };

/**
 * Convierte el `target` de cada unidad de `messages.en.xlf` al formato de `loadTranslations`: los marcadores
 * `<x id="NAME"/>` pasan a `{$NAME}`. Solo para tests: permite afirmar el texto inglés exacto sin compilar el SPA en `en`.
 */
function englishTranslations(): Record<string, string> {
  const document = new DOMParser().parseFromString(enMessages, 'application/xml');
  const result: Record<string, string> = {};
  for (const unit of Array.from(document.getElementsByTagName('trans-unit'))) {
    const target = unit.getElementsByTagName('target')[0];
    if (target === undefined) {
      continue;
    }
    result[unit.getAttribute('id') ?? ''] = Array.from(target.childNodes)
      .map((node) =>
        node.nodeType === 1 ? `{$${(node as Element).getAttribute('id') ?? ''}}` : (node.textContent ?? ''),
      )
      .join('');
  }
  return result;
}

/** Activa el catálogo inglés para los `$localize` siguientes; devolver el `restore` en `afterEach`. */
export function useEnglishTranslations(): () => void {
  loadTranslations(englishTranslations());
  return () => {
    clearTranslations();
  };
}
