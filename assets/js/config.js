/**
 * config.js — App configuration and link patching.
 * Provides exports expected by join page and other pages.
 */

export const APP_STORE_URL = "https://testflight.apple.com/join/ZayvEbAy";

export function patchAppStoreLinks() {
  // Patch any generic app store links to point to TestFlight
  document.querySelectorAll('a[href*="testflight.apple.com"]').forEach((a) => {
    a.href = APP_STORE_URL;
  });
}
