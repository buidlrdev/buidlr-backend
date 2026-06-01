# Buidlr Backend

Backend API for [Buidlr](https://buidlr.dev) — an AI-powered app builder and agent launchpad.

## Stack

- **Runtime:** Node.js + Express.js (plain JS, CommonJS)
- **Database:** MySQL (mysql2, raw queries)
- **Auth:** Privy (@privy-io/server-auth)
- **AI:** Multi-provider (Anthropic, OpenAI, Gemini, DeepSeek, Groq)
- **Containers:** Docker (dockerode) for live app previews + agent runtime
- **WebSocket:** Real-time chat streaming + agent log broadcasting
- **Blockchain:** ETH credit purchases via RPC proxy

## Features

- 💬 AI chat-to-code generation with streaming
- 🐳 Docker container orchestration (preview + agents)
- 🔑 Multi-provider AI key management (encrypted AES-256-GCM)
- 💰 Credits system with on-chain ETH verification
- 🤖 AI Agent Launchpad (deploy, monitor, pause/resume)
- 📦 Template gallery
- 🌐 Custom domain support with auto SSL
- 🏪 Explore gallery with clone functionality

## Setup

```bash
# 1. Clone
git clone https://github.com/your-username/buidlr-be.git
cd buidlr-be

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your values

# 4. Setup database
# Run schema.sql on your MySQL database

# 5. Seed templates (optional)
node seed-templates.js

# 6. Start
node server.js

# Production (with PM2)
pm2 start server.js --name buidlr-backend
```

## Prerequisites

- Node.js 20+
- MySQL 8+
- Docker (for container previews)
- Nginx (for preview subdomain proxying)
- Wildcard SSL certificate for preview domain

## Environment Variables

See `.env.example` for all required variables.

## API Endpoints

### Auth
- `POST /api/auth/verify` — Verify Privy token

### Sessions
- `POST /api/sessions` — Create session
- `GET /api/sessions` — List sessions
- `GET /api/sessions/:id` — Session detail + messages
- `POST /api/sessions/:id/files` — Save file edit
- `POST /api/sessions/:id/resume` — Resume container
- `DELETE /api/sessions/:id` — Stop session
- `PATCH /api/sessions/:id` — Rename session

### AI Chat
- WebSocket — Real-time streaming at `ws://host:port`

### Agents
- `POST /api/agents` — Create agent
- `GET /api/agents` — List agents
- `GET /api/agents/:id` — Agent detail + logs
- `POST /api/agents/:id/deploy` — Deploy agent
- `POST /api/agents/:id/pause` — Pause agent
- `POST /api/agents/:id/resume` — Resume agent
- `DELETE /api/agents/:id` — Delete agent

### Templates
- `GET /api/templates` — List templates
- `POST /api/templates/:id/use` — Use template

### Explore
- `GET /api/explore` — Public app gallery
- `POST /api/publish` — Publish app
- `POST /api/publish/:id/clone` — Clone app

### Credits
- `GET /api/credits` — Balance
- `POST /api/credits/purchase` — Purchase with ETH

## License

MIT
