// planner.js — Meal planner

// ── Constants ──────────────────────────────────────────────────────────────────

const SHOWN_TAGS = [
  'pasta','chicken','beef','pork','fish','asian','soup','quick','bake','comfort food',
];

const PANTRY_GROUPS = [
  { label: 'Oils & fats',   items: ['Olive oil','Sunflower oil','Butter'] },
  { label: 'Aromatics',     items: ['Garlic','Onion','Red onion'] },
  { label: 'Dairy & eggs',  items: ['Milk','Egg'] },
  { label: 'Dry goods',     items: ['Plain flour','Corn starch'] },
  { label: 'Spices',        items: ['Dried oregano','Dried basil','Dried thyme','Dried rosemary',
                                     'Dried parsley','Dried dill','Dried chilli flakes',
                                     'Paprika','Ground cumin','Garlic powder','Curry powder'] },
  { label: 'Condiments',    items: ['Soy sauce','Sesame oil','Honey','Mustard','Dijon mustard',
                                     'Ketchup','Tomato paste'] },
  { label: 'Stock & bases', items: ['Vegetable stock cube','Chicken stock cube',
                                     'Beef stock cube','Tikka masala paste'] },
];

const SERVING_OPTIONS = [2, 4, 6, 8];

// ── State ─────────────────────────────────────────────────────────────────────

let recipes         = [];
let ingredientMap   = {};
let selected        = new Set();    // recipeId
let servings        = {};           // { recipeId: number }
let favourites      = new Set();    // recipeId
let history         = [];           // [{ date: ISO, ids: [], names: [] }]
let pantryItems     = new Set();    // ingredient names user already has
let vegOnly         = false;
let activeTag       = null;
let showFavsOnly    = false;
let showRecentOnly  = false;
let pricesUpdatedAt = null;

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const [recipesData, stored] = await Promise.all([
    fetch(chrome.runtime.getURL('recipes.json')).then(r => r.json()),
    chrome.storage.local.get([
      'ingredientMap','favourites','mealHistory','pantryItems','pricesUpdatedAt',
    ]),
  ]);

  recipes         = recipesData.recipes;
  ingredientMap   = stored.ingredientMap  || {};
  favourites      = new Set(stored.favourites   || []);
  history         = stored.mealHistory    || [];
  pantryItems     = new Set(stored.pantryItems  || []);
  pricesUpdatedAt = stored.pricesUpdatedAt || null;

  updatePriceAge();
  renderTagPills();
  renderPantryPanel();
  renderGrid();
  bindStaticEvents();
}

// ── Event bindings ────────────────────────────────────────────────────────────

function bindStaticEvents() {
  document.getElementById('filter-all').addEventListener('click', () => {
    vegOnly = false; activeTag = null; showFavsOnly = false; showRecentOnly = false;
    syncFilterUI(); renderGrid();
  });
  document.getElementById('filter-veg').addEventListener('click', () => {
    vegOnly = !vegOnly; activeTag = null; showFavsOnly = false; showRecentOnly = false;
    syncFilterUI(); renderGrid();
  });
  document.getElementById('filter-favs').addEventListener('click', () => {
    showFavsOnly = !showFavsOnly; vegOnly = false; activeTag = null; showRecentOnly = false;
    syncFilterUI(); renderGrid();
  });
  document.getElementById('filter-recent').addEventListener('click', () => {
    showRecentOnly = !showRecentOnly; vegOnly = false; activeTag = null; showFavsOnly = false;
    syncFilterUI(); renderGrid();
  });

  document.getElementById('pantry-btn').addEventListener('click', ()   => openPantry());
  document.getElementById('pantry-close').addEventListener('click', () => closePantry());
  document.getElementById('pantry-overlay').addEventListener('click',() => closePantry());
  document.getElementById('pantry-clear-btn').addEventListener('click', clearPantry);

  document.getElementById('add-btn').addEventListener('click',  addToShoppingList);
  document.getElementById('done-btn').addEventListener('click', closeModal);
  document.getElementById('refresh-btn').addEventListener('click', refreshPrices);
  document.getElementById('overlap-toggle').addEventListener('click', toggleOverlap);
}

// ── Filters ───────────────────────────────────────────────────────────────────

function renderTagPills() {
  const container = document.getElementById('tag-pills');
  container.innerHTML = SHOWN_TAGS.map(tag =>
    `<button class="filter-pill tag-pill" data-tag="${tag}">${cap(tag)}</button>`
  ).join('');
  container.querySelectorAll('.tag-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTag      = (activeTag === btn.dataset.tag) ? null : btn.dataset.tag;
      vegOnly        = false;
      showFavsOnly   = false;
      showRecentOnly = false;
      syncFilterUI();
      renderGrid();
    });
  });
}

function syncFilterUI() {
  const none = !vegOnly && !activeTag && !showFavsOnly && !showRecentOnly;
  document.getElementById('filter-all').classList.toggle('active', none);
  document.getElementById('filter-veg').classList.toggle('active', vegOnly);
  document.getElementById('filter-favs').classList.toggle('active', showFavsOnly);
  document.getElementById('filter-recent').classList.toggle('active', showRecentOnly);
  document.getElementById('pantry-btn').classList.toggle('active',
    document.getElementById('pantry-panel').classList.contains('open'));
  document.querySelectorAll('.tag-pill').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tag === activeTag)
  );
}

function recentIds() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const ids = new Set();
  history.forEach(e => {
    if (new Date(e.date).getTime() > cutoff) e.ids.forEach(id => ids.add(id));
  });
  return ids;
}

function visibleRecipes() {
  const rIds = showRecentOnly ? recentIds() : null;
  return recipes.filter(r => {
    if (vegOnly && !r.vegetarian) return false;
    if (activeTag && !r.tags.includes(activeTag)) return false;
    if (showFavsOnly && !favourites.has(r.id)) return false;
    if (showRecentOnly && !rIds.has(r.id)) return false;
    return true;
  });
}

// ── Recipe grid ───────────────────────────────────────────────────────────────

function renderGrid() {
  const grid    = document.getElementById('recipe-grid');
  const visible = visibleRecipes();

  if (!visible.length) {
    const msg = showFavsOnly
      ? 'No favourites yet — click ★ on a recipe to save it.'
      : showRecentOnly
        ? 'No meals cooked in the last 30 days.'
        : 'No recipes match this filter.';
    grid.innerHTML = `<div class="no-results">${msg}</div>`;
    return;
  }

  grid.innerHTML = visible.map(r => cardHTML(r)).join('');
  bindCardEvents(grid);
}

function bindCardEvents(root) {
  root.querySelectorAll('.recipe-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.card-fav, .serving-stepper')) return;
      toggleRecipe(card.dataset.id);
    });
  });
  root.querySelectorAll('.card-fav').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleFavourite(btn.dataset.id);
    });
  });
  root.querySelectorAll('.serving-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      setServings(btn.dataset.id, parseInt(btn.dataset.val));
    });
  });
}

// ── Card HTML ─────────────────────────────────────────────────────────────────

function recipeEstimatedPrice(r, srv) {
  const mult = Math.max(1, Math.ceil((srv || 4) / 4));
  let total = 0;
  r.ingredients.forEach(ing => {
    if (pantryItems.has(ing.name)) return;
    const m = ingredientMap[ing.name];
    if (m) total += (m.price || 0) * mult;
  });
  return total;
}

function lastMadeLabel(id) {
  const entry = [...history].find(e => e.ids.includes(id));
  if (!entry) return null;
  const days = Math.floor((Date.now() - new Date(entry.date).getTime()) / 86400000);
  if (days === 0) return 'Added today';
  if (days < 7)  return `Made ${days}d ago`;
  if (days < 30) return `Made ${Math.floor(days/7)}w ago`;
  return null;
}

function cardHTML(r) {
  const isSel    = selected.has(r.id);
  const isFav    = favourites.has(r.id);
  const totalMin = r.prepTime + r.cookTime;
  const unmapped = r.ingredients.filter(i => !ingredientMap[i.name]).length;
  const srv      = servings[r.id] || 4;
  const price    = recipeEstimatedPrice(r, srv);
  const tags     = r.tags.filter(t => t !== 'vegetarian').slice(0, 2);
  const madeLabel= lastMadeLabel(r.id);

  return `
    <div class="recipe-card${isSel ? ' selected' : ''}" data-id="${r.id}">
      <button class="card-fav${isFav ? ' active' : ''}" data-id="${r.id}"
        title="${isFav ? 'Remove from favourites' : 'Add to favourites'}">★</button>
      <div class="card-check">✓</div>
      <div class="card-tags">
        ${r.vegetarian ? '<span class="tag veg">Vegetarian</span>' : ''}
        ${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
        ${madeLabel ? `<span class="tag recent">${esc(madeLabel)}</span>` : ''}
      </div>
      <div class="card-name">${esc(r.name)}</div>
      <div class="card-desc">${esc(r.description)}</div>
      <div class="card-meta">
        <span>⏱ ${totalMin} min</span>
        <span>${r.ingredients.length} ingredients</span>
        ${price > 0 ? `<span class="price-badge">~€${price.toFixed(2)}</span>` : ''}
        ${unmapped > 0 ? `<span class="warn">⚠ ${unmapped} unmapped</span>` : ''}
      </div>
      ${isSel ? `
        <div class="serving-stepper">
          <span class="serving-label">Servings:</span>
          ${SERVING_OPTIONS.map(v => `
            <button class="serving-btn${v === srv ? ' active' : ''}"
              data-id="${r.id}" data-val="${v}">${v}</button>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

// ── Selection ─────────────────────────────────────────────────────────────────

function toggleRecipe(id) {
  if (selected.has(id)) {
    selected.delete(id);
  } else {
    selected.add(id);
    if (!servings[id]) servings[id] = 4;
  }
  rerenderCard(id);
  updateSelectionUI();
}

function toggleFavourite(id) {
  if (favourites.has(id)) favourites.delete(id);
  else favourites.add(id);
  chrome.storage.local.set({ favourites: [...favourites] });
  rerenderCard(id);
}

function setServings(id, val) {
  servings[id] = val;
  rerenderCard(id);
  updateSelectionUI();
}

function rerenderCard(id) {
  const old    = document.querySelector(`.recipe-card[data-id="${id}"]`);
  if (!old) return;
  const recipe = recipes.find(r => r.id === id);
  if (!recipe) return;
  const wrapper  = document.createElement('div');
  wrapper.innerHTML = cardHTML(recipe).trim();
  const newCard = wrapper.firstElementChild;
  bindCardEvents(wrapper);
  old.replaceWith(newCard);
}

// ── Selection summary ─────────────────────────────────────────────────────────

function updateSelectionUI() {
  const count  = selected.size;
  const addBtn = document.getElementById('add-btn');
  const selBar = document.getElementById('sel-bar');

  addBtn.disabled = count === 0;
  selBar.style.display = count > 0 ? '' : 'none';

  document.getElementById('sel-count').textContent =
    count === 0 ? '0 meals selected' : `${count} meal${count !== 1 ? 's' : ''} selected`;

  if (!count) return;

  const items = aggregateItems();
  const cost  = computeTotalCost();

  document.getElementById('sel-meals').textContent = `${count} meal${count !== 1 ? 's' : ''}`;
  document.getElementById('sel-items').textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;
  const priceEl    = document.getElementById('sel-price');
  const priceDotEl = document.getElementById('sel-price-dot');
  if (cost > 0) {
    priceEl.textContent    = `~€${cost.toFixed(2)}`;
    priceDotEl.style.display = '';
  } else {
    priceEl.textContent    = '';
    priceDotEl.style.display = 'none';
  }

  refreshOverlapUI();
}

function computeTotalCost() {
  let total = 0;
  for (const id of selected) {
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) continue;
    const mult = Math.max(1, Math.ceil((servings[id] || 4) / 4));
    recipe.ingredients.forEach(ing => {
      if (pantryItems.has(ing.name)) return;
      const m = ingredientMap[ing.name];
      if (m) total += (m.price || 0) * mult;
    });
  }
  return total;
}

// ── Overlap ───────────────────────────────────────────────────────────────────

function getOverlapData() {
  const counts = {};
  for (const id of selected) {
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) continue;
    recipe.ingredients.forEach(ing => {
      counts[ing.name] = (counts[ing.name] || 0) + 1;
    });
  }
  return Object.entries(counts)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function refreshOverlapUI() {
  const overlap   = getOverlapData();
  const toggleBtn = document.getElementById('overlap-toggle');
  const panel     = document.getElementById('overlap-panel');

  if (!overlap.length) {
    toggleBtn.style.display = 'none';
    panel.style.display     = 'none';
    return;
  }

  toggleBtn.style.display = '';
  const isOpen = panel.style.display !== 'none';
  toggleBtn.textContent = `${overlap.length} shared ingredient${overlap.length !== 1 ? 's' : ''} ${isOpen ? '▴' : '▾'}`;

  if (isOpen) renderOverlapItems(overlap);
}

function renderOverlapItems(overlap) {
  const panel = document.getElementById('overlap-panel');
  panel.innerHTML = overlap.map(({ name, count }) => `
    <span class="overlap-item${pantryItems.has(name) ? ' in-pantry' : ''}">
      ${esc(name)}<span class="overlap-count"> ×${count}</span>${pantryItems.has(name) ? ' ✓' : ''}
    </span>
  `).join('');
}

function toggleOverlap() {
  const panel     = document.getElementById('overlap-panel');
  const isOpen    = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : '';
  if (!isOpen) renderOverlapItems(getOverlapData());
  refreshOverlapUI();
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function aggregateItems() {
  const acc = new Map(); // sku → item

  for (const id of selected) {
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) continue;
    const mult = Math.max(1, Math.ceil((servings[id] || 4) / 4));

    recipe.ingredients.forEach(ing => {
      if (pantryItems.has(ing.name)) return;
      const m = ingredientMap[ing.name];
      if (!m) return;

      if (acc.has(m.sku)) {
        acc.get(m.sku).quantity += mult;
      } else {
        acc.set(m.sku, { sku: m.sku, title: m.title, price: m.price, image: m.image || '', quantity: mult });
      }
    });
  }

  return [...acc.values()];
}

// ── Add to shopping list ──────────────────────────────────────────────────────

async function addToShoppingList() {
  const items = aggregateItems();
  if (!items.length) return;

  await chrome.storage.local.set({ savedItems: items });

  // Record history
  const selRecipes = [...selected].map(id => recipes.find(r => r.id === id)).filter(Boolean);
  history = [
    { date: new Date().toISOString(), ids: selRecipes.map(r => r.id), names: selRecipes.map(r => r.name) },
    ...history,
  ].slice(0, 20);
  await chrome.storage.local.set({ mealHistory: history });

  // Build modal summary
  const skipped = [], unmapped = [];
  for (const id of selected) {
    recipes.find(r => r.id === id)?.ingredients.forEach(ing => {
      if (pantryItems.has(ing.name) && !skipped.includes(ing.name)) skipped.push(ing.name);
      else if (!ingredientMap[ing.name] && !pantryItems.has(ing.name) && !unmapped.includes(ing.name)) unmapped.push(ing.name);
    });
  }

  let body = `${items.length} product${items.length !== 1 ? 's' : ''} from ${selected.size} meal${selected.size !== 1 ? 's' : ''}`;
  if (skipped.length) body += `\n${skipped.length} pantry item${skipped.length !== 1 ? 's' : ''} skipped (already in kitchen)`;
  if (unmapped.length) body += `\n${unmapped.length} ingredient${unmapped.length !== 1 ? 's' : ''} had no mapping and were skipped`;

  document.getElementById('modal-body').textContent = body;
  document.getElementById('overlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('overlay').style.display = 'none';
  selected.clear();
  servings = {};
  updateSelectionUI();
  renderGrid();
}

// ── Pantry ────────────────────────────────────────────────────────────────────

function renderPantryPanel() {
  const container = document.getElementById('pantry-groups');
  container.innerHTML = PANTRY_GROUPS.map(group => `
    <div class="pantry-group">
      <div class="pantry-group-label">${esc(group.label)}</div>
      ${group.items.map(name => `
        <label class="pantry-item">
          <input type="checkbox" class="pantry-check" data-name="${esc(name)}"
            ${pantryItems.has(name) ? 'checked' : ''}>
          <span>${esc(name)}</span>
        </label>
      `).join('')}
    </div>
  `).join('');

  container.querySelectorAll('.pantry-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) pantryItems.add(cb.dataset.name);
      else pantryItems.delete(cb.dataset.name);
      chrome.storage.local.set({ pantryItems: [...pantryItems] });
      updateSelectionUI();
    });
  });
}

function openPantry() {
  document.getElementById('pantry-panel').classList.add('open');
  document.getElementById('pantry-overlay').style.display = '';
  document.getElementById('pantry-btn').classList.add('active');
}
function closePantry() {
  document.getElementById('pantry-panel').classList.remove('open');
  document.getElementById('pantry-overlay').style.display = 'none';
  document.getElementById('pantry-btn').classList.remove('active');
}
function clearPantry() {
  pantryItems.clear();
  chrome.storage.local.set({ pantryItems: [] });
  renderPantryPanel();
  updateSelectionUI();
}

// ── Price refresh ─────────────────────────────────────────────────────────────

async function refreshPrices() {
  const btn = document.getElementById('refresh-btn');
  btn.textContent = '↻ Refreshing…';
  btn.disabled    = true;

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'REFRESH_PRICES', ingredientMap });
    if (resp.error) throw new Error(resp.error);
    ingredientMap   = resp.ingredientMap;
    pricesUpdatedAt = resp.updatedAt;
    await chrome.storage.local.set({ ingredientMap, pricesUpdatedAt });
    updatePriceAge();
    renderGrid();
    updateSelectionUI();
  } catch (e) {
    console.warn('Price refresh failed:', e.message);
  }

  btn.textContent = '↻ Refresh prices';
  btn.disabled    = false;
}

function updatePriceAge() {
  const el = document.getElementById('price-age');
  if (!pricesUpdatedAt) { el.textContent = ''; return; }
  const days = Math.floor((Date.now() - new Date(pricesUpdatedAt).getTime()) / 86400000);
  el.textContent = days === 0 ? 'Prices current ·' : `Prices ${days}d old ·`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
