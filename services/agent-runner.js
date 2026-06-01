/**
 * Agent Runner — orchestrates agent Docker containers
 * Handles: create, start, stop, resume, logs
 */

const Docker = require('dockerode');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { query } = require('../db');

const docker = new Docker({ socketPath: config.DOCKER_SOCKET_PATH });
const AGENTS_DIR = '/var/www/buidlr/agents';
const SDK_PATH = path.join(__dirname, 'agent-sdk.js');
const WRAPPER_PATH = path.join(__dirname, 'agent-wrapper.js');

/**
 * Deploy an agent — write files, create container, start
 * @param {string} agentId
 * @param {string} sessionId — session that generated the agent code
 * @returns {{ containerId, status }}
 */
async function deployAgent(agentId, sessionId) {
  // Get agent files from session's chat messages
  const messages = await query(
    `SELECT file_changes FROM chat_messages 
     WHERE session_id = ? AND role = 'assistant' AND file_changes IS NOT NULL
     ORDER BY created_at ASC`,
    [sessionId]
  );

  const fileMap = new Map();
  for (const msg of messages) {
    try {
      const changes = typeof msg.file_changes === 'string'
        ? JSON.parse(msg.file_changes)
        : msg.file_changes;
      if (!Array.isArray(changes)) continue;
      for (const file of changes) {
        if (file.action === 'delete') {
          fileMap.delete(file.path);
        } else {
          fileMap.set(file.path, file);
        }
      }
    } catch (err) { /* skip */ }
  }

  const files = Array.from(fileMap.values());
  if (files.length === 0) {
    throw new Error('No agent files found in session');
  }

  // Create agent directory
  const agentDir = path.join(AGENTS_DIR, agentId);
  await fs.mkdir(agentDir, { recursive: true });

  // Write user's agent files
  for (const file of files) {
    const filePath = path.join(agentDir, file.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content, 'utf8');
  }

  // Copy SDK + wrapper into agent dir
  const sdkContent = await fs.readFile(SDK_PATH, 'utf8');
  await fs.writeFile(path.join(agentDir, 'buidlr-agent-sdk.js'), sdkContent, 'utf8');

  const wrapperContent = await fs.readFile(WRAPPER_PATH, 'utf8');
  await fs.writeFile(path.join(agentDir, 'buidlr-agent-wrapper.js'), wrapperContent, 'utf8');

  // Ensure package.json exists
  const pkgPath = path.join(agentDir, 'package.json');
  try {
    await fs.access(pkgPath);
  } catch {
    await fs.writeFile(pkgPath, JSON.stringify({
      name: 'buidlr-agent',
      version: '1.0.0',
      dependencies: {}
    }, null, 2), 'utf8');
  }

  // Generate a unique agent token for auth
  const agentToken = uuidv4();

  // Save token to DB
  await query('UPDATE agents SET agent_token = ? WHERE id = ?', [agentToken, agentId]);

  // Backend URL — use internal Docker network or host
  const backendUrl = `http://host.docker.internal:${config.PORT}`;

  // Create container
  const containerName = `buidlr-agent-${agentId}`;

  // Remove old container if exists
  try {
    const old = docker.getContainer(containerName);
    await old.stop().catch(() => {});
    await old.remove().catch(() => {});
  } catch (err) { /* doesn't exist */ }

  const container = await docker.createContainer({
    Image: 'node:20-alpine',
    name: containerName,
    WorkingDir: '/app',
    Cmd: ['sh', '-c', 'npm install --production 2>/dev/null; node buidlr-agent-wrapper.js'],
    Env: [
      `BUIDLR_BACKEND_URL=${backendUrl}`,
      `BUIDLR_AGENT_ID=${agentId}`,
      `BUIDLR_AGENT_TOKEN=${agentToken}`
    ],
    HostConfig: {
      Binds: [`${agentDir}:/app`],
      AutoRemove: false,
      RestartPolicy: { Name: 'unless-stopped' },
      Memory: 512 * 1024 * 1024, // 512MB for agents (lighter than app builder)
      CpuShares: 128,
      // Allow container to reach host (for backend API calls)
      ExtraHosts: ['host.docker.internal:host-gateway']
    },
    Labels: {
      'buidlr.agent': agentId,
      'buidlr.type': 'agent',
      'buidlr.created': new Date().toISOString()
    }
  });

  await container.start();

  // Update DB
  await query(
    "UPDATE agents SET container_id = ?, status = 'running', last_heartbeat = NOW() WHERE id = ?",
    [container.id, agentId]
  );

  return { containerId: container.id, status: 'running' };
}

/**
 * Stop an agent container (don't remove)
 */
async function stopAgent(agentId) {
  const agents = await query('SELECT container_id FROM agents WHERE id = ?', [agentId]);
  if (agents.length === 0 || !agents[0].container_id) {
    throw new Error('Agent has no container');
  }

  try {
    const container = docker.getContainer(agents[0].container_id);
    await container.stop();
  } catch (err) {
    if (!err.message.includes('not running') && !err.message.includes('No such container')) {
      throw err;
    }
  }

  await query("UPDATE agents SET status = 'paused' WHERE id = ?", [agentId]);
  return { status: 'paused' };
}

/**
 * Resume a paused agent
 */
async function resumeAgent(agentId) {
  const agents = await query('SELECT container_id FROM agents WHERE id = ?', [agentId]);
  if (agents.length === 0 || !agents[0].container_id) {
    throw new Error('Agent has no container');
  }

  try {
    const container = docker.getContainer(agents[0].container_id);
    await container.start();
  } catch (err) {
    if (err.message.includes('already started')) {
      // Already running
    } else if (err.message.includes('No such container')) {
      // Container was removed — need to redeploy
      throw new Error('Container no longer exists. Please redeploy the agent.');
    } else {
      throw err;
    }
  }

  await query("UPDATE agents SET status = 'running', last_heartbeat = NOW() WHERE id = ?", [agentId]);
  return { status: 'running' };
}

/**
 * Remove an agent permanently
 */
async function removeAgent(agentId) {
  const agents = await query('SELECT container_id FROM agents WHERE id = ?', [agentId]);

  if (agents[0]?.container_id) {
    try {
      const container = docker.getContainer(agents[0].container_id);
      await container.stop().catch(() => {});
      await container.remove().catch(() => {});
    } catch (err) { /* ignore */ }
  }

  // Remove agent files
  const agentDir = path.join(AGENTS_DIR, agentId);
  try {
    await fs.rm(agentDir, { recursive: true, force: true });
  } catch (err) { /* ignore */ }

  return { removed: true };
}

/**
 * Get recent logs from agent container (docker logs)
 */
async function getContainerLogs(containerId, tail = 50) {
  try {
    const container = docker.getContainer(containerId);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true
    });
    return logs.toString('utf8');
  } catch (err) {
    return '';
  }
}

/**
 * Process heartbeat — consume credits for runtime
 * Called by the agent SDK every 60 seconds
 * Returns { continue: true/false }
 */
async function processHeartbeat(agentId) {
  const agents = await query(
    'SELECT a.id, a.user_id, a.status, a.credit_limit, a.credits_consumed FROM agents a WHERE a.id = ?',
    [agentId]
  );

  if (agents.length === 0) return { continue: false };

  const agent = agents[0];

  // Check if agent should stop
  if (agent.status !== 'running') return { continue: false };

  // Consume runtime credits (1 credit per hour = 1/60 per minute)
  const creditPerMinute = (config.AGENT_CREDIT_PER_HOUR || 1) / 60;

  const creditsService = require('./credits');
  try {
    const balance = await creditsService.getBalance(agent.user_id);

    if (balance < creditPerMinute) {
      // Out of credits — pause agent
      await query("UPDATE agents SET status = 'paused' WHERE id = ?", [agentId]);
      return { continue: false, reason: 'insufficient_credits' };
    }

    // Check credit limit for this agent
    if (agent.credit_limit > 0 && (parseFloat(agent.credits_consumed) + creditPerMinute) > agent.credit_limit) {
      await query("UPDATE agents SET status = 'paused' WHERE id = ?", [agentId]);
      return { continue: false, reason: 'credit_limit_reached' };
    }

    // Deduct credits
    await creditsService.consumeCredits(agent.user_id, creditPerMinute * 1000 / config.CREDIT_COST_PER_1K_TOKENS * 1000);

    // Update agent stats
    await query(
      'UPDATE agents SET credits_consumed = credits_consumed + ?, last_heartbeat = NOW() WHERE id = ?',
      [creditPerMinute, agentId]
    );

    return { continue: true };
  } catch (err) {
    console.error('Heartbeat credit error:', err.message);
    return { continue: true }; // Don't stop on transient errors
  }
}

module.exports = {
  deployAgent,
  stopAgent,
  resumeAgent,
  removeAgent,
  getContainerLogs,
  processHeartbeat
};
