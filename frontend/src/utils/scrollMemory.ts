// Per-history-entry scroll positions for the document page.
//
// Back to a doc after following a link to another file reloads that doc
// asynchronously, so the browser's own scroll restoration fires before
// the content exists and the reader lands at the top. DocumentPage
// records window.scrollY under the router's location.key while reading
// and restores it once the doc re-renders on a Back/Forward (POP).
// sessionStorage: per tab, survives reloads, gone with the tab.

const STORAGE_KEY = "mm.scrollByEntry";
const MAX_ENTRIES = 100;

type Store = Record<string, number>;

function read(): Store {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

export function saveScroll(entryKey: string, y: number): void {
  try {
    const store = read();
    delete store[entryKey]; // re-insert last so it's the newest
    store[entryKey] = Math.round(y);
    const keys = Object.keys(store);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete store[k];
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage blocked or full — restoring is a nicety */
  }
}

export function loadScroll(entryKey: string): number | null {
  const y = read()[entryKey];
  return typeof y === "number" ? y : null;
}
