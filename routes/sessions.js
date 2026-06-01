/**
 * Sessions routes - chat session management
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const dockerService = require('../services/docker');
const containerManager = require('../services/container-manager');
const nginxService = require('../services/nginx');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * POST /api/sessions
 * Create a new session
 */
router.post('/', async (req, res) => {
  try {
    const { projectId, name, type } = req.body; // projectId optional, type = 'app' | 'agent'

    const sessionType = type === 'agent' ? 'agent' : 'app';

    // If projectId provided, verify it belongs to user
    if (projectId) {
      const projects = await query(
        'SELECT id FROM projects WHERE id = ? AND user_id = ?',
        [projectId, req.userId]
      );
      if (projects.length === 0) {
        return res.status(404).json({ success: false, error: 'Project not found' });
      }
    }

    const id = uuidv4();

    await query(
      'INSERT INTO sessions (id, user_id, project_id, name, type, status) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.userId, projectId || null, name || null, sessionType, 'active']
    );

    res.json({
      success: true,
      data: {
        id,
        type: sessionType,
        status: 'active'
      }
    });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sessions
 * List user's sessions
 */
router.get('/', async (req, res) => {
  try {
    const type = req.query.type || 'app'; // default to 'app' so app builder only sees app sessions

    const sessions = await query(
      `SELECT s.id, s.name, s.type, s.project_id, s.status, s.container_status, s.container_port, s.last_activity, s.created_at, p.name as project_name
       FROM sessions s
       LEFT JOIN projects p ON s.project_id = p.id
       WHERE s.user_id = ? AND s.type = ?
       ORDER BY s.last_activity DESC`,
      [req.userId, type]
    );

    res.json({
      success: true,
      data: sessions.map(s => ({
        id: s.id,
        name: s.name,
        type: s.type,
        projectId: s.project_id,
        projectName: s.project_name,
        status: s.status,
        containerStatus: s.container_status,
        containerPort: s.container_port,
        lastActivity: s.last_activity,
        createdAt: s.created_at
      }))
    });
  } catch (error) {
    console.error('List sessions error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sessions/:id
 * Get session with chat messages
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const sessions = await query(
      `SELECT s.id, s.name, s.project_id, s.status, s.container_id, s.container_port, s.container_status, s.last_activity, s.created_at, p.name as project_name
       FROM sessions s
       LEFT JOIN projects p ON s.project_id = p.id
       WHERE s.id = ? AND s.user_id = ?`,
      [id, req.userId]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const messages = await query(
      `SELECT id, role, content, file_changes, model, tokens_used, credits_consumed, created_at
       FROM chat_messages
       WHERE session_id = ?
       ORDER BY created_at ASC`,
      [id]
    );

    const s = sessions[0];

    // Get live container status if container exists
    let containerInfo = null;
    if (s.container_id) {
      try {
        containerInfo = await dockerService.getContainerStatus(s.container_id);
      } catch (err) {
        containerInfo = { status: 'unknown' };
      }
    }

    res.json({
      success: true,
      data: {
        id: s.id,
        name: s.name,
        projectId: s.project_id,
        projectName: s.project_name,
        status: s.status,
        containerId: s.container_id,
        containerPort: s.container_port,
        containerStatus: containerInfo,
        lastActivity: s.last_activity,
        createdAt: s.created_at,
        messages: messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          fileChanges: m.file_changes ? JSON.parse(m.file_changes) : null,
          model: m.model,
          tokensUsed: m.tokens_used,
          creditsConsumed: parseFloat(m.credits_consumed),
          createdAt: m.created_at
        }))
      }
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/sessions/:id
 * Rename a session
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }

    const result = await query(
      'UPDATE sessions SET name = ? WHERE id = ? AND user_id = ?',
      [name.trim().slice(0, 150), id, req.userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    res.json({ success: true, data: { name: name.trim() } });
  } catch (error) {
    console.error('Rename session error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/sessions/:id
 * Stop a session (container kept, not removed)
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get session to find container_id
    const sessions = await query(
      'SELECT container_id FROM sessions WHERE id = ? AND user_id = ?',
      [id, req.userId]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    // Stop container if exists (don't remove)
    if (sessions[0].container_id) {
      try {
        await dockerService.stopContainer(sessions[0].container_id);
      } catch (err) {
        console.error('Failed to stop container:', err.message);
      }
    }

    await query(
      "UPDATE sessions SET status = 'stopped', container_status = 'stopped' WHERE id = ? AND user_id = ?",
      [id, req.userId]
    );

    res.json({ success: true, data: { status: 'stopped' } });
  } catch (error) {
    console.error('Stop session error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sessions/:id/resume
 * Resume a stopped session — restart its container
 */
router.post('/:id/resume', async (req, res) => {
  try {
    const { id } = req.params;

    const sessions = await query(
      'SELECT id, container_id, container_status FROM sessions WHERE id = ? AND user_id = ?',
      [id, req.userId]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const session = sessions[0];

    if (!session.container_id) {
      return res.status(400).json({ success: false, error: 'No container associated with this session' });
    }

    const containerInfo = await dockerService.restartContainer(session.container_id);

    // Update session with new port
    await query(
      "UPDATE sessions SET status = 'active', container_status = 'running', container_port = ?, last_activity = NOW() WHERE id = ?",
      [containerInfo.port, id]
    );

    // Regenerate Nginx config with new port
    try {
      const config = require('../config');
      const nginxConfig = nginxService.generatePreviewConfig(id, containerInfo.port);
      const configPath = `/etc/nginx/sites-available/buidlr-preview-${id}`;
      const enabledPath = `/etc/nginx/sites-enabled/buidlr-preview-${id}`;

      await fs.writeFile(configPath, nginxConfig, 'utf8');

      // Ensure symlink exists
      try { await fs.unlink(enabledPath); } catch (err) {}
      await fs.symlink(configPath, enabledPath);

      // Reload Nginx
      await execAsync('nginx -s reload');
    } catch (nginxErr) {
      console.error('Failed to update Nginx config:', nginxErr.message);
      // Non-fatal - container is still accessible via direct port
    }

    res.json({
      success: true,
      data: {
        status: 'active',
        containerStatus: 'running',
        port: containerInfo.port
      }
    });
  } catch (error) {
    console.error('Resume session error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/sessions/:id/destroy
 * Permanently delete a session and remove its container
 */
router.delete('/:id/destroy', async (req, res) => {
  try {
    const { id } = req.params;

    const sessions = await query(
      'SELECT container_id FROM sessions WHERE id = ? AND user_id = ?',
      [id, req.userId]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    // Remove container permanently if exists
    if (sessions[0].container_id) {
      try {
        await dockerService.removeContainer(sessions[0].container_id);
      } catch (err) {
        console.error('Failed to remove container:', err.message);
      }
    }

    // Clean up project files
    try {
      await containerManager.removeProjectFiles(id);
    } catch (err) {
      console.error('Failed to remove project files:', err.message);
    }

    // Clean up Nginx preview config
    try {
      await containerManager.removeNginxPreview(id);
    } catch (err) {
      console.error('Failed to remove Nginx config:', err.message);
    }

    // Delete session and all its messages (CASCADE handles messages)
    await query('DELETE FROM sessions WHERE id = ? AND user_id = ?', [id, req.userId]);

    res.json({ success: true, data: { destroyed: true } });
  } catch (error) {
    console.error('Destroy session error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sessions/:id/files
 * Save a file to the session's project directory
 * Body: { path: "src/App.jsx", content: "..." }
 */
router.post('/:id/files', async (req, res) => {
  try {
    const { id } = req.params;
    const { path: filePath, content } = req.body;

    if (!filePath || content === undefined) {
      return res.status(400).json({ success: false, error: 'path and content are required' });
    }

    // Verify session belongs to user
    const sessions = await query(
      'SELECT id, container_id FROM sessions WHERE id = ? AND user_id = ?',
      [id, req.userId]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    // Sanitize file path — prevent directory traversal
    const path = require('path');
    const safePath = filePath.replace(/\.\./g, '').replace(/^\//, '');
    const projectDir = path.join('/var/www/buidlr/projects', id);
    const fullPath = path.join(projectDir, safePath);

    if (!fullPath.startsWith(projectDir)) {
      return res.status(400).json({ success: false, error: 'Invalid file path' });
    }

    // Create directory if needed
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Write the file
    await fs.writeFile(fullPath, content, 'utf8');

    // Save as chat message so file tree stays in sync
    const msgId = uuidv4();
    const fileChange = [{ path: safePath, action: 'update', content }];

    await query(
      'INSERT INTO chat_messages (id, session_id, role, content, file_changes) VALUES (?, ?, ?, ?, ?)',
      [msgId, id, 'assistant', `File manually edited: ${safePath}`, JSON.stringify(fileChange)]
    );

    res.json({ success: true, data: { path: safePath, saved: true } });
  } catch (error) {
    console.error('Save file error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
