# API Reference

Base URL: `https://whatihave.xyz`

## Authentication

All endpoints require a Bearer token via the `Authorization` header:

```
Authorization: Bearer inv_<your_api_key>
```

> **Note:** The base URL may redirect. Use `--location-trusted` with curl (or equivalent) to preserve the auth header across redirects.

---

## Portfolios

### List Portfolios

```
GET /api/v1/portfolios
```

**Response** `200 OK`

```json
[
  {
    "id": "uuid",
    "name": "My Portfolio",
    "created_at": "2025-01-01T00:00:00.000Z"
  }
]
```

---

## Transactions

### List Transactions

```
GET /api/v1/transactions
```

**Query Parameters**

| Name | Type | Description |
|------|------|-------------|
| `portfolio` | string | Filter by portfolio name. Omit to include all portfolios. |
| `ticker` | string | Filter by ticker symbol. |
| `from` | string | Start date (inclusive), `YYYY-MM-DD`. |
| `to` | string | End date (inclusive), `YYYY-MM-DD`. |

**Response** `200 OK`

```json
[
  {
    "id": "uuid",
    "portfolio_id": "uuid",
    "ticker": "AAPL",
    "type": "buy",
    "date": "2025-06-15",
    "shares": 10,
    "price_at_entry": 150.00,
    "amount": null,
    "currency": null,
    "created_at": "...",
    "updated_at": "..."
  }
]
```

---

### Create Transaction

```
POST /api/v1/transactions
```

**Request Body** (JSON)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ticker` | string | **yes** | Ticker symbol, or `_CASH` for cash transactions. |
| `type` | string | **yes** | One of: `buy`, `sell`, `deposit`, `withdraw`. |
| `date` | string | **yes** | Transaction date, `YYYY-MM-DD`. |
| `shares` | number | buy/sell | Number of shares. |
| `price_at_entry` | number | buy/sell | Price per share at time of transaction. |
| `amount` | number | deposit/withdraw | Cash amount. |
| `currency` | string | no | Currency code (e.g. `EUR`, `USD`). |
| `portfolio` | string | no | Portfolio name. Defaults to the first portfolio. |

**Examples**

Buy shares:

```json
{
  "ticker": "AAPL",
  "type": "buy",
  "date": "2025-06-15",
  "shares": 10,
  "price_at_entry": 150.00
}
```

Deposit cash:

```json
{
  "ticker": "_CASH",
  "type": "deposit",
  "date": "2025-06-15",
  "amount": 5000,
  "currency": "EUR"
}
```

**Response** `201 Created`

```json
{
  "id": "uuid",
  "portfolio_id": "uuid",
  "ticker": "_CASH",
  "type": "deposit",
  "date": "2025-06-15",
  "shares": null,
  "price_at_entry": null,
  "amount": 5000,
  "currency": "EUR",
  "created_at": "...",
  "updated_at": "..."
}
```

---

### Delete Transaction

```
DELETE /api/v1/transactions/:id
```

**URL Parameters**

| Name | Type | Description |
|------|------|-------------|
| `id` | uuid | Transaction ID. |

**Response** `204 No Content`

---

## Errors

All error responses return JSON with an `error` field:

```json
{
  "error": "Missing required fields: ticker, type, date"
}
```

| Status | Meaning |
|--------|---------|
| `400` | Bad request (missing/invalid fields). |
| `401` | Missing or invalid API key. |
| `404` | Resource not found. |
| `405` | Method not allowed. |
| `500` | Internal server error. |
