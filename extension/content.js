// content.js — runs on every barbora.ee page
// Captures clientVersion from the page and stores it for the background worker.

if (window.ENV?.appVersion) {
  chrome.storage.local.set({ clientVersion: window.ENV.appVersion });
}
