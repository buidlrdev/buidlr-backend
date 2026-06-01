/**
 * Authentication middleware - Privy token verification
 */

const { PrivyClient } = require('@privy-io/server-auth');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const config = require('../config');

// Initialize Privy client
const privy = new PrivyClient(config.PRIVY_APP_ID, config.PRIVY_APP_SECRET);

/**
 * Authentication middleware
 * Verifies Privy token and attaches user to request
 */
async function authMiddleware(req, res, next) {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Missing authorization token' });
    }

    const token = authHeader.substring(7);

    // Verify token with Privy
    const verifiedClaims = await privy.verifyAuthToken(token);
    const privyId = verifiedClaims.userId;

    // Look up user in database
    let users = await query('SELECT * FROM users WHERE privy_id = ?', [privyId]);

    // Auto-create user if not found
    if (users.length === 0) {
      const userId = uuidv4();
      try {
        await query(
          'INSERT IGNORE INTO users (id, privy_id, email, wallet_address) VALUES (?, ?, ?, ?)',
          [userId, privyId, verifiedClaims.email || null, verifiedClaims.wallet?.address || null]
        );
      } catch (err) {
        // Ignore duplicate errors
      }
      // Always re-fetch (whether we inserted or another request did)
      users = await query('SELECT * FROM users WHERE privy_id = ?', [privyId]);
    }

    const user = users[0];

    // Attach user info to request
    req.userId = user.id;
    req.user = user;

    next();
  } catch (error) {
    console.error('Auth error:', error.message);
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

/**
 * Verify token and return user info (for WebSocket auth)
 * @param {string} token - Privy auth token
 * @returns {Promise<Object>} - User object
 */
async function verifyToken(token) {
  const verifiedClaims = await privy.verifyAuthToken(token);
  const privyId = verifiedClaims.userId;

  let users = await query('SELECT * FROM users WHERE privy_id = ?', [privyId]);

  if (users.length === 0) {
    const userId = uuidv4();
    try {
      await query(
        'INSERT IGNORE INTO users (id, privy_id, email, wallet_address) VALUES (?, ?, ?, ?)',
        [userId, privyId, verifiedClaims.email || null, verifiedClaims.wallet?.address || null]
      );
    } catch (err) {
      // Ignore duplicate errors
    }
    // Always re-fetch (whether we inserted or another request did)
    users = await query('SELECT * FROM users WHERE privy_id = ?', [privyId]);
  }

  return users[0];
}

module.exports = authMiddleware;
module.exports.verifyToken = verifyToken;
