# Barbora.ee API Spec

Reverse-engineered 2026-04-22 via Chrome DevTools network interception on barbora.ee.

---

## Architecture

The site runs on **Remix.run** (SSR). Most page navigations are full page loads, not SPA transitions. Client-side API calls happen for cart mutations, checkout data, and autocomplete — these are what the extension intercepts and replays.

There are **two API surface areas**:

| Pattern | Auth | Use |
|---|---|---|
| `https://barbora.ee/api/eshop/v1/` | Explicit headers (`X-Session-ID`, `ClientVersion`) | Cart mutations, search autocomplete |
| `https://barbora.ee/proxy/api/v1/` | Cookies only (no extra headers) | Cart summary, checkout, user/address/timeslot data |

Both share the same session (same cookies). The `/proxy/` routes are handled by the Remix server which forwards to the backend, so the browser's session cookies are sufficient.

---

## Authentication

### Session cookies (all requests)
The browser session is cookie-based. The relevant cookies:

| Cookie | Notes |
|---|---|
| `X-Session-ID` | **Non-httpOnly UUID** — readable via `document.cookie`. Must also be sent as a request header on `/api/eshop/v1/` calls. |
| `AWSALB` / `AWSALBCORS` | AWS load balancer stickiness — set automatically |
| `lang` | Language preference |

### Request headers (for `/api/eshop/v1/` endpoints only)
```
Content-type: application/json
ClientVersion: v2.67.18
X-Session-ID: <uuid from cookie>
```

`ClientVersion` comes from `window.ENV.appVersion` on the page. Current value: `v2.67.18`. Likely needs to be kept in sync with the deployed version.

### Reading auth values from the extension
```js
// Session ID
const sessionId = document.cookie.match(/X-Session-ID=([^;]+)/)?.[1];

// Client version
const clientVersion = window.ENV?.appVersion; // e.g. "v2.67.18"
```

No CSRF token required. No Bearer token. No login endpoint needed — the extension piggybacks on the existing browser session.

---

## Endpoints

### 1. Search autocomplete

```
GET /api/eshop/v1/constructor/autocomplete
  ?request.limit=5
  &request.searchText=piim
```

Headers: `Content-type`, `ClientVersion`, `X-Session-ID`

**Response shape:**
```json
{
  "products": [
    {
      "id": "000000000000139701",
      "title": "Piim ALMA 3,5% 1,5L",
      "price": 1.39,
      "retail_price": 1.58,
      "image": "https://cdn.barbora.ee/products/....png",
      "big_image": "https://cdn.barbora.ee/products/....png",
      "category_name_full_path": "Piimatooted/Piim",
      "category_path_url": "piimatooted/piim",
      "shopcode": "T033",
      "is_adult": false,
      "inFavorites": false,
      "attributes": { "list": [], "additional": { ... } }
    }
  ]
}
```

**Notes:**
- `product_id` is an 18-digit zero-padded string
- `unit: 0` in cart calls corresponds to the default unit (pieces); weighted items may have other unit IDs
- Full search results page is `/otsing?q={query}` — server-side rendered, no API equivalent needed for the extension

---

### 2. Add item to cart

```
POST /api/eshop/v1/cart/item?returnCartInfo=true
```

Headers: `Content-type`, `ClientVersion`, `X-Session-ID`

**Request body:**
```json
{
  "product_id": "000000000000139701",
  "quantity": 1,
  "unit": 0,
  "web_url": "https://barbora.ee/otsing?q=piim"
}
```

**Response:** Full cart object (see Cart Object below). HTTP 200.

---

### 3. Update item quantity

```
PUT /api/eshop/v1/cart/item
```

Headers: `Content-type`, `ClientVersion`, `X-Session-ID`

**Request body:**
```json
{
  "cart_id": "f3ee03c9-63d7-44ac-bf73-9afcacf0ee6d",
  "product_id": "000000000000139701",
  "quantity": 2,
  "unit": 0
}
```

**Response:** Full cart object. HTTP 200.

**Note:** `cart_id` is required for PUT but not for POST. It's returned in every cart response.

---

### 4. Remove item from cart

```
DELETE /api/eshop/v1/cart/item
  ?returnCartInfo=true
  &id={product_id}
  &cartId={cart_id}
```

Headers: `Content-type`, `ClientVersion`, `X-Session-ID`

No request body.

**Response:** Updated cart object. HTTP 200.

---

### 5. Cart summary

```
GET /proxy/api/v1/cart/summary
```

No extra headers (cookies only).

**Response:**
```json
{
  "id": "f3ee03c9-63d7-44ac-bf73-9afcacf0ee6d",
  "prices": {
    "totalItemCount": 2,
    "productPriceWithTareAndDiscounts": 34.89,
    "totalPrice": 36.48,
    "deliveryFee": 0,
    "packagingFee": 1.59,
    "discount": 0,
    "donations": 0
  }
}
```

---

### 6. Validate cart (pre-checkout)

```
POST /proxy/api/v1/cart/validate
```

No extra headers. No body. HTTP 200 = valid.

---

### 7. Get user info

```
GET /proxy/api/v1/user/info
```

**Response:**
```json
{
  "id": "3559fc5d-...",
  "name": "...",
  "surname": "...",
  "email": "...",
  "isEnabled": true,
  "isFirstTimePurchase": false
}
```

Use this to verify the user is logged in. A 401/redirect means no active session.

---

### 8. Get saved addresses

```
GET /proxy/api/v1/address
```

**Response:**
```json
{
  "addresses": [
    {
      "id": "b770c232-...",
      "firstName": "...",
      "address": "Vahepere 1, 13516 Tallinn, Haabersti",
      "postCode": "13516",
      "cityName": "Tallinn, Haabersti",
      "cityId": 1,
      "latitude": 59.43822,
      "longitude": 24.57169
    }
  ]
}
```

---

### 9. Get delivery timeslots

```
GET /proxy/api/v1/timeslot
```

**Response:**
```json
{
  "reservationExpiration": 0,
  "gridSettings": {
    "days": ["2026-04-22", "2026-04-23", ...],
    "hours": ["09:00 - 10:00", "10:00 - 11:00", ...]
  }
}
```

---

### 10. Get timeslot summary (earliest available)

```
GET /proxy/api/v1/timeslot/summary
```

**Response:**
```json
{
  "earliest": {
    "id": "1a87ce4d-...",
    "dayId": "2026-04-23",
    "deliveryTime": "2026-04-23T09:00:00",
    "hour": "09:00 - 10:00",
    "price": 0,
    "defaultPrice": 2.99
  }
}
```

---

### 11. Get payment methods

```
GET /proxy/api/v1/payments/methods
```

**Response:** List of payment providers. Barbora uses **Everypay**, **Neopay**, and **Adyen** (cards, Google Pay, Apple Pay). Adyen client key: `live_KOTARO7SLNAAVDF53C2JB7OFH4VO62QA`.

---

## Cart Object (returned by POST/PUT/DELETE)

```json
{
  "cart": {
    "id": "f3ee03c9-63d7-44ac-bf73-9afcacf0ee6d",
    "name": null,
    "slices": [
      {
        "id": "f3ee03c9-...",
        "vendor_title": "Barbora",
        "products": [
          {
            "quantity": 2.0,
            "unit": {
              "id": 0,
              "price": 1.39,
              "retail_price": 1.58,
              "unit": "units",
              "min": 1.0,
              "max": 12.0,
              "step": 1.0,
              "defaultValue": 1.0
            },
            "allowsubstitutes": true,
            "attributes": { "list": [...] }
          }
        ]
      }
    ]
  }
}
```

Note: product_id is not repeated inside the cart response items — you need to track the mapping yourself when building the extension state.

---

## URL Structure

| Page | URL | Rendered |
|---|---|---|
| Homepage | `https://barbora.ee/` | SSR |
| Search results | `https://barbora.ee/otsing?q={query}` | SSR |
| Cart | `https://barbora.ee/cart` | SSR |
| Checkout | `https://barbora.ee/checkout` | SSR |

---

## App Config (from `window.ENV`)

```json
{
  "appVersion": "v2.67.18",
  "appEnvironment": "production-ee",
  "environment": "production",
  "region": "EE",
  "legacyBaseUrl": "barbora.ee"
}
```

---

## Open Questions / Not Yet Captured

- **Rate limiting:** Not tested. Adding 30 items in quick succession — unknown behaviour.
- **Product listing by category:** No category browse API captured. The extension likely doesn't need it (search is sufficient).
- **Product detail page:** SSR, no separate API endpoint captured.
- **Substitutes:** `allowsubstitutes` flag exists on cart items — PUT can likely toggle it.
- **Weighted items (kg):** `unit` field may take values other than `0` for items sold by weight. Needs testing with e.g. bananas or deli items.
- **Session expiry:** Unknown. The `X-Session-ID` cookie presumably expires with the browser session or after a set timeout.
- **`ClientVersion` staleness:** If Barbora deploys a new app version, `window.ENV.appVersion` changes. The extension should read this dynamically, not hardcode it.
