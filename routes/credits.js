/**
 * Credits routes - balance and purchase endpoints
 */

const express = require('express');
const router = express.Router();
const { query } = require('../db');
const creditsService = require('../services/credits');
const config = require('../config');
const { getChainConfig } = require('../config');

/**
 * GET /api/credits
 * Get user's credit balance and recent transactions
 */
router.get('/', async (req, res) => {
  try {
    const balance = await creditsService.getBalance(req.userId);
    
    const transactions = await query(
      `SELECT id, type, amount, tx_hash, description, created_at 
       FROM credit_transactions 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [req.userId]
    );

    res.json({
      success: true,
      data: {
        balance,
        transactions: transactions.map(t => ({
          id: t.id,
          type: t.type,
          amount: parseFloat(t.amount),
          txHash: t.tx_hash,
          description: t.description,
          createdAt: t.created_at
        }))
      }
    });
  } catch (error) {
    console.error('Get credits error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/credits/purchase
 * Add credits from ETH purchase - verifies transaction on-chain
 */
router.post('/purchase', async (req, res) => {
  try {
    const { txHash } = req.body;

    if (!txHash) {
      return res.status(400).json({ success: false, error: 'txHash is required' });
    }

    // Check if txHash already used
    const existing = await query(
      'SELECT id FROM credit_transactions WHERE tx_hash = ?',
      [txHash]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, error: 'Transaction already processed' });
    }

    // Verify transaction on-chain via RPC
    const chain = getChainConfig();
    if (!chain.rpcUrl) {
      return res.status(500).json({ success: false, error: 'RPC not configured' });
    }

    // Get transaction receipt
    const receiptRes = await fetch(chain.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionReceipt',
        params: [txHash],
        id: 1
      })
    });
    const receiptData = await receiptRes.json();
    const receipt = receiptData.result;

    if (!receipt) {
      return res.status(400).json({ success: false, error: 'Transaction not found or still pending' });
    }

    if (receipt.status !== '0x1') {
      return res.status(400).json({ success: false, error: 'Transaction failed on-chain' });
    }

    // Get transaction details to verify value and recipient
    const txRes = await fetch(chain.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionByHash',
        params: [txHash],
        id: 2
      })
    });
    const txData = await txRes.json();
    const tx = txData.result;

    if (!tx) {
      return res.status(400).json({ success: false, error: 'Transaction details not found' });
    }

    // Verify recipient is Buidlr wallet
    if (tx.to.toLowerCase() !== config.BUIDLR_WALLET_ADDRESS.toLowerCase()) {
      return res.status(400).json({ success: false, error: 'Transaction recipient does not match Buidlr wallet' });
    }

    // Parse ETH amount from tx value (hex wei → ETH)
    const weiValue = BigInt(tx.value);
    const ethAmount = Number(weiValue) / 1e18;

    if (ethAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Transaction has no ETH value' });
    }

    // All checks passed — add credits
    const result = await creditsService.addCredits(req.userId, ethAmount, txHash);

    res.json({
      success: true,
      data: {
        creditsAdded: result.creditsAdded,
        newBalance: result.newBalance,
        ethAmount,
        network: chain.chainName
      }
    });
  } catch (error) {
    console.error('Purchase credits error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
