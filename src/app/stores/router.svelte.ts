// Einfaches Hash-Routing (überlebt Neuladen im Standalone-Modus).

export type Route =
  | { name: 'library'; section: 'docs'; folderId: string | null }
  | { name: 'library'; section: 'recent' | 'favorites' | 'trash' }
  | { name: 'notebook'; id: string; page?: number; pageId?: string };

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  switch (parts[0]) {
    case 'f':
      return { name: 'library', section: 'docs', folderId: parts[1] ?? null };
    case 'recent':
    case 'favorites':
    case 'trash':
      return { name: 'library', section: parts[0] };
    case 'nb':
      if (parts[1]) {
        const p = parts[2];
        if (!p) return { name: 'notebook', id: parts[1] };
        return /^\d+$/.test(p)
          ? { name: 'notebook', id: parts[1], page: Number(p) }
          : { name: 'notebook', id: parts[1], pageId: p };
      }
      break;
  }
  return { name: 'library', section: 'docs', folderId: null };
}

export function href(r: Route): string {
  if (r.name === 'notebook')
    return `#/nb/${r.id}${r.pageId ? `/${r.pageId}` : r.page !== undefined ? `/${r.page}` : ''}`;
  if (r.section === 'docs') return r.folderId ? `#/f/${r.folderId}` : '#/';
  return `#/${r.section}`;
}

class Router {
  route = $state<Route>(parse(typeof location !== 'undefined' ? location.hash : ''));

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => (this.route = parse(location.hash)));
    }
  }

  go(r: Route) {
    location.hash = href(r);
  }

  /** Ersetzt den Eintrag, ohne einen neuen Verlaufsschritt anzulegen. */
  replace(r: Route) {
    history.replaceState(null, '', href(r));
    this.route = r;
  }
}

export const router = new Router();
