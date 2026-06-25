export type PortalTab = 'results' | 'graph' | 'assistant' | 'access';
export type AccessSection = 'users' | 'configuration' | 'integrations';

export interface PortalRouteState {
  tab: PortalTab;
  accountId?: string;
  graphQuery?: string;
  focusArn?: string;
  findingId?: string;
  accessSection?: AccessSection;
}

const TAB_PATHS: Record<PortalTab, string> = {
  results: '/results',
  graph: '/topology',
  assistant: '/assistant',
  access: '/settings',
};

const PATH_TABS: Record<string, PortalTab> = {
  '/results': 'results',
  '/topology': 'graph',
  '/assistant': 'assistant',
  '/settings': 'access',
};

export function tabToPath(tab: PortalTab): string {
  return TAB_PATHS[tab];
}

export function pathToTab(path: string): PortalTab | null {
  return PATH_TABS[path] ?? null;
}

export function readRouteFromLocation(): PortalRouteState {
  const hash = window.location.hash.replace(/^#/, '') || '/results';
  const [pathPart, queryPart = ''] = hash.split('?');
  const path = pathPart || '/results';
  const params = new URLSearchParams(queryPart);

  const tab = pathToTab(path) ?? 'results';
  const accessRaw = params.get('section');
  const accessSection =
    accessRaw === 'users' || accessRaw === 'configuration' || accessRaw === 'integrations'
      ? accessRaw
      : undefined;

  return {
    tab,
    accountId: params.get('account') || undefined,
    graphQuery: params.get('graph') || undefined,
    focusArn: params.get('focus') || undefined,
    findingId: params.get('finding') || undefined,
    accessSection,
  };
}

export function writeRouteToLocation(state: PortalRouteState, replace = false): void {
  const path = tabToPath(state.tab);
  const params = new URLSearchParams();

  if (state.accountId) params.set('account', state.accountId);
  if (state.tab === 'graph' && state.graphQuery) params.set('graph', state.graphQuery);
  if (state.tab === 'graph' && state.focusArn) params.set('focus', state.focusArn);
  if (state.tab === 'results' && state.findingId) params.set('finding', state.findingId);
  if (state.tab === 'access' && state.accessSection) params.set('section', state.accessSection);

  const query = params.toString();
  const nextHash = query ? `${path}?${query}` : path;
  const currentHash = window.location.hash.replace(/^#/, '');
  if (currentHash === nextHash) return;

  if (replace) {
    window.history.replaceState({ portalRoute: state }, '', `#${nextHash}`);
  } else {
    window.location.hash = nextHash;
  }
}

export function subscribeToRouteChanges(onChange: () => void): () => void {
  const handler = () => onChange();
  window.addEventListener('hashchange', handler);
  window.addEventListener('popstate', handler);
  return () => {
    window.removeEventListener('hashchange', handler);
    window.removeEventListener('popstate', handler);
  };
}
