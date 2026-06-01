/**
 * Agent routes — CRUD, deploy, pause, resume, logs, heartbeat, transactions
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const agentRunner = require('../services/agent-runner');
const authMiddleware = require('../middleware/auth');

/**
 * POST /api/agents
 * Create an agent from a session (draft — not deployed yet)
 * Body: { sessionId, name, description?, config?, creditLimit? }
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { sessionId, name, description, config: agentConfig, creditLimit } = req.body;

    if (!sessionId || !name) {
      return res.status(400).json({ success: false, error: 'sessionId and name are required' });
    }

    // Verify session belongs to user
    const sessions = await query(
      'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
      [sessionId, req.userId]
    );
    if (sessions.length === 0) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const id = uuidv4();
    await query(
      `INSERT INTO agents (id, user_id, session_id, name, description, config, credit_limit) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, req.userId, sessionId, name, description || null, agentConfig ? JSON.stringify(agentConfig) : null, creditLimit || 0]
    );

    res.json({
      success: true,
      data: { id, name, status: 'draft' }
    });
  } catch (error) {
    console.error('Create agent error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agents
 * List user's agents
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const agents = await query(
      `SELECT id, name, description, status, config, credits_consumed, credit_limit, 
              total_spent, last_heartbeat, created_at
       FROM agents WHERE user_id = ? ORDER BY created_at DESC`,
      [req.userId]
    );

    res.json({
      success: true,
      data: agents.map(a => ({
        id: a.id,
        name: a.name,
        description: a.description,
        status: a.status,
        config: a.config ? JSON.parse(a.config) : null,
        creditsConsumed: parseFloat(a.credits_consumed),
        creditLimit: parseFloat(a.credit_limit),
        totalSpent: parseFloat(a.total_spent),
        lastHeartbeat: a.last_heartbeat,
        createdAt: a.created_at
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agents/:id
 * Agent detail + recent logs + recent transactions
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const agents = await query(
      'SELECT * FROM agents WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (agents.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const agent = agents[0];

    // Get recent logs
    const logs = await query(
      'SELECT id, level, message, tx_hash, data, created_at FROM agent_logs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 100',
      [agent.id]
    );

    // Get recent transactions
    const transactions = await query(
      'SELECT id, tx_hash, type, amount, token, status, created_at FROM agent_transactions WHERE agent_id = ? ORDER BY created_at DESC LIMIT 50',
      [agent.id]
    );

    res.json({
      success: true,
      data: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        status: agent.status,
        config: agent.config ? JSON.parse(agent.config) : null,
        sessionId: agent.session_id,
        creditsConsumed: parseFloat(agent.credits_consumed),
        creditLimit: parseFloat(agent.credit_limit),
        totalSpent: parseFloat(agent.total_spent),
        lastHeartbeat: agent.last_heartbeat,
        createdAt: agent.created_at,
        logs: logs.map(l => ({
          id: l.id,
          level: l.level,
          message: l.message,
          txHash: l.tx_hash,
          data: l.data ? JSON.parse(l.data) : null,
          createdAt: l.created_at
        })),
        transactions: transactions.map(t => ({
          id: t.id,
          txHash: t.tx_hash,
          type: t.type,
          amount: t.amount ? parseFloat(t.amount) : null,
          token: t.token,
          status: t.status,
          createdAt: t.created_at
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/agents/:id/deploy
 * Deploy agent — start the container
 */
router.post('/:id/deploy', authMiddleware, async (req, res) => {
  try {
    const agents = await query(
      'SELECT id, session_id, status FROM agents WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (agents.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const agent = agents[0];
    if (agent.status === 'running') {
      return res.status(400).json({ success: false, error: 'Agent is already running' });
    }

    if (!agent.session_id) {
      return res.status(400).json({ success: false, error: 'No session linked to this agent' });
    }

    const result = await agentRunner.deployAgent(agent.id, agent.session_id);

    res.json({
      success: true,
      data: { status: result.status, containerId: result.containerId }
    });
  } catch (error) {
    console.error('Deploy agent error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/agents/:id/pause
 * Pause agent — stop container but keep data
 */
router.post('/:id/pause', authMiddleware, async (req, res) => {
  try {
    const agents = await query(
      'SELECT id FROM agents WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (agents.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const result = await agentRunner.stopAgent(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/agents/:id/resume
 * Resume a paused agent
 */
router.post('/:id/resume', authMiddleware, async (req, res) => {
  try {
    const agents = await query(
      'SELECT id FROM agents WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (agents.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const result = await agentRunner.resumeAgent(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/agents/:id
 * Stop + remove agent permanently
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const agents = await query(
      'SELECT id FROM agents WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (agents.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    await agentRunner.removeAgent(req.params.id);
    await query('DELETE FROM agents WHERE id = ?', [req.params.id]);

    res.json({ success: true, data: { removed: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/agents/:id/config
 * Update agent config
 * Body: { config: { ... } }
 */
router.patch('/:id/config', authMiddleware, async (req, res) => {
  try {
    const { config: agentConfig, creditLimit } = req.body;

    const updates = [];
    const params = [];

    if (agentConfig !== undefined) {
      updates.push('config = ?');
      params.push(JSON.stringify(agentConfig));
    }
    if (creditLimit !== undefined) {
      updates.push('credit_limit = ?');
      params.push(creditLimit);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }

    params.push(req.params.id, req.userId);
    await query(
      `UPDATE agents SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );

    res.json({ success: true, data: { updated: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agents/:id/logs
 * Get paginated agent logs
 * Query: ?limit=50&before=timestamp
 */
router.get('/:id/logs', authMiddleware, async (req, res) => {
  try {
    // Verify ownership
    const agents = await query('SELECT id FROM agents WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (agents.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const before = req.query.before;

    let sql = 'SELECT id, level, message, tx_hash, data, created_at FROM agent_logs WHERE agent_id = ?';
    const params = [req.params.id];

    if (before) {
      sql += ' AND created_at < ?';
      params.push(before);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const logs = await query(sql, params);

    res.json({
      success: true,
      data: logs.map(l => ({
        id: l.id,
        level: l.level,
        message: l.message,
        txHash: l.tx_hash,
        data: l.data ? JSON.parse(l.data) : null,
        createdAt: l.created_at
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agents/:id/transactions
 * Get agent's on-chain transactions
 */
router.get('/:id/transactions', authMiddleware, async (req, res) => {
  try {
    const agents = await query('SELECT id FROM agents WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (agents.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const transactions = await query(
      'SELECT * FROM agent_transactions WHERE agent_id = ? ORDER BY created_at DESC LIMIT 100',
      [req.params.id]
    );

    res.json({
      success: true,
      data: transactions.map(t => ({
        id: t.id,
        txHash: t.tx_hash,
        type: t.type,
        amount: t.amount ? parseFloat(t.amount) : null,
        token: t.token,
        status: t.status,
        data: t.data ? JSON.parse(t.data) : null,
        createdAt: t.created_at
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// INTERNAL ENDPOINTS — called by agent SDK (auth via X-Agent-Token)
// ============================================================

/**
 * Middleware to verify agent token (not user auth)
 */
function verifyAgentToken(req, res, next) {
  const token = req.headers['x-agent-token'];
  const agentId = req.params.id;

  if (!token || !agentId) {
    return res.status(401).json({ success: false, error: 'Missing agent token' });
  }

  // We'll verify token in the handler (check against DB)
  req.agentToken = token;
  next();
}

/**
 * POST /api/agents/:id/log (INTERNAL — from agent SDK)
 * Body: { level, message, data? }
 */
router.post('/:id/log', verifyAgentToken, async (req, res) => {
  try {
    const { level, message, data } = req.body;

    // Verify agent token
    const agents = await query(
      'SELECT id, user_id FROM agents WHERE id = ? AND agent_token = ?',
      [req.params.id, req.agentToken]
    );
    if (agents.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid agent token' });
    }

    const id = uuidv4();
    await query(
      'INSERT INTO agent_logs (id, agent_id, level, message, data) VALUES (?, ?, ?, ?, ?)',
      [id, req.params.id, level || 'info', message || '', data ? JSON.stringify(data) : null]
    );

    // Broadcast to connected WebSocket clients watching this agent
    if (global.agentLogBroadcast) {
      global.agentLogBroadcast(req.params.id, {
        type: 'agent_log',
        agentId: req.params.id,
        level: level || 'info',
        message: message || '',
        data,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/agents/:id/tx (INTERNAL — from agent SDK)
 * Body: { txHash, type, amount?, token? }
 */
router.post('/:id/tx', verifyAgentToken, async (req, res) => {
  try {
    const { txHash, type, amount, token } = req.body;

    const agents = await query(
      'SELECT id, user_id FROM agents WHERE id = ? AND agent_token = ?',
      [req.params.id, req.agentToken]
    );
    if (agents.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid agent token' });
    }

    const id = uuidv4();
    await query(
      'INSERT INTO agent_transactions (id, agent_id, tx_hash, type, amount, token) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.params.id, txHash, type || 'unknown', amount || 0, token || 'ETH']
    );

    // Update total_spent
    if (amount) {
      await query(
        'UPDATE agents SET total_spent = total_spent + ? WHERE id = ?',
        [Math.abs(amount), req.params.id]
      );
    }

    // Consume extra credits for on-chain transaction
    const config = require('../config');
    const txCreditCost = config.AGENT_CREDIT_PER_TX || 5;
    const creditsService = require('../services/credits');
    try {
      await creditsService.consumeCredits(agents[0].user_id, txCreditCost * 1000 / config.CREDIT_COST_PER_1K_TOKENS * 1000);
      await query(
        'UPDATE agents SET credits_consumed = credits_consumed + ? WHERE id = ?',
        [txCreditCost, req.params.id]
      );
    } catch (err) {
      // Credit deduction failed — log but don't block
      console.error('Agent tx credit error:', err.message);
    }

    // Broadcast to WebSocket
    if (global.agentLogBroadcast) {
      global.agentLogBroadcast(req.params.id, {
        type: 'agent_log',
        agentId: req.params.id,
        level: 'trade',
        message: `Transaction: ${type} ${amount || ''} ${token || 'ETH'}`,
        txHash,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/agents/:id/heartbeat (INTERNAL — from agent SDK)
 */
router.post('/:id/heartbeat', verifyAgentToken, async (req, res) => {
  try {
    const agents = await query(
      'SELECT id FROM agents WHERE id = ? AND agent_token = ?',
      [req.params.id, req.agentToken]
    );
    if (agents.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid agent token' });
    }

    const result = await agentRunner.processHeartbeat(req.params.id);

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agents/:id/status (INTERNAL — from agent SDK)
 */
router.get('/:id/status', verifyAgentToken, async (req, res) => {
  try {
    const agents = await query(
      'SELECT status FROM agents WHERE id = ? AND agent_token = ?',
      [req.params.id, req.agentToken]
    );
    if (agents.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid agent token' });
    }

    res.json({ success: true, data: { status: agents[0].status } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
