// Single source of truth for the app distribution URL.
// When moving from TestFlight to the App Store, change this one line.
export const APP_STORE_URL = "https://testflight.apple.com/join/ZayvEbAy";

// Rewrites every <a href="https://testflight.apple.com/..."> on the current
// page to the value above. Called once per page on DOMContentLoaded so that
// HTML can keep a reasonable fallback href and JS centralises the real value.
export function patchAppStoreLinks() {
  document.querySelectorAll('a[href*="testflight.apple.com"]').forEach((link) => {
    link.href = APP_STORE_URL;
  });
}
