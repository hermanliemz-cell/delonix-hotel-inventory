/**
 * Version check utility
 * Dispatches app-update-available event when new version is detected
 * instead of auto-reloading the page
 */

// Injected by Vite from package.json — no need to update manually
export const APP_VERSION = __APP_VERSION__;

/**
 * Initialize version check
 * Checks for updates on interval and dispatches custom event if new version detected
 * Listen for it in your app like: window.addEventListener('app-update-available', handler)
 */
export function initVersionCheck() {
  async function checkForUpdate() {
    try {
      const resp = await fetch(window.location.origin + '/?_t=' + Date.now(), { cache: 'no-store' });
      if (!resp.ok) return;
      const text = await resp.text();
      const match = text.match(/APP_VERSION\s*=\s*'(v[\d.]+)'/);
      if (match && match[1] !== APP_VERSION) {
        // Dispatch custom event instead of reloading
        window.dispatchEvent(new CustomEvent('app-update-available', {
          detail: { version: match[1], currentVersion: APP_VERSION }
        }));
      }
    } catch (e) {
      // Silently ignore network errors
    }
  }

  // Check on load (after 10s delay to not block initial render)
  setTimeout(checkForUpdate, 10000);

  // Then check every 5 minutes
  setInterval(checkForUpdate, 5 * 60 * 1000);
}

/**
 * Check version before login.
 * Fetches /version.json (no-cache) and compares with bundled APP_VERSION.
 * Returns true if versions match (login may proceed).
 * If mismatch, forces a hard reload so the browser fetches the latest bundle.
 */
export async function checkVersionBeforeLogin() {
  try {
    const resp = await fetch('/version.json?_t=' + Date.now(), { cache: 'no-store' });
    if (!resp.ok) return true; // if file missing, allow login (first deploy)
    const data = await resp.json();
    if (data.version && data.version !== APP_VERSION) {
      // Force hard reload to get latest bundle
      window.location.reload(true);
      // Return false so caller doesn't proceed (page will reload)
      return false;
    }
    return true;
  } catch (e) {
    // Network error — allow login to proceed
    return true;
  }
}

/**
 * Get current version
 */
export function getAppVersion() {
  return APP_VERSION;
}
