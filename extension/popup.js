// popup.js — multi-store: Barbora + Rimi + Selver

let items           = [];   // [{sku, title, price, image, quantity, store}]
let searchTimer     = null;
let isFilling       = false;
let swappingSku     = null;
let swapSearchTimer = null;
let highlightedIdx  = -1;
let selectedStore   = 'barbora'; // 'barbora' | 'rimi'

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Load persisted state
  const { savedItems, selectedStore: storedStore } = await chrome.storage.local.get(['savedItems', 'selectedStore']);
  items         = savedItems  || [];
  selectedStore = storedStore || 'barbora';

  renderStoreTabs();
  renderList();
  checkSession();

  // Store tabs
  document.querySelectorAll('.store-tab').forEach(btn => {
    btn.addEventListener('click', () => setStore(btn.dataset.store));
  });

  // Navigation links
  document.getElementById('planner-link').addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('planner.html') });
  });
  document.getElementById('resolver-link').addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('resolver.html') });
  });

  // Search
  document.getElementById('search-input').addEventListener('input', onSearchInput);
  document.getElementById('search-input').addEventListener('keydown', onSearchKeydown);
  document.getElementById('search-input').addEventListener('blur', () => {
    setTimeout(hideSearch, 150);
  });

  // List controls
  document.getElementById('clear-btn').addEventListener('click', clearAll);
  document.getElementById('fill-btn').addEventListener('click', fillBasket);

  // Compare
  document.getElementById('compare-btn').addEventListener('click', compareStores);
  document.getElementById('compare-close').addEventListener('click', closeComparison);

  chrome.runtime.onMessage.addListener(onBackgroundMessage);
});

// ── Store switching ───────────────────────────────────────────────────────────

async function setStore(store) {
  selectedStore = store;
  await chrome.runtime.sendMessage({ type: 'SET_STORE', store });
  renderStoreTabs();
  checkSession();
  closeComparison();
}

function renderStoreTabs() {
  document.querySelectorAll('.store-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.store === selectedStore);
  });
  const fillBtn = document.getElementById('fill-btn');
  const fillLabels = { rimi: 'Fill Rimi basket →', selver: 'Fill Selver basket →' };
  fillBtn.textContent = fillLabels[selectedStore] || 'Fill Barbora basket →';
}

// ── Session check ─────────────────────────────────────────────────────────────

async function checkSession() {
  const dot   = document.getElementById('session-dot');
  const label = document.getElementById('session-label');
  dot.className     = 'dot';
  label.textContent = 'Checking…';

  let resp2;
  try { resp2 = await chrome.runtime.sendMessage({ type: 'CHECK_SESSION' }); } catch (_) {}
  const { user } = resp2 || {};
  const fillBtn   = document.getElementById('fill-btn');
  const compareBtn = document.getElementById('compare-btn');

  if (user) {
    dot.className     = 'dot ok';
    label.textContent = user.name || 'Logged in';
    fillBtn.disabled    = !items.length || isFilling;
    compareBtn.disabled = !items.length;
  } else {
    dot.className     = 'dot err';
    const storeNames  = { rimi: 'rimi.ee/epood', selver: 'selver.ee', barbora: 'barbora.ee' };
    const storeName   = storeNames[selectedStore] || 'barbora.ee';
    label.textContent = `Not logged in to ${storeName}`;
    fillBtn.disabled    = true;
    compareBtn.disabled = true;
  }
}

// ── Main search ───────────────────────────────────────────────────────────────

function onSearchInput(e) {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { hideSearch(); return; }
  searchTimer = setTimeout(() => doSearch(q), 280);
}

function onSearchKeydown(e) {
  const results = document.querySelectorAll('#search-results .result-item');
  if (!results.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlightedIdx = Math.min(highlightedIdx + 1, results.length - 1);
    applyHighlight(results);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlightedIdx = Math.max(highlightedIdx - 1, 0);
    applyHighlight(results);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const target = results[highlightedIdx] || results[0];
    if (target) target.click();
  } else if (e.key === 'Escape') {
    hideSearch();
  }
}

function applyHighlight(results) {
  results.forEach((el, i) => el.classList.toggle('highlighted', i === highlightedIdx));
  results[highlightedIdx]?.scrollIntoView({ block: 'nearest' });
}

async function doSearch(query) {
  showSearchResults('<div class="search-msg">Searching…</div>');
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: 'SEARCH', query, limit: 7 });
  } catch (e) {
    showSearchResults(`<div class="search-msg" style="color:#d93025">${esc(e.message)}</div>`);
    return;
  }
  if (!resp || resp.error) {
    showSearchResults(`<div class="search-msg" style="color:#d93025">${esc(resp?.error || 'No response.')}</div>`);
    return;
  }
  if (!resp.results.length) {
    showSearchResults('<div class="search-msg">No products found.</div>');
    return;
  }
  const html = resp.results.map(p => `
    <div class="result-item" data-sku="${p.sku}" data-title="${esc(p.title)}"
         data-price="${p.price}" data-image="${esc(p.image || '')}" data-store="${esc(p.store || selectedStore)}">
      <img class="result-img" src="${esc(p.image || '')}" alt="" onerror="this.style.display='none'">
      <div class="result-info">
        <div class="result-title">${esc(p.title)}</div>
        <div class="result-price">€${(p.price || 0).toFixed(2)}</div>
      </div>
      <div class="result-add">＋</div>
    </div>
  `).join('');
  showSearchResults(html);

  document.querySelectorAll('.result-item').forEach((el, i) => {
    el.addEventListener('mouseenter', () => {
      highlightedIdx = i;
      applyHighlight(document.querySelectorAll('#search-results .result-item'));
    });
    el.addEventListener('click', () => {
      addItemToList({
        sku:      el.dataset.sku,
        title:    el.dataset.title,
        price:    parseFloat(el.dataset.price) || 0,
        image:    el.dataset.image,
        store:    el.dataset.store || selectedStore,
        quantity: 1,
      });
      document.getElementById('search-input').value = '';
      hideSearch();
    });
  });
}

function showSearchResults(html) {
  const el = document.getElementById('search-results');
  el.innerHTML = html;
  el.classList.add('visible');
  highlightedIdx = 0;
  applyHighlight(el.querySelectorAll('.result-item'));
}
function hideSearch() {
  const el = document.getElementById('search-results');
  el.classList.remove('visible');
  highlightedIdx = -1;
}

// ── List management ───────────────────────────────────────────────────────────

function addItemToList(product) {
  const existing = items.find(i => i.sku === product.sku);
  if (existing) {
    existing.quantity++;
  } else {
    items.push({ ...product, quantity: 1 });
  }
  saveItems();
  renderList();
  updateCompareBtn();
}

function changeQty(sku, delta) {
  const item = items.find(i => i.sku === sku);
  if (!item) return;
  item.quantity = Math.max(1, item.quantity + delta);
  saveItems();
  renderList();
}

function removeItem(sku) {
  items = items.filter(i => i.sku !== sku);
  if (swappingSku === sku) swappingSku = null;
  saveItems();
  renderList();
  updateCompareBtn();
}

function clearAll() {
  if (isFilling) return;
  items       = [];
  swappingSku = null;
  saveItems();
  renderList();
  resetProgress();
  closeComparison();
  updateCompareBtn();
}

function saveItems() {
  chrome.storage.local.set({ savedItems: items });
}

function updateCompareBtn() {
  document.getElementById('compare-btn').disabled = !items.length;
}

function renderList() {
  const listEl  = document.getElementById('list-items');
  const emptyEl = document.getElementById('list-empty');
  const fillBtn = document.getElementById('fill-btn');

  if (!items.length) {
    listEl.innerHTML      = '';
    emptyEl.style.display = 'block';
    fillBtn.disabled      = true;
    return;
  }

  emptyEl.style.display = 'none';
  fillBtn.disabled      = isFilling;

  // Warn if any items were added for a different store
  const mismatchedCount = items.filter(i => i.store && i.store !== selectedStore).length;
  const storeWarn = mismatchedCount > 0
    ? `<div style="padding:6px 12px;font-size:11px;color:#b45309;background:#fffbeb;border-bottom:1px solid #fde68a">
         ⚠ ${mismatchedCount} item${mismatchedCount !== 1 ? 's' : ''} in your list ${mismatchedCount !== 1 ? 'were' : 'was'} added for ${selectedStore === 'rimi' ? 'Barbora' : 'Rimi'} and won't fill correctly. Use ⇄ to swap them for ${selectedStore === 'rimi' ? 'Rimi' : 'Barbora'} products.
       </div>`
    : '';

  listEl.innerHTML = storeWarn + items.map(item => {
    const wrongStore = item.store && item.store !== selectedStore;
    return `
    <div class="item-wrap">
      <div class="list-item${wrongStore ? ' fail' : ''}" id="item-${item.sku}" title="${wrongStore ? `Added for ${item.store} — swap for a ${selectedStore} product` : ''}">
        <img class="item-img" src="${esc(item.image || '')}" alt="" onerror="this.style.display='none'">
        <div style="flex:1;min-width:0">
          <div class="item-title">${esc(item.title)}${wrongStore ? ` <span style="font-size:10px;color:#b45309">(${item.store})</span>` : ''}</div>
          <div class="item-price">€${(item.price || 0).toFixed(2)} each</div>
        </div>
        <div class="qty-control">
          <button class="qty-btn" data-sku="${item.sku}" data-delta="-1">−</button>
          <span class="qty-num">${item.quantity}</span>
          <button class="qty-btn" data-sku="${item.sku}" data-delta="1">+</button>
        </div>
        <button class="item-swap ${swappingSku === item.sku ? 'active' : ''}"
                data-sku="${item.sku}" title="Replace this item">⇄</button>
        <button class="item-remove" data-sku="${item.sku}" title="Remove">×</button>
      </div>
      <div class="swap-row${swappingSku === item.sku ? ' visible' : ''}" id="swap-${item.sku}">
        <input class="swap-input" id="swap-input-${item.sku}"
               placeholder="Search for a replacement…" autocomplete="off" value="">
        <div class="swap-results" id="swap-results-${item.sku}"></div>
        <label class="swap-perm">
          <input type="checkbox" id="swap-perm-${item.sku}"> Permanently replace
        </label>
      </div>
    </div>
  `; }).join('');

  listEl.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => changeQty(btn.dataset.sku, parseInt(btn.dataset.delta)));
  });
  listEl.querySelectorAll('.item-remove').forEach(btn => {
    btn.addEventListener('click', () => removeItem(btn.dataset.sku));
  });
  listEl.querySelectorAll('.item-swap').forEach(btn => {
    btn.addEventListener('click', () => {
      if (swappingSku === btn.dataset.sku) closeSwap();
      else openSwap(btn.dataset.sku);
    });
  });
  listEl.querySelectorAll('.swap-input').forEach(input => {
    const sku = input.id.replace('swap-input-', '');
    input.addEventListener('input', () => {
      clearTimeout(swapSearchTimer);
      const q = input.value.trim();
      if (q.length < 2) { document.getElementById(`swap-results-${sku}`).innerHTML = ''; return; }
      swapSearchTimer = setTimeout(() => doSwapSearch(sku, q), 280);
    });
    if (swappingSku === sku) setTimeout(() => input.focus(), 50);
  });
}

// ── Swap / replace ────────────────────────────────────────────────────────────

function openSwap(sku)  { swappingSku = sku;  renderList(); }
function closeSwap()    { swappingSku = null; renderList(); }

async function doSwapSearch(sku, query) {
  const resultsEl = document.getElementById(`swap-results-${sku}`);
  if (!resultsEl) return;
  resultsEl.innerHTML = '<div class="swap-msg">Searching…</div>';

  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: 'SEARCH', query, limit: 6 });
  } catch (e) {
    if (resultsEl) resultsEl.innerHTML = `<div class="swap-msg err">${esc(e.message)}</div>`;
    return;
  }
  if (!resultsEl) return;

  if (!resp || resp.error) {
    resultsEl.innerHTML = `<div class="swap-msg err">${esc(resp?.error || 'No response.')}</div>`;
    return;
  }
  if (!resp.results.length) {
    resultsEl.innerHTML = '<div class="swap-msg">No results found.</div>';
    return;
  }

  resultsEl.innerHTML = resp.results.map(p => `
    <div class="swap-result-item"
         data-sku="${p.sku}" data-title="${esc(p.title)}"
         data-price="${p.price}" data-image="${esc(p.image || '')}">
      <img class="result-img" src="${esc(p.image || '')}" alt="" onerror="this.style.display='none'">
      <div class="result-info">
        <div class="result-title">${esc(p.title)}</div>
        <div class="result-price">€${(p.price || 0).toFixed(2)}</div>
      </div>
    </div>
  `).join('');

  resultsEl.querySelectorAll('.swap-result-item').forEach(el => {
    el.addEventListener('click', () => {
      const permanent = document.getElementById(`swap-perm-${sku}`)?.checked || false;
      confirmSwap(sku, {
        sku:   el.dataset.sku,
        title: el.dataset.title,
        price: parseFloat(el.dataset.price) || 0,
        image: el.dataset.image,
      }, permanent);
    });
  });
}

async function confirmSwap(oldSku, newProduct, permanent) {
  const item = items.find(i => i.sku === oldSku);
  if (!item) return;
  const qty  = item.quantity;
  const idx  = items.indexOf(item);
  items[idx] = { ...newProduct, quantity: qty, store: selectedStore };
  swappingSku = null;
  saveItems();

  if (permanent) {
    // Update the correct store's ingredient map
    const storageKey = selectedStore === 'rimi'   ? 'rimiIngredientMap'
                     : selectedStore === 'selver' ? 'selverIngredientMap'
                     : 'ingredientMap';
    try {
      const stored = await chrome.storage.local.get(storageKey);
      const map    = stored[storageKey];
      if (map && typeof map === 'object') {
        const key = Object.keys(map).find(
          k => map[k] && String(map[k].sku) === String(oldSku)
        );
        if (key) {
          map[key] = { ...map[key], ...newProduct };
          await chrome.storage.local.set({ [storageKey]: map });
        }
      }
    } catch (e) {
      console.warn('Could not update ingredient map:', e.message);
    }
  }
  renderList();
}

// ── Price comparison ──────────────────────────────────────────────────────────

async function compareStores() {
  if (!items.length) return;

  const panel   = document.getElementById('compare-panel');
  const content = document.getElementById('compare-content');
  panel.classList.add('visible');
  content.innerHTML = '<div class="compare-msg">Comparing prices across both stores…</div>';

  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: 'COMPARE_PRICES', items });
  } catch (e) {
    content.innerHTML = `<div class="compare-msg" style="color:#d93025">Error: ${esc(e.message)}</div>`;
    return;
  }

  if (!resp || resp.error) {
    content.innerHTML = `<div class="compare-msg" style="color:#d93025">${esc(resp?.error || 'No response from background — try reloading the extension.')}</div>`;
    return;
  }

  renderComparison(resp.results);
}

function closeComparison() {
  document.getElementById('compare-panel').classList.remove('visible');
}

function renderComparison(results) {
  const content = document.getElementById('compare-content');

  let barboraTotal = 0;
  let rimiTotal    = 0;
  let selverTotal  = 0;
  let hasRimiError = false;

  const rows = results.map(r => {
    const item   = r.originalItem;
    const bPrice = r.barbora?.price != null ? r.barbora.price * item.quantity : null;
    const rPrice = r.rimi?.price    != null ? r.rimi.price    * item.quantity : null;
    const sPrice = r.selver?.price  != null ? r.selver.price  * item.quantity : null;

    if (bPrice != null) barboraTotal += bPrice;
    if (rPrice != null) rimiTotal    += rPrice;
    if (sPrice != null) selverTotal  += sPrice;
    if (r.rimiError)    hasRimiError  = true;

    // Mark the cheapest available price in the row
    const available = [bPrice, rPrice, sPrice].filter(p => p != null);
    const rowMin    = available.length ? Math.min(...available) : null;

    const cls = (p) => {
      if (p == null || rowMin == null || available.length < 2) return 'compare-price';
      return p <= rowMin + 0.001 ? 'compare-price cheaper' : 'compare-price pricier';
    };

    const bTitle = r.barbora?.title || '';
    const rTitle = r.rimi?.title    || '';
    const sTitle = r.selver?.title  || '';

    const bCell = bPrice != null
      ? `<span class="${cls(bPrice)}" style="cursor:default" title="${esc(bTitle)}">€${bPrice.toFixed(2)}</span>`
      : `<span class="compare-price na">n/a</span>`;
    const rCell = rPrice != null
      ? `<span class="${cls(rPrice)}" style="cursor:default" title="${esc(rTitle)}">€${rPrice.toFixed(2)}</span>`
      : `<span class="compare-price na">${r.rimiError ? '⚠ no slot' : 'n/a'}</span>`;
    const sCell = sPrice != null
      ? `<span class="${cls(sPrice)}" style="cursor:default" title="${esc(sTitle)}">€${sPrice.toFixed(2)}</span>`
      : `<span class="compare-price na">${r.selverError ? '⚠ error' : 'n/a'}</span>`;

    // Flag rows where stores matched products of visibly different units
    const titles       = [bTitle, rTitle, sTitle].filter(Boolean);
    const kgCount      = titles.filter(t => /\bkg\b/i.test(t)).length;
    const gCount       = titles.filter(t => /\b\d+g\b/i.test(t)).length;
    const unitMismatch = titles.length > 1 && (kgCount > 0 && kgCount < titles.length ||
                                                gCount  > 0 && gCount  < titles.length);
    const mismatchFlag = unitMismatch
      ? `<span title="Stores matched different package sizes — hover prices to see what was matched"
               style="font-size:10px;color:#e08000;margin-left:2px">⚠</span>`
      : '';

    return `
      <div class="compare-row">
        <span class="compare-item-name" title="${esc(item.title)}">${esc(item.title)}${mismatchFlag}</span>
        ${bCell}
        ${rCell}
        ${sCell}
      </div>`;
  }).join('');

  // Savings note: find cheapest and most expensive among totals that have data
  const totals = [
    { name: 'Barbora', value: barboraTotal },
    { name: 'Rimi',    value: rimiTotal    },
    { name: 'Selver',  value: selverTotal  },
  ].filter(t => t.value > 0);

  totals.sort((a, b) => a.value - b.value);
  const cheapest    = totals[0];
  const mostExpensive = totals[totals.length - 1];
  const savings     = totals.length >= 2 ? mostExpensive.value - cheapest.value : 0;

  const savingsNote = totals.length >= 2 && savings > 0.005
    ? `<div style="padding:6px 16px;font-size:11px;color:var(--green-dark);font-weight:600">
         ${cheapest.name} saves you €${savings.toFixed(2)} vs ${mostExpensive.name} on this basket
       </div>`
    : '';

  const totalWinner = cheapest?.name?.toLowerCase() || '';

  const rimiWarning = hasRimiError
    ? `<div style="padding:4px 16px 6px;font-size:11px;color:#888">
         ⚠ Rimi requires an active delivery reservation for prices to show.
       </div>`
    : '';

  content.innerHTML = `
    <div class="compare-rows">
      <div class="compare-row" style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.4px;padding-bottom:4px">
        <span>Item</span>
        <span style="text-align:right">Barbora</span>
        <span style="text-align:right">Rimi</span>
        <span style="text-align:right">Selver</span>
      </div>
      ${rows}
    </div>
    <div class="compare-totals">
      <span class="label">Total</span>
      <span class="total ${totalWinner === 'barbora' ? 'winner' : ''}">
        ${barboraTotal > 0 ? '€' + barboraTotal.toFixed(2) : '—'}
      </span>
      <span class="total ${totalWinner === 'rimi' ? 'winner' : ''}">
        ${rimiTotal > 0 ? '€' + rimiTotal.toFixed(2) : '—'}
      </span>
      <span class="total ${totalWinner === 'selver' ? 'winner' : ''}">
        ${selverTotal > 0 ? '€' + selverTotal.toFixed(2) : '—'}
      </span>
    </div>
    ${savingsNote}
    ${rimiWarning}
    <div class="compare-actions">
      <button class="compare-fill-btn barbora" id="fill-barbora-btn">Fill Barbora →</button>
      <button class="compare-fill-btn rimi"    id="fill-rimi-btn">Fill Rimi →</button>
      <button class="compare-fill-btn selver"  id="fill-selver-btn">Fill Selver →</button>
    </div>`;

  document.getElementById('fill-barbora-btn').addEventListener('click', async () => {
    await setStore('barbora');
    closeComparison();
    fillBasket();
  });
  document.getElementById('fill-rimi-btn').addEventListener('click', async () => {
    await setStore('rimi');
    closeComparison();
    fillBasket();
  });
  document.getElementById('fill-selver-btn').addEventListener('click', async () => {
    await setStore('selver');
    closeComparison();
    fillBasket();
  });
}

// ── Fill basket ───────────────────────────────────────────────────────────────

async function fillBasket() {
  if (isFilling || !items.length) return;
  isFilling = true;
  swappingSku = null;
  const fillBtn = document.getElementById('fill-btn');
  fillBtn.disabled    = true;
  fillBtn.textContent = 'Filling…';
  showProgress(0, items.length);

  chrome.runtime.sendMessage({ type: 'FILL_BASKET', items }, (resp) => {
    isFilling = false;
    const fillLabels = { rimi: 'Fill Rimi basket →', selver: 'Fill Selver basket →' };
    fillBtn.textContent = fillLabels[selectedStore] || 'Fill Barbora basket →';
    fillBtn.disabled    = false;
    if (resp?.error) setProgressText('Error: ' + resp.error);
  });
}

function onBackgroundMessage(msg) {
  if (msg.type !== 'FILL_PROGRESS') return;
  showProgress(msg.current, msg.total);

  msg.results.forEach(r => {
    const el = document.getElementById('item-' + r.sku);
    if (!el) return;
    el.classList.toggle('ok',      r.ok && !r.skipped);
    el.classList.toggle('skipped', r.ok && !!r.skipped);
    el.classList.toggle('fail',    !r.ok);
  });

  if (msg.current === msg.total) {
    const added   = msg.results.filter(r => r.ok && !r.skipped).length;
    const skipped = msg.results.filter(r => r.skipped).length;
    const failed  = msg.results.filter(r => !r.ok).length;
    let text = `✓ ${added} item${added !== 1 ? 's' : ''} added`;
    if (skipped) text += `, ${skipped} already in basket`;
    if (failed)  text += `, ${failed} failed — check basket`;
    if (selectedStore === 'selver') text += ' — opening selver.ee/cart…';
    setProgressText(text);
  }
}

function showProgress(current, total) {
  document.getElementById('progress-wrap').classList.add('visible');
  document.getElementById('progress-fill').style.width =
    total ? `${Math.round((current / total) * 100)}%` : '0%';
  if (current < total) setProgressText(`Adding item ${current + 1} of ${total}…`);
}

function setProgressText(text) {
  document.getElementById('progress-text').textContent = text;
}

function resetProgress() {
  document.getElementById('progress-wrap').classList.remove('visible');
  document.getElementById('progress-fill').style.width = '0%';
  setProgressText('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
