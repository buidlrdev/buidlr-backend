/**
 * Explore routes - Public app gallery endpoints (NO AUTH REQUIRED)
 */

const express = require('express');
const router = express.Router();
const { query } = require('../db');

/**
 * GET /api/explore
 * List public apps (paginated, searchable, sortable)
 * NO AUTH REQUIRED — this is a public endpoint
 * 
 * Query params:
 *   page (default 1)
 *   limit (default 12, max 50)
 *   search (optional, searches name + description)
 *   sort (optional: 'recent' | 'popular' | 'most_cloned', default 'recent')
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 12));
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const sort = req.query.sort || 'recent';

    let orderBy = 'pa.created_at DESC';
    if (sort === 'popular') orderBy = 'pa.clone_count DESC, pa.created_at DESC';
    if (sort === 'most_cloned') orderBy = 'pa.clone_count DESC';

    let whereClause = 'WHERE pa.is_public = TRUE';
    const params = [];

    if (search) {
      whereClause += ' AND (pa.name LIKE ? OR pa.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    // Get total count
    const countRows = await query(
      `SELECT COUNT(*) as total FROM published_apps pa ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    // Get apps
    const apps = await query(
      `SELECT pa.id, pa.name, pa.description, pa.preview_url, pa.tech_tags, 
              pa.clone_count, pa.created_at,
              u.id as creator_id, u.email as creator_email, u.wallet_address as creator_wallet
       FROM published_apps pa
       JOIN users u ON pa.user_id = u.id
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: {
        apps: apps.map(a => ({
          id: a.id,
          name: a.name,
          description: a.description,
          previewUrl: a.preview_url,
          techTags: a.tech_tags ? JSON.parse(a.tech_tags) : [],
          cloneCount: a.clone_count,
          createdAt: a.created_at,
          creator: {
            id: a.creator_id,
            email: a.creator_email,
            wallet: a.creator_wallet
          }
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Explore list error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/explore/:id
 * Get single published app detail with file list
 * NO AUTH REQUIRED
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const apps = await query(
      `SELECT pa.*, 
              u.id as creator_id, u.email as creator_email, u.wallet_address as creator_wallet,
              s.id as session_id
       FROM published_apps pa
       JOIN users u ON pa.user_id = u.id
       JOIN sessions s ON pa.session_id = s.id
       WHERE pa.id = ? AND pa.is_public = TRUE`,
      [id]
    );

    if (apps.length === 0) {
      return res.status(404).json({ success: false, error: 'App not found' });
    }

    const app = apps[0];

    // Get the latest assistant message with file_changes to show the app's files
    const messages = await query(
      `SELECT file_changes FROM chat_messages 
       WHERE session_id = ? AND role = 'assistant' AND file_changes IS NOT NULL
       ORDER BY created_at DESC`,
      [app.session_id]
    );

    // Merge all file changes — latest version of each file wins
    const fileMap = new Map();
    // Process oldest first so latest overwrites
    for (const msg of messages.reverse()) {
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

    res.json({
      success: true,
      data: {
        id: app.id,
        name: app.name,
        description: app.description,
        previewUrl: app.preview_url,
        techTags: app.tech_tags ? JSON.parse(app.tech_tags) : [],
        cloneCount: app.clone_count,
        createdAt: app.created_at,
        creator: {
          id: app.creator_id,
          email: app.creator_email,
          wallet: app.creator_wallet
        },
        files
      }
    });
  } catch (error) {
    console.error('Explore detail error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
