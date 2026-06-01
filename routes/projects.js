/**
 * Projects routes - project management endpoints
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { encrypt } = require('../services/encryption');

/**
 * POST /api/projects
 * Create a new project
 */
router.post('/', async (req, res) => {
  try {
    const { name, repoUrl, githubPat } = req.body;

    if (!name || !repoUrl || !githubPat) {
      return res.status(400).json({ success: false, error: 'name, repoUrl, and githubPat are required' });
    }

    const id = uuidv4();
    const encryptedPat = encrypt(githubPat);

    await query(
      'INSERT INTO projects (id, user_id, name, repo_url, encrypted_pat) VALUES (?, ?, ?, ?, ?)',
      [id, req.userId, name, repoUrl, encryptedPat]
    );

    res.json({
      success: true,
      data: {
        id,
        name,
        repoUrl,
        createdAt: new Date()
      }
    });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects
 * List user's projects
 */
router.get('/', async (req, res) => {
  try {
    const projects = await query(
      'SELECT id, name, repo_url, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]
    );

    res.json({
      success: true,
      data: projects.map(p => ({
        id: p.id,
        name: p.name,
        repoUrl: p.repo_url,
        createdAt: p.created_at
      }))
    });
  } catch (error) {
    console.error('List projects error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects/:id
 * Get a single project
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const projects = await query(
      'SELECT id, name, repo_url, created_at FROM projects WHERE id = ? AND user_id = ?',
      [id, req.userId]
    );

    if (projects.length === 0) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    const p = projects[0];
    res.json({
      success: true,
      data: {
        id: p.id,
        name: p.name,
        repoUrl: p.repo_url,
        createdAt: p.created_at
      }
    });
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/projects/:id
 * Delete a project
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM projects WHERE id = ? AND user_id = ?',
      [id, req.userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
