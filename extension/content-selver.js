// content-selver.js — ISOLATED world — runs on www.selver.ee pages
// Responsibilities:
//   1. Sync the page's cart token → chrome.storage.local
//   2. When a pending cart token exists, write it to localStorage and signal
//      the MAIN world script (content-selver-main.js) to replay the server cart.
//
// Why two scripts?
//   Isolated world: has chrome.* API access but can't touch page-level JS (Vue store).
//   Main world:     can touch page-level JS but has no chrome.* API access.
//   We bridge them with window.postMessage.

(function () {

  // ── 1. Capture existing page token → extension storage ─────────────────────

  try {
    const raw = localStorage.getItem('shop/cart/current-cart-token');
    if (raw) {
      const token = JSON.parse(raw);
      if (token) chrome.storage.local.set({ selverCartToken: token });
    }
  } catch (_) {}

  // ── 2. Check for pending cart token and trigger replay ──────────────────────

  chrome.storage.local.get(['selverPendingCartToken'], ({ selverPendingCartToken }) => {
    if (!selverPendingCartToken) return;

    // Inject the token into localStorage so the Vue app uses the right cart
    try {
      localStorage.setItem('shop/cart/current-cart-token', JSON.stringify(selverPendingCartToken));
      chrome.storage.local.set({ selverCartToken: selverPendingCartToken });
      chrome.storage.local.remove('selverPendingCartToken');
    } catch (_) {}

    // Signal the MAIN world script to run the Vue store replay.
    // The listener in content-selver-main.js is already set up (synchronously,
    // at the same document_idle phase, registered before this async callback runs).
    const path = window.location.pathname;
    const isCartPage = /\b(cart|ostukorv)\b/i.test(path);
    if (isCartPage) {
      window.postMessage({ type: '__SELVER_CART_REPLAY__', token: selverPendingCartToken }, '*');
    }
  });

})();
