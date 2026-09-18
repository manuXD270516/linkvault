// Rescate por historial (D7 de paste-job-description), puro: qué otras URLs de la misma vacante se pueden probar cuando
// el `robots.txt` niega la `displayUrl`. El permiso y el turno son del servicio; esto solo decide el orden y el filtro.
//
// - **Solo del mismo host**: se prueban dentro del turno que ya se tiene, y el turno y el `Crawl-delay` de otro host
//   son otros. Pedirle algo a un host sin su turno sería saltarse la cortesía de ADR-003.
// - **Las más recientes primero**: `originalUrls` va de la más antigua a la más reciente, y la última que alguien
//   guardó es la que con más probabilidad está limpia (el caso del smoke: la misma vacante sin `search_id`).
// - **Sin repetidas y sin la propia `displayUrl`**, que ya se preguntó.

/** Host de una URL, o `null` si no es una dirección. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Las URLs del historial que merece la pena probar, en el orden en que se prueban. */
export function historyRescueUrls(
  displayUrl: string,
  originalUrls: readonly string[],
): string[] {
  const host = hostOf(displayUrl);
  if (host === null) return [];

  const seen = new Set<string>([displayUrl]);
  const candidates: string[] = [];
  for (const url of [...originalUrls].reverse()) {
    if (seen.has(url)) continue;
    seen.add(url);
    if (hostOf(url) === host) candidates.push(url);
  }
  return candidates;
}
