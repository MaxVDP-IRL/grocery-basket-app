// content-selver-main.js — MAIN world — runs on www.selver.ee pages
// Runs in the page's own JavaScript context (same as page scripts), so it can
// access window.__vue__.$store directly without triggering CSP restrictions.
//
// Receives a postMessage from content-selver.js (isolated world) and replays
// server cart items into the Vue store so the cart page shows the right items.

window.addEventListener('message', async function selverCartReplayHandler(event) {
  if (event.source !== window) return;
  if (event.data?.type !== '__SELVER_CART_REPLAY__') return;

  const token = event.data.token;
  if (!token) return;

  // ── Wait for Vue store to be ready (up to ~9 seconds) ─────────────────────
  let store = null;
  for (let i = 0; i < 30; i++) {
    const app = document.getElementById('app');
    if (app?.__vue__?.$store) {
      store = app.__vue__.$store;
      break;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  if (!store) {
    console.warn('[Basket] Selver cart replay: Vue store not found after 9s');
    return;
  }

  // ── Pull server cart and replay items into Vuex ───────────────────────────
  try {
    const res  = await fetch('/api/cart/pull?cartId=' + token + '&storeCode=et');
    const data = await res.json();
    if (data.code !== 200 || !Array.isArray(data.result)) return;

    const added     = [];
    const skipped   = [];

    for (const serverItem of data.result) {
      // Skip items the SPA already has to avoid doubling quantities
      const existing = store.state.cart.cartItems.find(i => i.sku === serverItem.sku);
      if (existing) {
        skipped.push(serverItem.sku);
        continue;
      }

      // getProductVariant fetches the full product record and attaches server IDs
      const variant = await store.dispatch('cart/getProductVariant', { serverItem });
      if (variant) {
        // forceServerSilence: true — item is already on the server, don't re-POST
        await store.dispatch('cart/addItem', {
          productToAdd:       variant,
          forceServerSilence: true,
        });
        added.push(serverItem.sku);
      }
    }

    // Reconcile totals
    await store.dispatch('cart/syncTotals', { forceServerSync: true });

    console.log(
      '[Basket] Selver cart replay complete —',
      added.length, 'added,', skipped.length, 'already present'
    );
  } catch (e) {
    console.warn('[Basket] Selver cart replay error:', e);
  }
});
