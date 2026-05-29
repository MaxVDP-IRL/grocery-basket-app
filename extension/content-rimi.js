// content-rimi.js — runs on www.rimi.ee/epood/* pages
// Captures CSRF token so background.js can make cart requests.

(function () {
  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  if (csrfMeta?.content) {
    chrome.storage.local.set({ rimiCsrfToken: csrfMeta.content });
  }
})();
