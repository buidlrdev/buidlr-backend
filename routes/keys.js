/**
 * Keys routes - API key management endpoints
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { encrypt } = require('../services/encryption');

/**
 * GET /api/keys
 * List all user's API keys (masked)
 */
router.get('/', async (req, res) => {
  try {
    const keys = await query(
      `SELECT id, provider, label, is_default, created_at, key_hint 
       FROM ai_keys 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [req.userId]
    );

    res.json({
      success: true,
      data: keys.map(key => ({
        id: key.id,
        provider: key.provider,
        label: key.label,
        isDefault: !!key.is_default,
        maskedKey: '****' + (key.key_hint || '????'),
        createdAt: key.created_at
      }))
    });
  } catch (error) {
    console.error('Get keys error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/keys
 * Add a new API key
 */
router.post('/', async (req, res) => {
  try {
    const { provider, apiKey, label } = req.body;

    if (!provider || !apiKey) {
      return res.status(400).json({ success: false, error: 'provider and apiKey are required' });
    }

    const validProviders = ['anthropic', 'openai', 'gemini', 'deepseek', 'groq'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ success: false, error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` });
    }

    const id = uuidv4();
    const encryptedKey = encrypt(apiKey);
    const keyHint = apiKey.slice(-4); // Store last 4 chars of plaintext for display

    await query(
      `INSERT INTO ai_keys (id, user_id, provider, encrypted_key, key_hint, label) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.userId, provider, encryptedKey, keyHint, label || null]
    );

    res.json({
      success: true,
      data: {
        id,
        provider,
        label: label || null,
        isDefault: false,
        createdAt: new Date()
      }
    });
  } catch (error) {
    console.error('Add key error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/keys/:id
 * Delete an API key
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM ai_keys WHERE id = ? AND user_id = ?',
      [id, req.userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Key not found' });
    }

    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    console.error('Delete key error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/keys/:id/default
 * Set a key as default for its provider
 */
router.post('/:id/default', async (req, res) => {
  try {
    const { id } = req.params;

    // Get the key to find its provider
    const keys = await query(
      'SELECT provider FROM ai_keys WHERE id = ? AND user_id = ?',
      [id, req.userId]
    );

    if (keys.length === 0) {
      return res.status(404).json({ success: false, error: 'Key not found' });
    }

    const { provider } = keys[0];

    // Unset all defaults for this provider
    await query(
      'UPDATE ai_keys SET is_default = FALSE WHERE user_id = ? AND provider = ?',
      [req.userId, provider]
    );

    // Set this key as default
    await query(
      'UPDATE ai_keys SET is_default = TRUE WHERE id = ?',
      [id]
    );

    res.json({ success: true, data: { isDefault: true } });
  } catch (error) {
    console.error('Set default key error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
