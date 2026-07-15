# BrightBook Studio

An Educational Activity Book Creator powered by a local Ollama model.

## Requirements

- Ollama
- Model `gemma3:4b`
- Node.js 22+

## Run

```powershell
node server.js
```

Open:

- Landing page: `http://127.0.0.1:4180/`
- App: `http://127.0.0.1:4180/app.html`
- Admin: `http://127.0.0.1:4180/admin.html`

## Optional Configuration

```powershell
$env:OLLAMA_MODEL="gemma3:4b"
$env:OLLAMA_URL="http://127.0.0.1:11434"
$env:PORT="4180"
node server.js
```

The application does not call the OpenAI API. Project data is stored in `data/brightbook.db`.

## Admin, Users, Plans, Features, and Usage History

Open the admin panel:

```text
http://127.0.0.1:4180/admin.html
```

Default admin token:

```text
brightbook-admin
```

For production, set your own token before starting the server:

```powershell
$env:ADMIN_TOKEN="change-this-token"
node server.js
```

The app now includes:

- `plans`: plan tiers and pricing.
- `features`: configurable feature keys such as `activity.coloring`, `quantity.30`, or `advanced.guide-character`.
- `plan_features`: which features each plan can access.
- `users`: customer email, plan, status, access token, optional custom limit.
- `usage_events`: every successful generation is recorded as history only. It is not used as a credit system.

Customer access tokens are sent with generation requests through the `x-user-token` header. You can also open the customer app with:

```text
http://127.0.0.1:4180/?token=USER_TOKEN_HERE
```

The default demo user uses `demo-token`.

### Feature-based access model

BrightBook does not need to sell credits. A plan works by enabling or disabling features.

Examples:

- Starter can include `activity.coloring`, `activity.word-search`, and `quantity.25`.
- Pro can additionally include `activity.educational-story`, `quantity.30`, and `advanced.guide-character`.
- You can create your own keys in the admin panel, such as `export.pdf` or `mode.template-engine`.

The backend currently enforces generation-related feature keys:

- `activity.ACTIVITY_TYPE`
- `quantity.25`
- `quantity.30`
- `advanced.custom-direction`
- `advanced.learning-goal`
- `advanced.guide-character`

Other keys can be created now and wired into future UI/API features later.
