/** Origen base de la API, fijado en build (`EXTENSION_API_BASE_URL`). Sin barra final. */
export function apiBaseUrl(): string {
  return __EXTENSION_API_BASE_URL__.replace(/\/$/, '');
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${apiBaseUrl()}${normalized}`;
}
