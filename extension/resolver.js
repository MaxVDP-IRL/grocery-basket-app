// resolver.js — Ingredient → Supabase SKU mapping tool (Barbora + Rimi + Selver)
// Supports multiple alternative SKUs per ingredient per store.

const SUPABASE_URL = 'https://vjeqsgsulhxvkshjoicg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZXFzZ3N1bGh4dmtzaGpvaWNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5Nzk5NTEsImV4cCI6MjA5NTU1NTk1MX0.9SDRENFqfDLjT4YhCFmyVPzJZUQmLe9K29m638nIMmY';

// ── State ─────────────────────────────────────────────────────────────────────

let ingredients   = [];  // [{id, name_en, name_et, unit, category}] from Supabase
// skuMap[ingredientId][store] = [{rowId, sku, title, price, image}, …]  (array — multiple alternatives)
let skuMap        = {};
let activeStore   = 'barbora';
let current       = 0;
let searchResults = [];
let saveStatus    = null; // null | 'saving' | 'saved' | 'error'

// ── Supabase helpers ──────────────────────────────────────────────────────────

const SB_HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
};

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers: SB_HEADERS });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sbPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method:  'POST',
    headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase POST ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows[0];
}

async function sbDelete(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method:  'DELETE',
    headers: SB_HEADERS,
  });
  if (!res.ok) throw new Error(`Supabase DELETE ${res.status}: ${await res.text()}`);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  showLoading('Loading ingredients from Supabase…');

  try {
    ingredients = await sbGet(
      '/ingredients?select=id,name_en,name_et,unit,category&order=name_en.asc'
    );

    const skuRows = await sbGet(
      '/ingredient_skus?select=id,ingredient_id,supermarket,sku,display_name,last_price_eur,image_url'
    );

    // Build skuMap: ingredientId → {store → [{rowId, sku, title, price, image}]}
    skuMap = {};
    for (const row of skuRows) {
      if (!skuMap[row.ingredient_id])              skuMap[row.ingredient_id] = {};
      if (!skuMap[row.ingredient_id][row.supermarket]) skuMap[row.ingredient_id][row.supermarket] = [];
      skuMap[row.ingredient_id][row.supermarket].push({
        rowId: row.id,
        sku:   row.sku,
        title: row.display_name || row.sku,
        price: row.last_price_eur,
        image: row.image_url || '',
      });
    }
  } catch (e) {
    showError(`Failed to load from Supabase: ${e.message}`);
    return;
  }

  renderStoreToggle();
  renderAll();
}

function showLoading(msg) {
  document.getElementById('left-col').innerHTML =
    `<div class="status-msg">${esc(msg)}</div>`;
  document.getElementById('mapped-list').innerHTML = '';
}

function showError(msg) {
  document.getElementById('left-col').innerHTML =
    `<div class="status-msg" style="color:var(--red)">${esc(msg)}</div>`;
}

// ── Store toggle ──────────────────────────────────────────────────────────────

function renderStoreToggle() {
  const bar = document.getElementById('store-toggle-bar');
  if (!bar) return;
  bar.innerHTML = `
    <span style="font-size:12px;font-weight:600;color:#666;margin-right:6px">Mapping for:</span>
    <button id="toggle-barbora" class="store-toggle-btn${activeStore === 'barbora' ? ' active' : ''}">Barbora</button>
    <button id="toggle-rimi"    class="store-toggle-btn${activeStore === 'rimi'    ? ' active' : ''}">Rimi</button>
    <button id="toggle-selver"  class="store-toggle-btn${activeStore === 'selver'  ? ' active' : ''}">Selver</button>
  `;
  bar.querySelector('#toggle-barbora').addEventListener('click', () => switchStore('barbora'));
  bar.querySelector('#toggle-rimi').addEventListener('click',    () => switchStore('rimi'));
  bar.querySelector('#toggle-selver').addEventListener('click',  () => switchStore('selver'));
}

function switchStore(store) {
  activeStore = store;
  current     = 0;
  renderStoreToggle();
  renderAll();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function skusForCurrent(ingredientId) {
  return skuMap[ingredientId]?.[activeStore] || [];
}

function mappedForStore() {
  return ingredients.filter(ing => skusForCurrent(ing.id).length > 0);
}

function unmapped() {
  return ingredients.filter(ing => skusForCurrent(ing.id).length === 0);
}

function currentIngredient() {
  const list = unmapped();
  return list[current] || null;
}

const STORE_LABEL = { barbora: 'Barbora', rimi: 'Rimi', selver: 'Selver' };
const STORE_INIT  = { barbora: 'B', rimi: 'R', selver: 'S' };

// ── Render ────────────────────────────────────────────────────────────────────

function renderAll() {
  updateProgress();
  renderMappedSidebar();
  renderMain();
}

function updateProgress() {
  const done  = mappedForStore().length;
  const total = ingredients.length;
  document.getElementById('progress-pill').textContent =
    `${STORE_LABEL[activeStore]}: ${done} / ${total}`;

  const statusEl = document.getElementById('save-status');
  if (statusEl) {
    if      (saveStatus === 'saving') { statusEl.textContent = 'Saving…';       statusEl.style.color = '#ccc'; }
    else if (saveStatus === 'saved')  { statusEl.textContent = 'Saved ✓';      statusEl.style.color = '#aed97f'; }
    else if (saveStatus === 'error')  { statusEl.textContent = 'Save failed ✗'; statusEl.style.color = '#faa'; }
    else                              { statusEl.textContent = ''; }
  }
}

function renderMappedSidebar() {
  const el     = document.getElementById('mapped-list');
  const mapped = mappedForStore();

  if (!mapped.length) {
    el.innerHTML = `<div style="color:#aaa;font-size:13px">Nothing mapped for ${STORE_LABEL[activeStore]} yet.</div>`;
    return;
  }

  const others = ['barbora', 'rimi', 'selver'].filter(s => s !== activeStore);

  el.innerHTML = mapped.map(ing => {
    const skus   = skusForCurrent(ing.id);
    const count  = skus.length;
    const badges = others
      .filter(s => skuMap[ing.id]?.[s]?.length > 0)
      .map(s => `<span title="Also mapped for ${STORE_LABEL[s]}"
                       style="font-size:10px;background:#e8f5e9;color:#2d7a3a;border-radius:3px;padding:1px 4px;margin-left:3px">${STORE_INIT[s]}✓</span>`)
      .join('');
    // List each alternative with its own remove button
    const altList = skus.map(m => `
      <div style="display:flex;align-items:center;gap:6px;padding:3px 0 3px 22px;border-bottom:1px solid #f5f5f5">
        <span style="flex:1;font-size:12px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(m.title)}">${esc(m.title)}</span>
        ${m.price != null ? `<span style="font-size:11px;color:#888;flex-shrink:0">€${Number(m.price).toFixed(2)}</span>` : ''}
        <button class="mapped-undo" data-ingid="${esc(ing.id)}" data-rowid="${esc(m.rowId)}" title="Remove">×</button>
      </div>`).join('');

    return `
      <div class="mapped-item" style="flex-wrap:wrap;align-items:flex-start">
        <span class="mapped-check" style="padding-top:2px">✓</span>
        <span class="mapped-name" style="flex:1">${esc(ing.name_en)}${badges}
          ${count > 1 ? `<span style="font-size:10px;background:#e8f0fe;color:#3c4aaa;border-radius:10px;padding:1px 6px;margin-left:4px">${count} options</span>` : ''}
        </span>
        <div style="width:100%">${altList}</div>
      </div>`;
  }).join('');

  el.querySelectorAll('.mapped-undo').forEach(btn => {
    btn.addEventListener('click', () => removeAlternative(btn.dataset.ingid, btn.dataset.rowid));
  });
}

function renderMain() {
  const col        = document.getElementById('left-col');
  const todo       = unmapped();
  const storeLabel = STORE_LABEL[activeStore];

  if (!todo.length) {
    col.innerHTML = `
      <div class="done-banner">
        <h2>✓ All ${ingredients.length} ingredients mapped for ${storeLabel}</h2>
        <p>Switch stores above to map the other ones. All data is live in Supabase.</p>
      </div>`;
    return;
  }

  if (current >= todo.length) current = todo.length - 1;
  const ing    = todo[current];
  const etTerm = ing.name_et || ing.name_en;

  // Cross-store hints
  const otherHints = ['barbora', 'rimi', 'selver']
    .filter(s => s !== activeStore && skuMap[ing.id]?.[s]?.length > 0)
    .map(s => {
      const skus  = skuMap[ing.id][s];
      const label = STORE_LABEL[s];
      const names = skus.map(m => `<em>${esc(m.title)}</em>`).join(', ');
      return `<div style="font-size:11px;color:#888;margin-top:4px">${label}: ${names}</div>`;
    }).join('');

  col.innerHTML = `
    <div class="ingredient-card">
      <div class="ingredient-label">Ingredient ${current + 1} of ${todo.length} remaining for ${storeLabel}</div>
      <div class="ingredient-name">${esc(ing.name_en)}</div>
      ${ing.name_et    ? `<div style="font-size:13px;color:#888;margin-bottom:4px">${esc(ing.name_et)}</div>` : ''}
      ${ing.category   ? `<div style="font-size:11px;color:#bbb;margin-bottom:10px;text-transform:uppercase;letter-spacing:.4px">${esc(ing.category)}</div>` : ''}
      ${otherHints}
      <div class="search-row" style="margin-top:12px">
        <input id="search-input" type="text" value="${esc(etTerm)}" placeholder="Search on ${storeLabel}…">
        <button class="btn-search" id="search-btn">Search</button>
      </div>
    </div>

    <div class="nav-row">
      <button class="btn-nav" id="prev-btn" ${current === 0 ? 'disabled' : ''}>← Previous</button>
      <button class="btn-nav" id="next-btn" ${current >= todo.length - 1 ? 'disabled' : ''}>Next →</button>
      <button class="btn-nav btn-skip" id="skip-btn">Skip for now</button>
    </div>

    <div id="results-area">
      <div class="status-msg">Press Search to find matches on ${storeLabel}.</div>
    </div>
  `;

  document.getElementById('search-btn').addEventListener('click', doSearch);
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
  document.getElementById('prev-btn')?.addEventListener('click', () => { current--; renderMain(); });
  document.getElementById('next-btn')?.addEventListener('click', () => { current++; renderMain(); });
  document.getElementById('skip-btn').addEventListener('click', () => {
    if (current < todo.length - 1) current++;
    renderMain();
  });

  doSearch();
}

// ── Search ────────────────────────────────────────────────────────────────────

async function doSearch() {
  const query = document.getElementById('search-input')?.value?.trim();
  if (!query) return;

  const area = document.getElementById('results-area');
  area.innerHTML = '<div class="status-msg">Searching…</div>';

  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: 'SEARCH', query, limit: 9, store: activeStore });
  } catch (e) {
    area.innerHTML = `<div class="status-msg" style="color:var(--red)">Extension error: ${esc(e.message)}</div>`;
    return;
  }

  if (!resp || resp.error) {
    const hints = {
      barbora: 'Make sure you are logged into barbora.ee.',
      rimi:    'Make sure you are logged into rimi.ee/epood and have a delivery slot selected.',
      selver:  'Check your internet connection — Selver search requires no login.',
    };
    area.innerHTML = `<div class="status-msg" style="color:var(--red)">
      ${esc(resp?.error || 'No response from extension')}
      <br><small style="color:#888">${hints[activeStore]}</small>
    </div>`;
    return;
  }

  if (!resp.results?.length) {
    area.innerHTML = `<div class="status-msg">No results — try a different search term.</div>`;
    return;
  }

  searchResults = resp.results;
  renderResults();
}

function renderResults() {
  const area    = document.getElementById('results-area');
  const ing     = currentIngredient();
  const addedSkus = new Set((ing ? skusForCurrent(ing.id) : []).map(m => String(m.sku)));

  area.innerHTML = `
    ${ing && addedSkus.size > 0 ? `
      <div style="margin-bottom:14px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#888;margin-bottom:8px">
          Added so far (${addedSkus.size}) — add more or press Next →
        </div>
        ${skusForCurrent(ing.id).map(m => `
          <div style="display:flex;align-items:center;gap:8px;background:#f2f8eb;border:1px solid #c8e8a0;border-radius:6px;padding:8px 12px;margin-bottom:6px">
            ${m.image ? `<img src="${esc(m.image)}" style="width:36px;height:36px;object-fit:contain;border-radius:4px;background:#fff" onerror="this.style.display='none'">` : ''}
            <span style="flex:1;font-size:13px;font-weight:500">${esc(m.title)}</span>
            ${m.price != null ? `<span style="font-size:13px;font-weight:700;color:var(--green-dark)">€${Number(m.price).toFixed(2)}</span>` : ''}
            <button class="mapped-undo remove-added" data-ingid="${esc(ing.id)}" data-rowid="${esc(m.rowId)}" title="Remove" style="font-size:16px;padding:0 4px">×</button>
          </div>`).join('')}
      </div>` : ''}
    <div class="results-grid">
      ${searchResults.map((p, i) => {
        const alreadyAdded = addedSkus.has(String(p.sku));
        return `
          <div class="result-card${alreadyAdded ? ' selected' : ''}" id="card-${i}">
            <img src="${esc(p.image || '')}" alt="" onerror="this.style.display='none'">
            <div class="result-card-title">${esc(p.title)}</div>
            <div class="result-card-price">€${(p.price || 0).toFixed(2)}</div>
            <div class="result-card-sku">${esc(p.sku)}</div>
            <button class="select-btn" data-idx="${i}" ${alreadyAdded ? 'disabled style="background:#aaa;cursor:default"' : ''}>
              ${alreadyAdded ? 'Added ✓' : 'Add ✓'}
            </button>
          </div>`;
      }).join('')}
    </div>
  `;

  area.querySelectorAll('.select-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => addProduct(searchResults[parseInt(btn.dataset.idx)]));
  });
  area.querySelectorAll('.remove-added').forEach(btn => {
    btn.addEventListener('click', () => removeAlternative(btn.dataset.ingid, btn.dataset.rowid));
  });
}

// ── Mapping ───────────────────────────────────────────────────────────────────

async function addProduct(product) {
  const ing = currentIngredient();
  if (!ing) return;

  // Guard: don't add the same SKU twice
  const existing = skusForCurrent(ing.id);
  if (existing.some(m => String(m.sku) === String(product.sku))) return;

  setSaveStatus('saving');

  const payload = {
    ingredient_id:      ing.id,
    supermarket:        activeStore,
    sku:                String(product.sku),
    display_name:       product.title,
    last_price_eur:     product.price || null,
    last_price_seen_at: new Date().toISOString(),
    image_url:          product.image || null,
  };

  try {
    const savedRow = await sbPost('/ingredient_skus', payload);

    if (!skuMap[ing.id])              skuMap[ing.id] = {};
    if (!skuMap[ing.id][activeStore]) skuMap[ing.id][activeStore] = [];
    skuMap[ing.id][activeStore].push({
      rowId: savedRow?.id,
      sku:   String(product.sku),
      title: product.title,
      price: product.price,
      image: product.image || '',
    });

    setSaveStatus('saved');
    setTimeout(() => { saveStatus = null; updateProgress(); }, 2000);

    // Re-render results in place so Oli can keep adding without losing the result grid
    updateProgress();
    renderMappedSidebar();
    renderResults();

  } catch (e) {
    console.error('Save failed:', e);
    setSaveStatus('error');
    setTimeout(() => { saveStatus = null; updateProgress(); }, 4000);
  }
}

async function removeAlternative(ingredientId, rowId) {
  const skus = skuMap[ingredientId]?.[activeStore];
  if (!skus) return;

  setSaveStatus('saving');

  try {
    await sbDelete(`/ingredient_skus?id=eq.${rowId}`);

    skuMap[ingredientId][activeStore] = skus.filter(m => String(m.rowId) !== String(rowId));
    if (skuMap[ingredientId][activeStore].length === 0) {
      delete skuMap[ingredientId][activeStore];
    }

    setSaveStatus('saved');
    setTimeout(() => { saveStatus = null; updateProgress(); }, 2000);

    // If this ingredient is now unmapped, recalculate current index
    const todo = unmapped();
    if (current >= todo.length) current = Math.max(0, todo.length - 1);
    renderAll();

  } catch (e) {
    console.error('Delete failed:', e);
    setSaveStatus('error');
    setTimeout(() => { saveStatus = null; updateProgress(); }, 4000);
  }
}

function setSaveStatus(status) {
  saveStatus = status;
  updateProgress();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

init();
