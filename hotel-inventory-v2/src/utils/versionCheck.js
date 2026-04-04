/**
 * Version check utility
 * Dispatches app-update-available event when new version is detected
 * instead of auto-reloading the page
 */

export const APP_VERSION = 'v2.0.0';

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
 * Get current version
 */
export function getAppVersion() {
  return APP_VERSION;
}
