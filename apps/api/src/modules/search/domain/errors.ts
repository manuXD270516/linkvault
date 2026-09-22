// Errores de dominio del módulo search (change search, D1 / D7 / D9).

export class SearchError extends Error {
  readonly code: 'empty_query' | 'search_unavailable' | 'search_purge_failed';

  constructor(
    code: 'empty_query' | 'search_unavailable' | 'search_purge_failed',
    message: string,
  ) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
  }
}

export class EmptySearchQuery extends SearchError {
  constructor() {
    super('empty_query', 'Search query is empty');
    this.name = 'EmptySearchQuery';
  }
}

export class SearchUnavailable extends SearchError {
  constructor() {
    super('search_unavailable', 'Search is unavailable');
    this.name = 'SearchUnavailable';
  }
}

export class SearchPurgeFailed extends SearchError {
  constructor() {
    super('search_purge_failed', 'Search index purge failed');
    this.name = 'SearchPurgeFailed';
  }
}
