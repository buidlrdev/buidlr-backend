/**
 * Buidlr Agent Wrapper — entry point for all agent containers
 * Wraps user's agent.js with: heartbeat, auto-stop, error handling
 * 
 * This file is copied into /app/ alongside agent-sdk.js and the user's agent.js
 */

const sdk = require('./buidlr-agent-sdk');

// Heartbeat every 60 seconds — checks if agent should keep running
const heartbeatInterval = setInterval(async () => {
  try {
    const shouldRun = await sdk.heartbeat();
    if (!shouldRun) {
      await sdk.log('info', 'Agent stopped — paused by user or credit limit reached');
      clearInterval(heartbeatInterval);
      process.exit(0);
    }
  } catch (err) {
    // Backend unreachable — keep running, retry next tick
    console.error('[Wrapper] Heartbeat failed:', err.message);
  }
}, 60000);

// Graceful shutdown
process.on('SIGTERM', async () => {
  await sdk.log('info', 'Agent received shutdown signal');
  clearInterval(heartbeatInterval);
  process.exit(0);
});

process.on('SIGINT', async () => {
  await sdk.log('info', 'Agent interrupted');
  clearInterval(heartbeatInterval);
  process.exit(0);
});

// Uncaught errors — log and exit
process.on('uncaughtException', async (err) => {
  try {
    await sdk.log('error', `Uncaught exception: ${err.message}`, { stack: err.stack });
  } catch (logErr) {
    console.error('[Wrapper] Failed to log crash:', logErr.message);
  }
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  try {
    await sdk.log('error', `Unhandled rejection: ${reason}`, { reason: String(reason) });
  } catch (logErr) {
    console.error('[Wrapper] Failed to log rejection:', logErr.message);
  }
  // Don't exit — let agent continue
});

// Start the user's agent
(async () => {
  try {
    await sdk.log('info', 'Agent starting...');

    // Load user's agent
    const agent = require('./agent');

    if (typeof agent.start === 'function') {
      await agent.start(sdk);
    } else if (typeof agent === 'function') {
      await agent(sdk);
    } else {
      await sdk.log('error', 'Agent must export a start(sdk) function or be a function itself');
      process.exit(1);
    }

    await sdk.log('info', 'Agent main function completed — keeping alive for intervals');
    // Don't exit — agent might have setInterval/setTimeout running
  } catch (err) {
    await sdk.log('error', `Agent crashed: ${err.message}`, { stack: err.stack });
    process.exit(1);
  }
})();
