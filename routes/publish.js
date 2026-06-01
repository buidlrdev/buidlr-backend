/**
 * Publish routes - Publish, unpublish, clone apps (AUTH REQUIRED)
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const containerManager = require('../services/container-manager');
const nginxService = require('../services/nginx');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const config = require('../config');

/**
 * GET /api/publish/my
 * List current user's published apps
 */
router.get('/my', async (req, res) => {
  try {
    const apps = await query(
      `SELECT id, session_id, name, description, tech_tags, clone_count, is_public, created_at
       FROM published_apps
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [req.userId]
    );

    res.json({
      success: true,
      data: apps.map(a => ({
        id: a.id,
        sessionId: a.session_id,
        name: a.name,
        description: a.description,
        techTags: a.tech_tags ? JSON.parse(a.tech_tags) : [],
        cloneCount: a.clone_count,
        isPublic: !!a.is_public,
        createdAt: a.created_at
      }))
    });
  } catch (error) {
    console.error('My published apps error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/publish
 * Publish a session to the explore gallery
 * Body: { sessionId, name, description?, techTags? }
 */
router.post('/', async (req, res) => {
  try {
    const { sessionId, name, description, techTags } = req.body;

    if (!sessionId || !name) {
      return res.status(400).json({ success: false, error: 'sessionId and name are required' });
    }

    // Verify session belongs to user
    const sessions = await query(
      'SELECT id, container_id, container_port FROM sessions WHERE id = ? AND user_id = ?',
      [sessionId, req.userId]
    );

    if (sessions.length === 0) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    // Build static version
    let previewUrl = null;
    try {
      const staticDir = await containerManager.buildStaticVersion(sessionId);

      // Generate Nginx config for static serving
      // Use a short ID for a cleaner URL
      const appId = uuidv4().slice(0, 8);
      const nginxConfig = nginxService.generateStaticPreviewConfig(appId, staticDir);
      const configPath = `/etc/nginx/sites-available/buidlr-static-${appId}`;
      const enabledPath = `/etc/nginx/sites-enabled/buidlr-static-${appId}`;

      await fs.writeFile(configPath, nginxConfig, 'utf8');
      try { await fs.unlink(enabledPath); } catch {}
      await fs.symlink(configPath, enabledPath);
      await execAsync('nginx -s reload');

      previewUrl = `https://${appId}.${config.PREVIEW_DOMAIN}`;
    } catch (buildErr) {
      console.error('Static build failed:', buildErr.message);
      // Non-fatal — app gets published but without a permanent preview
      // The session's container preview URL can still be used if running
      previewUrl = sessions[0].container_port
        ? `https://${sessionId}.${config.PREVIEW_DOMAIN}`
        : null;
    }

    // Check if already published
    const existing = await query(
      'SELECT id FROM published_apps WHERE session_id = ?',
      [sessionId]
    );

    if (existing.length > 0) {
      // Update existing publication
      await query(
        'UPDATE published_apps SET name = ?, description = ?, tech_tags = ?, preview_url = ?, is_public = TRUE WHERE session_id = ?',
        [name, description || null, techTags ? JSON.stringify(techTags) : null, previewUrl, sessionId]
      );

      return res.json({
        success: true,
        data: { id: existing[0].id, updated: true, previewUrl }
      });
    }

    const id = uuidv4();

    await query(
      `INSERT INTO published_apps (id, session_id, user_id, name, description, tech_tags, preview_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, sessionId, req.userId, name, description || null, techTags ? JSON.stringify(techTags) : null, previewUrl]
    );

    res.json({
      success: true,
      data: { id, published: true, previewUrl }
    });
  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/publish/:id
 * Unpublish an app (set is_public = false)
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'UPDATE published_apps SET is_public = FALSE WHERE id = ? AND user_id = ?',
      [id, req.userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Published app not found' });
    }

    res.json({ success: true, data: { unpublished: true } });
  } catch (error) {
    console.error('Unpublish error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/publish/:id/clone
 * Clone a published app into the user's own session
 * Creates a new session and copies all file changes as the first assistant message
 */
router.post('/:id/clone', async (req, res) => {
  try {
    const { id } = req.params;

    // Get published app
    const apps = await query(
      'SELECT pa.session_id, pa.name FROM published_apps pa WHERE pa.id = ? AND pa.is_public = TRUE',
      [id]
    );

    if (apps.length === 0) {
      return res.status(404).json({ success: false, error: 'App not found' });
    }

    const app = apps[0];

    // Get all file changes from the original session (merged, latest wins)
    const messages = await query(
      `SELECT file_changes FROM chat_messages 
       WHERE session_id = ? AND role = 'assistant' AND file_changes IS NOT NULL
       ORDER BY created_at ASC`,
      [app.session_id]
    );

    const fileMap = new Map();
    for (const msg of messages) {
      const changes = JSON.parse(msg.file_changes);
      for (const file of changes) {
        if (file.action === 'delete') {
          fileMap.delete(file.path);
        } else {
          fileMap.set(file.path, file);
        }
      }
    }

    const files = Array.from(fileMap.values());

    // Create new session for the cloning user
    const sessionId = uuidv4();
    await query(
      'INSERT INTO sessions (id, user_id, status) VALUES (?, ?, ?)',
      [sessionId, req.userId, 'active']
    );

    // Insert a user message saying what was cloned
    const userMsgId = uuidv4();
    await query(
      'INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)',
      [userMsgId, sessionId, 'user', `Cloned from "${app.name}"`]
    );

    // Insert an assistant message with all the cloned files
    const assistantMsgId = uuidv4();
    const clonedContent = `Cloned project "${app.name}" with ${files.length} files.\n\n` +
      files.map(f => `<buidlr-file path="${f.path}" action="create">\n${f.content}\n</buidlr-file>`).join('\n\n');

    await query(
      `INSERT INTO chat_messages (id, session_id, role, content, file_changes) VALUES (?, ?, ?, ?, ?)`,
      [assistantMsgId, sessionId, 'assistant', clonedContent, JSON.stringify(files)]
    );

    // Increment clone count
    await query(
      'UPDATE published_apps SET clone_count = clone_count + 1 WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      data: {
        sessionId,
        clonedFiles: files.length,
        appName: app.name
      }
    });
  } catch (error) {
    console.error('Clone error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/publish/:id/domain
 * Set a custom domain for a published app
 * Body: { domain: "myapp.com" }
 */
router.post('/:id/domain', async (req, res) => {
  try {
    const { id } = req.params;
    const { domain } = req.body;

    if (!domain || !domain.trim()) {
      return res.status(400).json({ success: false, error: 'Domain is required' });
    }

    const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');

    const domainRegex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/;
    if (!domainRegex.test(cleanDomain)) {
      return res.status(400).json({ success: false, error: 'Invalid domain format' });
    }

    // Check if domain already used
    const existing = await query(
      'SELECT id FROM published_apps WHERE custom_domain = ? AND id != ?',
      [cleanDomain, id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, error: 'Domain already in use by another app' });
    }

    // Verify app belongs to user
    const apps = await query(
      'SELECT id, session_id FROM published_apps WHERE id = ? AND user_id = ?',
      [id, req.userId]
    );
    if (apps.length === 0) {
      return res.status(404).json({ success: false, error: 'App not found' });
    }

    await query('UPDATE published_apps SET custom_domain = ? WHERE id = ?', [cleanDomain, id]);

    // Generate Nginx config for custom domain
    const staticDir = `/var/www/buidlr/static/${apps[0].session_id}`;
    let hasStaticBuild = false;
    try {
      await fs.access(staticDir);
      hasStaticBuild = true;
    } catch {}

    if (hasStaticBuild) {
      const nginxConfig = nginxService.generateCustomDomainConfig(cleanDomain, staticDir);
      const configName = `buidlr-domain-${cleanDomain.replace(/\./g, '-')}`;
      const configPath = `/etc/nginx/sites-available/${configName}`;
      const enabledPath = `/etc/nginx/sites-enabled/${configName}`;

      await fs.writeFile(configPath, nginxConfig, 'utf8');
      try { await fs.unlink(enabledPath); } catch {}
      await fs.symlink(configPath, enabledPath);
      await execAsync('nginx -s reload');
    }

    res.json({
      success: true,
      data: {
        domain: cleanDomain,
        status: 'pending_dns',
        instructions: {
          type: 'A',
          name: cleanDomain,
          value: '187.127.88.13',
          note: 'Point your domain A record to this IP. Then click Setup SSL after DNS propagates.'
        }
      }
    });
  } catch (error) {
    console.error('Set domain error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/publish/:id/domain/ssl
 * Request SSL certificate for custom domain
 */
router.post('/:id/domain/ssl', async (req, res) => {
  try {
    const apps = await query(
      'SELECT custom_domain, session_id FROM published_apps WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );

    if (apps.length === 0 || !apps[0].custom_domain) {
      return res.status(404).json({ success: false, error: 'No custom domain set' });
    }

    const domain = apps[0].custom_domain;

    try {
      await execAsync(`certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@buidlr.dev`);
      res.json({ success: true, data: { domain, ssl: true, url: `https://${domain}` } });
    } catch (certErr) {
      res.status(400).json({
        success: false,
        error: 'SSL setup failed. Make sure your domain DNS is pointed to 187.127.88.13 and has propagated.'
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/publish/:id/domain
 * Remove custom domain
 */
router.delete('/:id/domain', async (req, res) => {
  try {
    const apps = await query(
      'SELECT custom_domain FROM published_apps WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );

    if (apps.length === 0 || !apps[0].custom_domain) {
      return res.status(404).json({ success: false, error: 'No custom domain set' });
    }

    const domain = apps[0].custom_domain;
    const configName = `buidlr-domain-${domain.replace(/\./g, '-')}`;

    try {
      await fs.unlink(`/etc/nginx/sites-enabled/${configName}`);
      await fs.unlink(`/etc/nginx/sites-available/${configName}`);
      await execAsync('nginx -s reload');
    } catch {}

    await query('UPDATE published_apps SET custom_domain = NULL WHERE id = ?', [req.params.id]);

    res.json({ success: true, data: { removed: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
