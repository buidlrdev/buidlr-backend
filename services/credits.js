/**
 * Credits service - manage user credits and transactions
 */

const { query, pool } = require('../db');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

/**
 * Get user's current credit balance
 * @param {string} userId - User ID
 * @returns {Promise<number>} - Credit balance
 */
async function getBalance(userId) {
  const rows = await query('SELECT credits FROM users WHERE id = ?', [userId]);
  if (rows.length === 0) {
    throw new Error('User not found');
  }
  return parseFloat(rows[0].credits);
}

/**
 * Consume credits for token usage
 * Uses transaction with row locking to prevent race conditions
 * @param {string} userId - User ID
 * @param {number} tokensUsed - Number of tokens used
 * @returns {Promise<{cost: number, newBalance: number}>}
 */
async function consumeCredits(userId, tokensUsed) {
  const cost = (tokensUsed / 1000) * config.CREDIT_COST_PER_1K_TOKENS;
  
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    // Lock the user row to prevent concurrent modifications
    const [rows] = await conn.execute(
      'SELECT credits FROM users WHERE id = ? FOR UPDATE',
      [userId]
    );
    
    if (rows.length === 0) throw new Error('User not found');
    
    const balance = parseFloat(rows[0].credits);
    if (balance < cost) throw new Error('Insufficient credits');
    
    await conn.execute(
      'UPDATE users SET credits = credits - ? WHERE id = ?',
      [cost, userId]
    );
    
    await conn.execute(
      'INSERT INTO credit_transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), userId, 'consume', cost, `Token usage: ${tokensUsed} tokens`]
    );
    
    await conn.commit();
    
    const newBalance = balance - cost;
    return { cost, newBalance };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Add credits from ETH purchase
 * @param {string} userId - User ID
 * @param {number} ethAmount - Amount of ETH sent
 * @param {string} txHash - Transaction hash
 * @returns {Promise<{creditsAdded: number, newBalance: number}>}
 */
async function addCredits(userId, ethAmount, txHash) {
  const creditsAdded = ethAmount * config.CREDIT_RATE_PER_ETH;
  
  // Add credits
  await query('UPDATE users SET credits = credits + ? WHERE id = ?', [creditsAdded, userId]);
  
  // Record transaction
  await query(
    'INSERT INTO credit_transactions (id, user_id, type, amount, tx_hash, description) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), userId, 'purchase', creditsAdded, txHash, `ETH purchase: ${ethAmount} ETH`]
  );
  
  // Get new balance
  const newBalance = await getBalance(userId);
  
  return { creditsAdded, newBalance };
}

module.exports = {
  getBalance,
  consumeCredits,
  addCredits
};
