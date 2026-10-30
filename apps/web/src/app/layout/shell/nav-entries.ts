/** Capacidad del despliegue que una entrada necesita (spec platform/capabilities). */
export type NavCapability = 'search' | 'discovery';

export interface NavEntry {
  readonly route: string;
  readonly label: string;
  /** Sin capacidad, la entrada se muestra siempre. */
  readonly capability?: NavCapability;
}

/**
 * Única fuente de las dos presentaciones de la barra (ancha y compacta; D9 de web-shell-capabilities). Lo que lleva a
 * guardar y seguir ofertas va primero; las funciones opcionales, después. «Cerrar sesión» queda fuera de la lista, al
 * final. El texto de la marca no está aquí: no es una entrada.
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { route: '/grupos', label: $localize`:@@shell.groups:Grupos` },
  { route: '/mis-links', label: $localize`:@@shell.myLinks:Solo para mí` },
  {
    route: '/postulaciones',
    label: $localize`:@@shell.applications:Postulaciones`,
  },
  { route: '/mi-cv', label: $localize`:@@shell.myCv:Mi CV` },
  {
    route: '/buscar',
    label: $localize`:@@shell.search:Buscar`,
    capability: 'search',
  },
  {
    route: '/descubrir',
    label: $localize`:@@shell.discovery:Descubrir`,
    capability: 'discovery',
  },
  { route: '/perfil', label: $localize`:@@shell.profile:Perfil` },
];
