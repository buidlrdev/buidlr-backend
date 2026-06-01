/**
 * RPC routes - proxy for blockchain JSON-RPC requests
 */

const express = require('express');
const router = express.Router();
const config = require('../config');
const { getChainConfig } = require('../config');

/**
 * GET /api/rpc/chain
 * Returns the current chain config (no auth required)
 * Frontend uses this to know which network to connect to
 */
router.get('/chain', (req, res) => {
  const chain = getChainConfig();
  res.json({
    success: true,
    data: {
      network: chain.network,
      chainId: chain.chainId,
      chainName: chain.chainName,
      currency: chain.currency,
      blockExplorer: chain.blockExplorer,
      // NOTE: never expose rpcUrl to frontend
      rpcProxy: '/api/rpc/proxy',
      buidlrWallet: config.BUIDLR_WALLET_ADDRESS
    }
  });
});

/**
 * POST /api/rpc/proxy
 * Proxies JSON-RPC calls to the QuickNode RPC endpoint
 * Body: standard JSON-RPC request { jsonrpc, method, params, id }
 * 
 * No auth required — but rate limit in production.
 * 
 * Allowed methods are whitelisted to prevent abuse.
 */
const ALLOWED_RPC_METHODS = [
  // Read methods
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getTransactionCount',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getLogs',
  'eth_getCode',
  'eth_getStorageAt',
  'net_version',
  // Send transaction (needed for credit purchases)
  'eth_sendRawTransaction',
];

router.post('/proxy', async (req, res) => {
  try {
    const chain = getChainConfig();
    
    if (!chain.rpcUrl) {
      return res.status(500).json({ success: false, error: 'RPC URL not configured' });
    }

    const rpcBody = req.body;

    // Support batch requests
    const requests = Array.isArray(rpcBody) ? rpcBody : [rpcBody];

    // Validate all methods are allowed
    for (const request of requests) {
      if (!request.method || !ALLOWED_RPC_METHODS.includes(request.method)) {
        return res.status(403).json({
          success: false,
          error: `RPC method not allowed: ${request.method || 'undefined'}`
        });
      }
    }

    // Forward to QuickNode
    const rpcResponse = await fetch(chain.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rpcBody) // Forward as-is (single or batch)
    });

    const rpcData = await rpcResponse.json();
    res.json(rpcData);

  } catch (error) {
    console.error('RPC proxy error:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'RPC proxy error' },
      id: req.body?.id || null
    });
  }
});

module.exports = router;
