/**
 * Template routes - browse and use project templates
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const authMiddleware = require('../middleware/auth');

/**
 * GET /api/templates
 * List available templates (public, no auth)
 * Query: ?category=landing
 */
router.get('/', async (req, res) => {
  try {
    const category = req.query.category;
    let sql = 'SELECT id, name, description, category, tech_tags, preview_url, use_count FROM templates WHERE is_active = TRUE';
    const params = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    sql += ' ORDER BY use_count DESC';

    const templates = await query(sql, params);

    res.json({
      success: true,
      data: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        techTags: t.tech_tags ? JSON.parse(t.tech_tags) : [],
        previewUrl: t.preview_url,
        useCount: t.use_count
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/templates/:id
 * Get template detail with files (public, no auth)
 */
router.get('/:id', async (req, res) => {
  try {
    const templates = await query('SELECT * FROM templates WHERE id = ? AND is_active = TRUE', [req.params.id]);

    if (templates.length === 0) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    const t = templates[0];
    res.json({
      success: true,
      data: {
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        techTags: t.tech_tags ? JSON.parse(t.tech_tags) : [],
        files: JSON.parse(t.files),
        previewUrl: t.preview_url,
        useCount: t.use_count
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/templates/:id/use
 * Create a new session from a template (auth required)
 */
router.post('/:id/use', authMiddleware, async (req, res) => {
  try {
    const templates = await query('SELECT * FROM templates WHERE id = ? AND is_active = TRUE', [req.params.id]);

    if (templates.length === 0) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    const template = templates[0];
    const files = JSON.parse(template.files);

    // Create new session
    const sessionId = uuidv4();
    await query(
      'INSERT INTO sessions (id, user_id, name, status) VALUES (?, ?, ?, ?)',
      [sessionId, req.userId, `${template.name} project`, 'active']
    );

    // Insert user message
    const userMsgId = uuidv4();
    await query(
      'INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)',
      [userMsgId, sessionId, 'user', `Started from template: ${template.name}`]
    );

    // Insert assistant message with template files
    const assistantMsgId = uuidv4();
    const content = `Here's your project based on the "${template.name}" template with ${files.length} files.\n\n` +
      files.map(f => `<buidlr-file path="${f.path}" action="create">\n${f.content}\n</buidlr-file>`).join('\n\n');

    await query(
      'INSERT INTO chat_messages (id, session_id, role, content, file_changes) VALUES (?, ?, ?, ?, ?)',
      [assistantMsgId, sessionId, 'assistant', content, JSON.stringify(files)]
    );

    // Increment use count
    await query('UPDATE templates SET use_count = use_count + 1 WHERE id = ?', [req.params.id]);

    res.json({
      success: true,
      data: { sessionId, templateName: template.name, fileCount: files.length }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
