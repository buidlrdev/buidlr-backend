/**
 * Buidlr Agent SDK — injected into every agent container
 * Provides: RPC access, logging, transaction reporting, heartbeat, spending guards
 * 
 * This file is a TEMPLATE — env vars are set when container starts
 */

const BACKEND_URL = process.env.BUIDLR_BACKEND_URL;
const AGENT_ID = process.env.BUIDLR_AGENT_ID;
const AGENT_TOKEN = process.env.BUIDLR_AGENT_TOKEN;

/**
 * Send JSON-RPC call through Buidlr's RPC proxy
 */
async function rpc(method, params = []) {
  const res = await fetch(`${BACKEND_URL}/api/rpc/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() })
  });
  const data = await res.json();
  if (data.error) throw new Error(`RPC Error: ${data.error.message}`);
  return data.result;
}

/**
 * Log a message to the Buidlr dashboard
 * @param {'info'|'warn'|'error'|'trade'} level
 * @param {string} message
 * @param {object} [data] — optional extra data
 */
async function log(level, message, data = null) {
  try {
    await fetch(`${BACKEND_URL}/api/agents/${AGENT_ID}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Token': AGENT_TOKEN },
      body: JSON.stringify({ level, message, data })
    });
  } catch (err) {
    console.error(`[SDK] Log failed: ${err.message}`);
  }
}

/**
 * Report an on-chain transaction to the dashboard
 */
async function reportTx(txHash, type, amount, token) {
  try {
    await fetch(`${BACKEND_URL}/api/agents/${AGENT_ID}/tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Token': AGENT_TOKEN },
      body: JSON.stringify({ txHash, type, amount, token })
    });
  } catch (err) {
    console.error(`[SDK] Report tx failed: ${err.message}`);
  }
}

/**
 * Send heartbeat — called automatically by the wrapper every 60s
 * Returns false if agent should stop (paused, credit limit, etc)
 */
async function heartbeat() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/agents/${AGENT_ID}/heartbeat`, {
      method: 'POST',
      headers: { 'X-Agent-Token': AGENT_TOKEN }
    });
    const data = await res.json();
    return data.success && data.data?.continue !== false;
  } catch (err) {
    // Backend unreachable — keep running, retry next heartbeat
    return true;
  }
}

/**
 * Check if agent should continue running
 */
async function shouldContinue() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/agents/${AGENT_ID}/status`, {
      headers: { 'X-Agent-Token': AGENT_TOKEN }
    });
    const data = await res.json();
    return data.success && data.data?.status === 'running';
  } catch (err) {
    return true; // Keep running if can't reach backend
  }
}

/**
 * Get the agent's config.json
 */
async function getConfig() {
  try {
    const fs = require('fs');
    const raw = fs.readFileSync('/app/config.json', 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

/**
 * Helper: get ETH balance of an address
 */
async function getBalance(address) {
  const hex = await rpc('eth_getBalance', [address, 'latest']);
  return parseInt(hex, 16) / 1e18;
}

/**
 * Helper: get current block number
 */
async function getBlockNumber() {
  const hex = await rpc('eth_blockNumber');
  return parseInt(hex, 16);
}

/**
 * Helper: call a read-only contract function
 */
async function ethCall(to, data, blockTag = 'latest') {
  return await rpc('eth_call', [{ to, data }, blockTag]);
}

/**
 * Helper: send a raw signed transaction
 */
async function sendRawTransaction(signedTx) {
  return await rpc('eth_sendRawTransaction', [signedTx]);
}

/**
 * Helper: get gas price
 */
async function getGasPrice() {
  const hex = await rpc('eth_gasPrice');
  return parseInt(hex, 16);
}

/**
 * Helper: wait for N milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  rpc,
  log,
  reportTx,
  heartbeat,
  shouldContinue,
  getConfig,
  getBalance,
  getBlockNumber,
  ethCall,
  sendRawTransaction,
  getGasPrice,
  sleep
};
