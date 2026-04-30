// popup.js

let items           = [];   // [{sku, title, price, image, quantity}]
let searchTimer     = null;
let isFilling       = false;
let swappingSku     = null; // which item has the swap UI open
let swapSearchTimer = null;
let highlightedIdx  = -1;  // keyboard nav index for main search results

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const { savedItems } = await chrome.storage.local.get('savedItems');
  items = savedItems || [];
  renderList();
  checkSession();

  document.getElementById('planner-link').addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('planner.html') });
  });

  document.getElementById('resolver-link').addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('resolver.html') });
  });

  document.getElementById('search-input').addEventListener('input', onSearchInput);
  document.getElementById('search-input').addEventListener('keydown', onSearchKeydown);
  document.getElementById('search-input').addEventListener('blur', () => {
    setTimeout(hideSearch, 150);
  });
  document.getElementById('clear-btn').addEventListener('click', clearAll);
  document.getElementById('fill-btn').addEventListener('click', fillBasket);

  chrome.runtime.onMessage.addListener(onBackgroundMessage);
});

// ── Session check ─────────────────────────────────────────────────────────────

async function checkSession() {
  const dot   = document.getElementById('session-dot');
  const label = document.getElementById('session-label');
  const { user } = await chrome.runtime.sendMessage({ type: 'CHECK_SESSION' });
  if (user) {
    dot.className     = 'dot ok';
    label.textContent = user.name || 'Logged in';
  } else {
    dot.className     = 'dot err';
    label.textContent = 'Not logged in';
    document.getElementById('fill-btn').disabled = true;
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
  const resp = await chrome.runtime.sendMessage({ type: 'SEARCH', query, limit: 7 });
  if (resp.error) {
    showSearchResults(`<div class="search-msg" style="color:#d93025">${resp.error}</div>`);
    return;
  }
  if (!resp.results.length) {
    showSearchResults('<div class="search-msg">No products found.</div>');
    return;
  }
  const html = resp.results.map(p => `
    <div class="result-item" data-sku="${p.sku}" data-title="${esc(p.title)}"
         data-price="${p.price}" data-image="${esc(p.image || '')}">
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
  // Auto-highlight first result
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
}

function clearAll() {
  if (isFilling) return;
  items      = [];
  swappingSku = null;
  saveItems();
  renderList();
  resetProgress();
}

function saveItems() {
  chrome.storage.local.set({ savedItems: items });
}

function renderList() {
  const listEl  = document.getElementById('list-items');
  const emptyEl = document.getElementById('list-empty');
  const fillBtn = document.getElementById('fill-btn');

  if (!items.length) {
    listEl.innerHTML       = '';
    emptyEl.style.display  = 'block';
    fillBtn.disabled       = true;
    return;
  }

  emptyEl.style.display = 'none';
  fillBtn.disabled      = isFilling;

  listEl.innerHTML = items.map(item => `
    <div class="item-wrap">
      <div class="list-item" id="item-${item.sku}">
        <img class="item-img" src="${esc(item.image || '')}" alt="" onerror="this.style.display='none'">
        <div style="flex:1;min-width:0">
          <div class="item-title">${esc(item.title)}</div>
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
               placeholder="Search for a replacement…" autocomplete="off"
               value="">
        <div class="swap-results" id="swap-results-${item.sku}"></div>
        <label class="swap-perm">
          <input type="checkbox" id="swap-perm-${item.sku}"> Permanently replace
        </label>
      </div>
    </div>
  `).join('');

  // Qty buttons
  listEl.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => changeQty(btn.dataset.sku, parseInt(btn.dataset.delta)));
  });

  // Remove buttons
  listEl.querySelectorAll('.item-remove').forEach(btn => {
    btn.addEventListener('click', () => removeItem(btn.dataset.sku));
  });

  // Swap toggle buttons
  listEl.querySelectorAll('.item-swap').forEach(btn => {
    btn.addEventListener('click', () => {
      if (swappingSku === btn.dataset.sku) {
        closeSwap();
      } else {
        openSwap(btn.dataset.sku);
      }
    });
  });

  // Swap search inputs
  listEl.querySelectorAll('.swap-input').forEach(input => {
    const sku = input.id.replace('swap-input-', '');
    input.addEventListener('input', () => {
      clearTimeout(swapSearchTimer);
      const q = input.value.trim();
      if (q.length < 2) {
        document.getElementById(`swap-results-${sku}`).innerHTML = '';
        return;
      }
      swapSearchTimer = setTimeout(() => doSwapSearch(sku, q), 280);
    });
    // If this is the active swap row, focus it
    if (swappingSku === sku) {
      setTimeout(() => input.focus(), 50);
    }
  });
}

// ── Swap / replace ────────────────────────────────────────────────────────────

function openSwap(sku) {
  swappingSku = sku;
  renderList();
}

function closeSwap() {
  swappingSku = null;
  renderList();
}

async function doSwapSearch(sku, query) {
  const resultsEl = document.getElementById(`swap-results-${sku}`);
  if (!resultsEl) return;
  resultsEl.innerHTML = '<div class="swap-msg">Searching…</div>';

  const resp = await chrome.runtime.sendMessage({ type: 'SEARCH', query, limit: 6 });
  if (!resultsEl) return; // UI may have been torn down

  if (resp.error) {
    resultsEl.innerHTML = `<div class="swap-msg err">${esc(resp.error)}</div>`;
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
      const newProduct = {
        sku:   el.dataset.sku,
        title: el.dataset.title,
        price: parseFloat(el.dataset.price) || 0,
        image: el.dataset.image,
      };
      const permanent = document.getElementById(`swap-perm-${sku}`)?.checked || false;
      confirmSwap(sku, newProduct, permanent);
    });
  });
}

async function confirmSwap(oldSku, newProduct, permanent) {
  const item = items.find(i => i.sku === oldSku);
  if (!item) return;

  // Replace in list (keep same quantity)
  const qty   = item.quantity;
  const idx   = items.indexOf(item);
  items[idx]  = { ...newProduct, quantity: qty };

  swappingSku = null;
  saveItems();

  // Permanent replace: update ingredientMap in storage
  if (permanent) {
    const { ingredientMap } = await chrome.storage.local.get('ingredientMap');
    if (ingredientMap) {
      // Find which ingredient key points to the old SKU
      const key = Object.keys(ingredientMap).find(
        k => String(ingredientMap[k].sku) === String(oldSku)
      );
      if (key) {
        ingredientMap[key] = {
          ...ingredientMap[key],
          sku:   newProduct.sku,
          title: newProduct.title,
          price: newProduct.price,
          image: newProduct.image,
        };
        await chrome.storage.local.set({ ingredientMap });
      }
    }
  }

  renderList();
}

// ── Fill basket ───────────────────────────────────────────────────────────────

async function fillBasket() {
  if (isFilling || !items.length) return;
  isFilling = true;
  swappingSku = null; // close any open swap UI
  document.getElementById('fill-btn').disabled  = true;
  document.getElementById('fill-btn').textContent = 'Filling…';
  showProgress(0, items.length);

  chrome.runtime.sendMessage({ type: 'FILL_BASKET', items }, (resp) => {
    isFilling = false;
    const btn = document.getElementById('fill-btn');
    btn.textContent = 'Fill basket →';
    btn.disabled    = false;
    if (resp?.error) {
      setProgressText('Error: ' + resp.error);
    }
  });
}

function onBackgroundMessage(msg) {
  if (msg.type !== 'FILL_PROGRESS') return;
  showProgress(msg.current, msg.total);

  // Dim / colour items as they complete
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
    setProgressText(text);
  }
}

function showProgress(current, total) {
  const wrap = document.getElementById('progress-wrap');
  wrap.classList.add('visible');
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
