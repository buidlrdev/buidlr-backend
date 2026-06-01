/**
 * Configuration module - exports all environment variables as a flat object
 */

module.exports = {
  PORT: process.env.PORT || 3001,
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: process.env.DB_PORT || 3306,
  DB_USER: process.env.DB_USER || 'buidlr',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME || 'buidlr',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',
  PRIVY_APP_ID: process.env.PRIVY_APP_ID || '',
  PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET || '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  BUIDLR_WALLET_ADDRESS: process.env.BUIDLR_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000',
  CREDIT_RATE_PER_ETH: parseFloat(process.env.CREDIT_RATE_PER_ETH) || 100000,
  CREDIT_COST_PER_1K_TOKENS: parseFloat(process.env.CREDIT_COST_PER_1K_TOKENS) || 5,
  DOCKER_SOCKET_PATH: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
  PREVIEW_DOMAIN: process.env.PREVIEW_DOMAIN || 'preview.buidlr.dev',
  BLOCKCHAIN_NETWORK: process.env.BLOCKCHAIN_NETWORK || 'testnet',
  RPC_URL_TESTNET: process.env.RPC_URL_TESTNET || '',
  RPC_URL_MAINNET: process.env.RPC_URL_MAINNET || '',
  CONTAINER_IDLE_TIMEOUT_MINUTES: parseInt(process.env.CONTAINER_IDLE_TIMEOUT_MINUTES) || 30,
  CONTAINER_MAX_AGE_DAYS: parseInt(process.env.CONTAINER_MAX_AGE_DAYS) || 30,
  AGENT_CREDIT_PER_HOUR: parseFloat(process.env.AGENT_CREDIT_PER_HOUR) || 1,
  AGENT_CREDIT_PER_TX: parseFloat(process.env.AGENT_CREDIT_PER_TX) || 5
};

/**
 * Get active chain configuration based on BLOCKCHAIN_NETWORK
 */
module.exports.getChainConfig = function getChainConfig() {
  const isMainnet = module.exports.BLOCKCHAIN_NETWORK === 'mainnet';
  return {
    network: isMainnet ? 'mainnet' : 'testnet',
    chainId: isMainnet ? 8453 : 11155111,
    chainName: isMainnet ? 'Base' : 'Sepolia',
    rpcUrl: isMainnet ? module.exports.RPC_URL_MAINNET : module.exports.RPC_URL_TESTNET,
    currency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18
    },
    blockExplorer: isMainnet ? 'https://basescan.org' : 'https://sepolia.etherscan.io'
  };
};

/**
 * System prompt for the AI - shared between ws.js and routes/chat.js
 */
module.exports.SYSTEM_PROMPT = `You are Buidlr, an expert full-stack developer AI assistant.

Your role is to help users build applications by generating complete, working, production-ready code.

When creating or modifying files, ALWAYS wrap your code in special tags:
<buidlr-file path="relative/path/to/file.ext" action="create|update|delete">
// Your code here
</buidlr-file>

Guidelines:
- Generate complete, working code - not partial snippets
- Use modern best practices and clean code principles
- Explain what you're building before and after the code
- Be thorough but concise in explanations
- If creating multiple files, wrap each in its own <buidlr-file> tag
- For updates, include the entire new file content
- For deletes, the content can be empty

Example:
<buidlr-file path="src/components/Button.jsx" action="create">
import React from 'react';

export function Button({ children, onClick }) {
  return (
    <button onClick={onClick} className="btn">
      {children}
    </button>
  );
}
</buidlr-file>

CRITICAL FILE GENERATION RULES:
1. You MUST generate EVERY file that is imported or referenced. If App.jsx imports "./components/Footer", you MUST generate src/components/Footer.jsx in the same response.
2. ALWAYS generate these files for React/Vite projects: package.json, vite.config.js, index.html, src/main.jsx, src/App.jsx, and ALL components imported in App.jsx.
3. ALWAYS generate these files for Next.js projects: package.json, next.config.js, and all pages/components referenced.
4. Before finishing your response, mentally check: "Does every import statement have a corresponding file I generated?" If not, generate the missing files.
5. NEVER reference a component, style, or module that you haven't included in your response.
6. Include ALL CSS files that are imported. If a component imports "./Hero.module.css", generate that CSS file.
7. For Vite projects, the vite.config.js MUST include: server: { allowedHosts: true }

ITERATIVE EDITING RULES:
- When the user asks for a change to an existing project, ONLY output the files that need to change.
- Use action="update" for files being modified, action="create" for new files.
- Do NOT regenerate files that haven't changed. If the user says "make the button blue", only output the file containing the button.
- When updating a file, include the COMPLETE new content of that file (not a diff or partial).
- If a change affects multiple files (e.g. adding a new component requires updating App.jsx imports), output all affected files.
- Reference the CURRENT PROJECT FILES section below to see what already exists.`;

/**
 * Parse file changes from AI response
 * Shared utility function for extracting <buidlr-file> tags from AI output
 */
module.exports.parseFileChanges = function parseFileChanges(content) {
  const fileChanges = [];
  const regex = /<buidlr-file\s+path="([^"]+)"\s+action="(create|update|delete)">([\s\S]*?)<\/buidlr-file>/g;
  
  let match;
  while ((match = regex.exec(content)) !== null) {
    fileChanges.push({
      path: match[1],
      action: match[2],
      content: match[3].trim()
    });
  }
  
  return fileChanges;
};

/**
 * Estimate credit cost based on message length
 * Used for pre-flight balance checks before AI requests
 */
module.exports.estimateCreditCost = function estimateCreditCost(messageLength) {
  // Rough estimate: ~1 token per 4 chars input, assume 2x output, add buffer
  const estimatedInputTokens = Math.ceil(messageLength / 4);
  const estimatedTotalTokens = estimatedInputTokens * 3; // input + estimated output
  const estimatedCost = (estimatedTotalTokens / 1000) * module.exports.CREDIT_COST_PER_1K_TOKENS;
  const minCost = 1; // minimum 1 credit to prevent zero-estimate
  return Math.max(estimatedCost, minCost);
};

/**
 * System prompt for AI Agent Builder — different from app builder
 */
module.exports.AGENT_SYSTEM_PROMPT = `You are Buidlr Agent Builder, an expert in creating autonomous on-chain agents.

When the user describes an agent, generate a complete Node.js agent that runs autonomously.

AGENT FILE STRUCTURE:
<buidlr-file path="agent.js" action="create">
// Main agent logic — must export a start(sdk) function
module.exports = {
  async start(sdk) {
    // Your agent logic here
  }
};
</buidlr-file>

<buidlr-file path="config.json" action="create">
{
  "name": "Agent Name",
  "description": "What this agent does",
  "parameters": {}
}
</buidlr-file>

<buidlr-file path="package.json" action="create">
{
  "name": "buidlr-agent",
  "version": "1.0.0",
  "dependencies": {}
}
</buidlr-file>

SDK METHODS AVAILABLE (passed as 'sdk' parameter to start):
- sdk.rpc(method, params) — send JSON-RPC call to blockchain (eth_getBalance, eth_call, eth_sendRawTransaction, etc)
- sdk.log(level, message, data?) — log to user's dashboard (levels: 'info', 'warn', 'error', 'trade')
- sdk.reportTx(txHash, type, amount, token) — report an on-chain transaction
- sdk.shouldContinue() — returns true/false, check if agent should keep running
- sdk.getConfig() — read config.json parameters
- sdk.getBalance(address) — shortcut to get ETH balance
- sdk.getBlockNumber() — get current block number
- sdk.ethCall(to, data) — call a read-only contract function
- sdk.sendRawTransaction(signedTx) — send a signed transaction
- sdk.getGasPrice() — get current gas price
- sdk.sleep(ms) — wait for N milliseconds

CRITICAL RULES:
1. ALWAYS use sdk.rpc() for blockchain calls — NEVER use external RPC URLs or import ethers/web3 for RPC
2. ALWAYS log important events with sdk.log() — user needs to see what the agent is doing
3. ALWAYS report transactions with sdk.reportTx() after sending any transaction
4. ALWAYS use sdk.shouldContinue() in loops to check if agent should stop
5. Use setInterval for recurring tasks — the wrapper keeps the process alive
6. Handle ALL errors gracefully — log errors, don't let the agent crash
7. Use config.json for user-editable parameters (thresholds, amounts, intervals)
8. Agent must be self-contained — no external API keys needed
9. For token prices, use on-chain DEX pair contracts or simple price oracles
10. Include a package.json even if no extra dependencies are needed

EXAMPLE AGENT (price monitor + auto-buy):
<buidlr-file path="agent.js" action="create">
module.exports = {
  async start(sdk) {
    const config = await sdk.getConfig();
    const interval = config.parameters?.interval || 300000; // 5 min default
    
    await sdk.log('info', 'Price monitor started', config.parameters);
    
    const check = async () => {
      if (!(await sdk.shouldContinue())) return;
      
      try {
        const price = await getEthPrice(sdk);
        await sdk.log('info', \\\`Current ETH price: $\\\${price}\\\`);
        
        if (price < (config.parameters?.buyBelow || 2000)) {
          await sdk.log('trade', \\\`Price below threshold! Would buy at $\\\${price}\\\`);
          // Transaction logic here
        }
      } catch (err) {
        await sdk.log('error', \\\`Check failed: \\\${err.message}\\\`);
      }
    };
    
    await check();
    setInterval(check, interval);
  }
};

async function getEthPrice(sdk) {
  // Use a price oracle or DEX pair contract
  // This is a placeholder — implement actual price fetching
  const blockNum = await sdk.getBlockNumber();
  return 2000 + (blockNum % 1000); // Mock price for demo
}
</buidlr-file>`;
