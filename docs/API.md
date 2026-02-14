# ClawOps Public API v1

**Base URL:** `https://api.hireopenclaw.com/v1`  
**Authentication:** Bearer token (API secret key)

## Authentication

All API requests require a secret key in the `Authorization` header:

```bash
curl -H "Authorization: Bearer sk_live_your_secret_key" \
  https://api.hireopenclaw.com/v1/bots
```

### Generate API Keys

1. Log into your [dashboard](https://hireopenclaw.com/dashboard)
2. Go to **Settings** → **API Keys**
3. Click **Generate API Key**
4. Save the secret key (shown once only!)

### Key Format

| Type | Format | Example |
|------|--------|---------|
| Public Key | `ck_[env]_[random]` | `ck_live_4vqNj2K9mP8xQwRt` |
| Secret Key | `sk_[env]_[random]` | `sk_live_a1b2c3d4e5f6g7h8` |

### Scopes

| Scope | Description |
|-------|-------------|
| `bots:read` | List and view bots |
| `bots:create` | Create new bots |
| `bots:delete` | Terminate bots |
| `bots:manage` | Pause, resume, restart |
| `usage:read` | View usage data |
| `team:read` | View team members |
| `team:manage` | Invite/remove members |

---

## Rate Limiting

| Plan | Requests/Hour |
|------|--------------|
| Starter | 100 |
| Pro | 1,000 |
| Team | 5,000 |
| Agency | 10,000 |

**Response Headers:**
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1708127056
```

**429 Response:**
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 3600
}
```

---

## Endpoints

### List Bots

```
GET /v1/bots
```

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | 1 | Page number |
| `perPage` | integer | 20 | Results per page (max 100) |

**Response:**
```json
{
  "bots": [
    {
      "id": "tenant-abc123",
      "name": "Marketing Bot",
      "status": "active",
      "template": "marketing",
      "plan": "pro",
      "createdAt": "2026-02-14T12:00:00Z",
      "usage": {
        "messages": 1234,
        "tokensIn": 567890,
        "tokensOut": 345678
      },
      "chatUrl": "https://hireopenclaw.com/chat/tenant-abc123"
    }
  ],
  "total": 5,
  "page": 1,
  "perPage": 20,
  "totalPages": 1
}
```

**Scope:** `bots:read`

---

### Create Bot

```
POST /v1/bots
```

**Request Body:**
```json
{
  "name": "Sales Bot",
  "template": "sales",
  "plan": "pro"
}
```

| Field | Type | Required | Default | Options |
|-------|------|----------|---------|---------|
| `name` | string | ✅ | — | Any name |
| `template` | string | ❌ | `blank` | `blank`, `marketing`, `sales`, `support`, `sdr`, `researcher` |
| `plan` | string | ❌ | `starter` | `starter`, `pro`, `team`, `agency` |

**Response (201):**
```json
{
  "id": "tenant-xyz789",
  "name": "Sales Bot",
  "template": "sales",
  "plan": "pro",
  "status": "provisioning",
  "gatewayToken": "gt_xyz789...",
  "chatUrl": "https://hireopenclaw.com/chat/tenant-xyz789",
  "createdAt": "2026-02-14T14:30:00Z"
}
```

**Scope:** `bots:create`

---

### Delete Bot

```
DELETE /v1/bots/:id
```

**Response:**
```json
{
  "success": true,
  "message": "Bot Sales Bot terminated"
}
```

**Scope:** `bots:delete`

---

### Usage Overview

```
GET /v1/usage
```

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | date | 30 days ago | Start date (YYYY-MM-DD) |
| `to` | date | today | End date (YYYY-MM-DD) |
| `botId` | string | all | Filter by bot ID |

**Response:**
```json
{
  "period": {
    "from": "2026-02-01",
    "to": "2026-02-28"
  },
  "usage": {
    "messages": 12345,
    "tokensIn": 5678901,
    "tokensOut": 3456789,
    "cost": 45.67
  },
  "byBot": [
    {
      "botId": "tenant-abc123",
      "name": "Marketing Bot",
      "messages": 5000,
      "tokensIn": 2500000,
      "tokensOut": 1500000,
      "cost": 20.50
    }
  ]
}
```

**Scope:** `usage:read`

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error type",
  "message": "Human-readable description"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request (missing/invalid parameters) |
| 401 | Unauthorized (invalid or missing API key) |
| 403 | Forbidden (missing scope or not owner) |
| 404 | Not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

---

## SDKs & Libraries

### cURL
```bash
# List bots
curl -H "Authorization: Bearer sk_live_..." \
  https://api.hireopenclaw.com/v1/bots

# Create bot
curl -X POST -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"name":"My Bot","template":"marketing"}' \
  https://api.hireopenclaw.com/v1/bots

# Delete bot
curl -X DELETE -H "Authorization: Bearer sk_live_..." \
  https://api.hireopenclaw.com/v1/bots/tenant-abc123

# Usage
curl -H "Authorization: Bearer sk_live_..." \
  "https://api.hireopenclaw.com/v1/usage?from=2026-02-01&to=2026-02-28"
```

### JavaScript (Node.js)
```javascript
const API_KEY = 'sk_live_your_key';
const BASE = 'https://api.hireopenclaw.com/v1';

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json'
};

// List bots
const bots = await fetch(`${BASE}/bots`, { headers }).then(r => r.json());

// Create bot
const newBot = await fetch(`${BASE}/bots`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ name: 'My Bot', template: 'sales' })
}).then(r => r.json());

// Delete bot
await fetch(`${BASE}/bots/${botId}`, { method: 'DELETE', headers });

// Usage
const usage = await fetch(`${BASE}/usage?from=2026-02-01`, { headers }).then(r => r.json());
```

### Python
```python
import requests

API_KEY = 'sk_live_your_key'
BASE = 'https://api.hireopenclaw.com/v1'
HEADERS = {'Authorization': f'Bearer {API_KEY}'}

# List bots
bots = requests.get(f'{BASE}/bots', headers=HEADERS).json()

# Create bot
new_bot = requests.post(f'{BASE}/bots', headers=HEADERS, json={
    'name': 'My Bot',
    'template': 'marketing'
}).json()

# Usage
usage = requests.get(f'{BASE}/usage?from=2026-02-01', headers=HEADERS).json()
```

---

## Webhooks (Coming Soon)

Subscribe to events:
- `bot.created`
- `bot.terminated`
- `usage.spike`
- `team.member_joined`
- `team.member_left`

---

## Changelog

### v1.0 (Feb 2026)
- Initial release
- Bots: list, create, delete
- Usage: overview with date range
- Rate limiting
- API key management
