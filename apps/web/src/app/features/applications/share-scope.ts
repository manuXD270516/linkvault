/**
 * Qué ve el grupo cuando se comparte (D7, ADR-024 §7). Es el mismo texto junto al interruptor del panel y en "Qué
 * verán" del aviso tras el gesto, así que vive una sola vez en i18n.
 */
export function shareScopeText(): string {
  return $localize`:@@applications.share.scope:Te verán los miembros de tus grupos donde esté esta oferta, ahora o más adelante, incluidos quienes se unan después. Verán tu nombre y tu estado, también cuando cambie (por ejemplo, «Rechazada»). Nunca la etapa, las notas ni el historial. Puedes dejar de compartir cuando quieras.`;
}

export function shareToggleLabel(): string {
  return $localize`:@@applications.share.toggle:Compartir mi estado con mis grupos`;
}
