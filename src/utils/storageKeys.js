/**
 * storageKeys.js
 *
 * Produces tab-scoped, hostname-scoped storage keys so that auth tokens are
 * isolated to each individual browser tab — even when a new tab is cloned
 * from an existing one via Ctrl+click or target="_blank".
 *
 * Key format:  "${hostname}:${tabId}:${key}"
 * Example:     "gifted-hands.madebyovo.me:a1b2c3de:authToken"
 *
 * How tab isolation works
 * ────────────────────────────────────────────────────────────────────────────
 * sessionStorage is tab-scoped by the browser, BUT cloned tabs (opened via
 * Ctrl+click / right-click → "Open in new tab") inherit the parent tab's
 * sessionStorage contents.  Without a tab ID, the clone would silently
 * inherit the parent's auth tokens and appear logged in as the same user.
 *
 * We fix this with a per-tab ID embedded in every storage key:
 *
 *   Fresh tab (empty sessionStorage)
 *     → generate new tabId, store it, start unauthenticated ✓
 *
 *   Page refresh / back-forward navigation  (navType = reload | back_forward)
 *     → existing tabId found AND reload detected → keep tabId + session ✓
 *
 *   Cloned tab  (navType = navigate, pre-existing tabId in sessionStorage)
 *     → old tabId was inherited from parent — generate NEW tabId
 *     → new tab reads keys prefixed with the NEW tabId → nothing found
 *     → starts unauthenticated ✓
 *
 * The orphaned keys from the old tabId remain in sessionStorage but are
 * never read; they are automatically purged when the tab closes.
 * ────────────────────────────────────────────────────────────────────────────
 */

const TAB_ID_KEY = '__vayrex_tab_id';
const STORAGE_NAMESPACE = window.location.hostname;

function generateTabId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getOrCreateTabId() {
  const existing = sessionStorage.getItem(TAB_ID_KEY);

  if (!existing) {
    // Truly new tab — sessionStorage was empty, nothing to inherit.
    const id = generateTabId();
    sessionStorage.setItem(TAB_ID_KEY, id);
    return id;
  }

  // sessionStorage already has a tab ID — decide whether to keep it.
  const navEntries = performance.getEntriesByType?.('navigation') ?? [];
  const navType = navEntries[0]?.type; // 'navigate' | 'reload' | 'back_forward'

  if (navType === 'reload' || navType === 'back_forward') {
    // Same tab refreshing or using browser history — preserve session.
    return existing;
  }

  // navType === 'navigate' (or unknown) with a pre-existing tabId:
  // this tab was cloned from another tab.  Assign a fresh tabId so the
  // inherited auth keys (keyed to the old tabId) are never found.
  const newId = generateTabId();
  sessionStorage.setItem(TAB_ID_KEY, newId);
  return newId;
}

const TAB_ID = getOrCreateTabId();

/**
 * sk("authToken") → "gifted-hands.madebyovo.me:a1b2c3de:authToken"
 *
 * Import and call this wherever you read/write auth-related storage keys.
 */
export const sk = (key) => `${STORAGE_NAMESPACE}:${TAB_ID}:${key}`;
