// Connected apps (preview, sample data): the outside services Lay AI and the Letters page can work with, and
// which of them the person has linked. A service is linked only when the person connects it, and unlinked
// whenever they choose or when they delete their account. Gmail is the only one that can be connected now;
// the others say plainly why they cannot be, so nobody waits for a button that will not come.
// One state is shared by the Settings page and the Letters page. DOM-free, so tests/connections-rules.test.js
// can run it in Node; the real build keeps this in a `connections` table (docs/prototype-spec.md, RB-CON).

/**
 * `status` says what the person can do with it: `connectable` (a Connect button), `import` (no sign-in, they
 * bring their own export), `built-in` (always on, needs nothing from them), `planned` (not yet) or
 * `unavailable` (the service gives no way in). `does` is what Coverlay uses it for, `asks` what it asks the
 * service for, `note` the plain reason or the next step.
 */
export const CONNECTORS = [
  {
    id: 'gmail',
    label: 'Gmail',
    group: 'Email',
    status: 'connectable',
    does: 'Saves the cold email as a draft, or sends it when you press Send, with your resume and cover letter attached.',
    asks: 'Permission to save drafts and to send the messages you choose. It cannot read your inbox.',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    group: 'Profile',
    status: 'import',
    does: 'Fills your first Builder version from your profile.',
    note: 'LinkedIn only lets approved partners read profiles, so there is no sign-in. Save your profile to PDF on LinkedIn and bring it in; nothing else is read.',
    href: 'resume-builder.html#linkedin',
    linkLabel: 'Import from LinkedIn',
  },
  {
    id: 'job-boards',
    label: 'Company job boards',
    detail: 'Lever, Greenhouse, Ashby',
    group: 'Job search',
    status: 'built-in',
    does: 'Where Jobs for you and your Watchlist come from: the public pages of company job boards.',
    note: 'On for everyone. It needs nothing from you.',
  },
  {
    id: 'job-services',
    label: 'Job search services',
    detail: 'Adzuna, JSearch and others',
    group: 'Job search',
    status: 'planned',
    does: 'More jobs, in every field and not only the companies we read directly, so Lay AI can suggest roles across domains.',
    note: 'Planned. Coverlay uses only what a service\'s terms allow.',
  },
  {
    id: 'naukri',
    label: 'Naukri',
    group: 'Job search',
    status: 'unavailable',
    does: 'Would show its listings.',
    note: 'Naukri has no public job search API and does not allow scraping, so Coverlay cannot read it. If Naukri ever offers a partner API, a connector can follow.',
  },
  {
    id: 'custom',
    label: 'Your own connector (MCP)',
    group: 'Your own',
    status: 'planned',
    does: 'Add an MCP server you run, to give Lay AI one more source. Coverlay shows the tools it offers and what each reads, and you turn it on.',
    note: 'Later. Until then, connectors are the ones above.',
  },
];

export const STATUS_LABELS = {
  connectable: 'Not connected',
  import: 'Import only',
  'built-in': 'Built in',
  planned: 'Planned',
  unavailable: 'Not available',
};

export function connectorById(id) {
  return CONNECTORS.find((connector) => connector.id === id) ?? null;
}

/** The badge words for a connector: "Connected" or "Not connected" for one that can be linked, else its status. */
export function statusLabel(connector, state) {
  if (connector.status === 'connectable') {
    return isConnected(state, connector.id) ? 'Connected' : STATUS_LABELS.connectable;
  }
  return STATUS_LABELS[connector.status];
}

export function emptyConnections() {
  return { connected: {} };
}

/** Stored state, cleaned: only a connector that can be linked, and only `true`. Anything else is dropped. */
export function normalizeConnections(value) {
  const state = emptyConnections();
  if (value && typeof value === 'object' && value.connected && typeof value.connected === 'object') {
    for (const connector of CONNECTORS) {
      if (connector.status === 'connectable' && value.connected[connector.id] === true) {
        state.connected[connector.id] = true;
      }
    }
  }
  return state;
}

export function isConnected(state, id) {
  return state?.connected?.[id] === true;
}

/**
 * The state with one connector linked or unlinked (a new object). A connector that cannot be linked, or one that
 * does not exist, leaves the state as it was: a page cannot connect Naukri by asking.
 */
export function setConnected(state, id, on) {
  if (connectorById(id)?.status !== 'connectable') {
    return state;
  }
  const connected = { ...(state?.connected ?? {}) };
  if (on) {
    connected[id] = true;
  } else {
    delete connected[id];
  }
  return { connected };
}

export function connectedIds(state) {
  return CONNECTORS.filter((connector) => isConnected(state, connector.id)).map((connector) => connector.id);
}

export function connectionsKey(userId) {
  return `coverlay.preview.connections.${userId ?? 'guest'}`;
}
