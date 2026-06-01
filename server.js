/**
 * Buidlr Backend Server
 * Main entry point
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { setupWebSocket } = require('./ws');
const config = require('./config');
const { query } = require('./db');
const { getChainConfig } = require('./config');
const dockerService = require('./services/docker');

// Import routes
const authRoutes = require('./routes/auth');
const creditsRoutes = require('./routes/credits');
const keysRoutes = require('./routes/keys');
const projectsRoutes = require('./routes/projects');
const sessionsRoutes = require('./routes/sessions');
const chatRoutes = require('./routes/chat');
const rpcRoutes = require('./routes/rpc');
const exploreRoutes = require('./routes/explore');
const publishRoutes = require('./routes/publish');
const templateRoutes = require('./routes/templates');
const agentRoutes = require('./routes/agents');

// Import middleware
const authMiddleware = require('./middleware/auth');

// Import AI providers config
const { PROVIDERS } = require('./services/ai');

// Initialize Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint (no auth required)
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok' } });
});

// Providers endpoint (no auth required)
app.get('/api/providers', (req, res) => {
  const providerList = Object.entries(PROVIDERS).map(([key, value]) => ({
    id: key,
    displayName: value.displayName,
    defaultModel: value.defaultModel,
    models: value.models
  }));
  
  res.json({ success: true, data: providerList });
});

// RPC routes (no auth required - needed for wallet connection)
app.use('/api/rpc', rpcRoutes);

// Explore routes (no auth required - public gallery)
app.use('/api/explore', exploreRoutes);

// Template routes (GET public, POST /use needs auth — handled in route file)
app.use('/api/templates', templateRoutes);

// Protected routes
app.use('/api/auth', authMiddleware, authRoutes);
app.use('/api/credits', authMiddleware, creditsRoutes);
app.use('/api/keys', authMiddleware, keysRoutes);
app.use('/api/projects', authMiddleware, projectsRoutes);
app.use('/api/sessions', authMiddleware, sessionsRoutes);
app.use('/api/chat', authMiddleware, chatRoutes);
app.use('/api/publish', authMiddleware, publishRoutes);
app.use('/api/agents', agentRoutes); // Mixed auth — user endpoints use authMiddleware, internal endpoints use agent token

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Create HTTP server
const server = createServer(app);

// Set up WebSocket
setupWebSocket(server);

// Start server with startup diagnostics
server.listen(config.PORT, async () => {
  console.log('\n=== Buidlr Backend ===\n');
  console.log(`Server:     http://localhost:${config.PORT}`);
  console.log(`WebSocket:  ws://localhost:${config.PORT}`);

  // Check DB connection
  try {
    await query('SELECT 1');
    console.log(`Database:   ✓ Connected (${config.DB_HOST}:${config.DB_PORT}/${config.DB_NAME})`);
  } catch (err) {
    console.log(`Database:   ✗ Failed (${err.message})`);
  }

  // Show blockchain config
  const chain = getChainConfig();
  console.log(`Blockchain: ${chain.chainName} (chainId: ${chain.chainId}) — ${chain.network}`);
  console.log(`RPC:        ${chain.rpcUrl ? '✓ Configured' : '✗ Not configured'}`);
  console.log(`Buidlr Wallet: ${config.BUIDLR_WALLET_ADDRESS}`);

  // Show AI config
  console.log(`AI (Buidlr): ${config.ANTHROPIC_API_KEY ? '✓ API key set' : '✗ No API key'}`);
  console.log(`Privy:       ${config.PRIVY_APP_ID ? '✓ Configured' : '✗ Not configured'}`);
  console.log(`Encryption:  ${config.ENCRYPTION_KEY ? '✓ Key set' : '✗ No key'}`);

  console.log('\n======================\n');
});

// Auto-stop idle containers every 5 minutes
setInterval(async () => {
  try {
    const idleMinutes = config.CONTAINER_IDLE_TIMEOUT_MINUTES;
    const idleSessions = await query(
      `SELECT id, container_id FROM sessions 
       WHERE container_status = 'running' 
       AND last_activity < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [idleMinutes]
    );

    for (const session of idleSessions) {
      if (session.container_id) {
        try {
          await dockerService.stopContainer(session.container_id);
          await query(
            "UPDATE sessions SET container_status = 'stopped' WHERE id = ?",
            [session.id]
          );
          console.log(`Auto-stopped idle container for session ${session.id}`);
        } catch (err) {
          console.error(`Failed to auto-stop container for session ${session.id}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('Idle cleanup error:', err.message);
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Daily cleanup: remove containers older than MAX_AGE_DAYS
setInterval(async () => {
  try {
    const maxDays = config.CONTAINER_MAX_AGE_DAYS;
    const oldSessions = await query(
      `SELECT id, container_id FROM sessions 
       WHERE container_id IS NOT NULL 
       AND last_activity < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [maxDays]
    );

    for (const session of oldSessions) {
      try {
        await dockerService.removeContainer(session.container_id);
        await query(
          "UPDATE sessions SET container_id = NULL, container_port = NULL, container_status = 'none' WHERE id = ?",
          [session.id]
        );
        console.log(`Cleaned up old container for session ${session.id} (inactive ${maxDays}+ days)`);
      } catch (err) {
        console.error(`Failed to clean up container for session ${session.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Daily cleanup error:', err.message);
  }
}, 24 * 60 * 60 * 1000); // Every 24 hours

// Check for stale agents (no heartbeat in 10 minutes) every 5 minutes
setInterval(async () => {
  try {
    const staleAgents = await query(
      `SELECT id, container_id FROM agents 
       WHERE status = 'running' 
       AND last_heartbeat < DATE_SUB(NOW(), INTERVAL 10 MINUTE)`
    );

    for (const agent of staleAgents) {
      await query("UPDATE agents SET status = 'error' WHERE id = ?", [agent.id]);
      console.log(`Agent ${agent.id} marked as error — no heartbeat for 10+ minutes`);
    }
  } catch (err) {
    console.error('Agent stale check error:', err.message);
  }
}, 5 * 60 * 1000);

module.exports = { app, server };
