/**
 * WebSocket server - real-time chat and session management
 */

const WebSocket = require('ws');
const url = require('url');
const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('./middleware/auth');
const { query } = require('./db');
const { createProvider } = require('./services/ai');
const { decrypt } = require('./services/encryption');
const creditsService = require('./services/credits');
const containerManager = require('./services/container-manager');
const config = require('./config');
const { SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT, parseFileChanges, estimateCreditCost } = require('./config');

/**
 * Set up WebSocket server
 * @param {http.Server} server - HTTP server instance
 */
function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  // Track client sessions
  const clients = new Map(); // ws -> { userId, user, sessionId }

  wss.on('connection', async (ws, req) => {
    try {
      // Extract token from query params
      const parsedUrl = url.parse(req.url, true);
      const token = parsedUrl.query.token;

      if (!token) {
        ws.send(JSON.stringify({ type: 'error', error: 'Missing authentication token' }));
        ws.close();
        return;
      }

      // Verify token and get user
      const user = await verifyToken(token);
      
      // Store client info
      clients.set(ws, { userId: user.id, user, sessionId: null });

      // Send connected confirmation
      ws.send(JSON.stringify({ type: 'connected', userId: user.id }));

      // Handle messages
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await handleMessage(ws, clients.get(ws), message, clients);
        } catch (error) {
          console.error('WebSocket message error:', error);
          ws.send(JSON.stringify({ type: 'error', error: error.message }));
        }
      });

      // Handle disconnect
      ws.on('close', () => {
        clients.delete(ws);
      });

    } catch (error) {
      console.error('WebSocket connection error:', error);
      ws.send(JSON.stringify({ type: 'error', error: 'Authentication failed' }));
      ws.close();
    }
  });

  // Set up global agent log broadcast (used by routes/agents.js)
  global.agentLogBroadcast = (agentId, message) => {
    const payload = JSON.stringify(message);
    clients.forEach((info, client) => {
      if (info.agentId === agentId && client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  };

  return wss;
}

/**
 * Handle incoming WebSocket messages
 */
async function handleMessage(ws, clientInfo, message, clients) {
  const { type } = message;
  const { userId, user } = clientInfo;

  switch (type) {
    case 'join_session':
      await handleJoinSession(ws, clientInfo, message, clients);
      break;

    case 'leave_session':
      handleLeaveSession(ws, clientInfo, clients);
      break;

    case 'chat':
      await handleChat(ws, clientInfo, message);
      break;

    case 'join_agent':
      handleJoinAgent(ws, clientInfo, message);
      break;

    case 'leave_agent':
      handleLeaveAgent(ws, clientInfo);
      break;

    default:
      ws.send(JSON.stringify({ type: 'error', error: `Unknown message type: ${type}` }));
  }
}

/**
 * Handle join_session message
 */
async function handleJoinSession(ws, clientInfo, message, clients) {
  const { sessionId } = message;
  const { userId } = clientInfo;

  // Verify session belongs to user
  const sessions = await query(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId]
  );

  if (sessions.length === 0) {
    ws.send(JSON.stringify({ type: 'error', error: 'Session not found' }));
    return;
  }

  // Update client's session
  clientInfo.sessionId = sessionId;
  clients.set(ws, clientInfo);

  ws.send(JSON.stringify({ type: 'joined_session', sessionId }));
}

/**
 * Handle leave_session message
 */
function handleLeaveSession(ws, clientInfo, clients) {
  clientInfo.sessionId = null;
  clients.set(ws, clientInfo);
  ws.send(JSON.stringify({ type: 'left_session' }));
}

/**
 * Handle chat message
 */
async function handleChat(ws, clientInfo, message) {
  const { sessionId, message: userMessage, useOwnKey, provider = 'anthropic', model } = message;
  const { userId } = clientInfo;

  try {
    // Verify session
    const sessions = await query(
      'SELECT id, type FROM sessions WHERE id = ? AND user_id = ?',
      [sessionId, userId]
    );

    if (sessions.length === 0) {
      ws.send(JSON.stringify({ type: 'chat_error', error: 'Session not found' }));
      return;
    }

    const sessionType = sessions[0].type || 'app';

    // Save user message
    const userMsgId = uuidv4();
    await query(
      'INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)',
      [userMsgId, sessionId, 'user', userMessage]
    );

    // Update last_activity on chat
    await query('UPDATE sessions SET last_activity = NOW() WHERE id = ?', [sessionId]);

    // Resolve API key
    let apiKey;
    if (useOwnKey) {
      const keys = await query(
        'SELECT encrypted_key FROM ai_keys WHERE user_id = ? AND provider = ? AND is_default = TRUE',
        [userId, provider]
      );
      if (keys.length === 0) {
        const anyKey = await query(
          'SELECT encrypted_key FROM ai_keys WHERE user_id = ? AND provider = ? LIMIT 1',
          [userId, provider]
        );
        if (anyKey.length === 0) {
          ws.send(JSON.stringify({ type: 'chat_error', error: `No API key found for provider: ${provider}` }));
          return;
        }
        apiKey = decrypt(anyKey[0].encrypted_key);
      } else {
        apiKey = decrypt(keys[0].encrypted_key);
      }
    } else {
      // Use platform API key
      apiKey = config.ANTHROPIC_API_KEY;
      
      // Check credit balance
      const balance = await creditsService.getBalance(userId);
      const estimatedCost = estimateCreditCost(userMessage.length);
      if (balance < estimatedCost) {
        ws.send(JSON.stringify({ type: 'credit_low', balance, required: estimatedCost }));
        return;
      }
    }

    ws.send(JSON.stringify({ type: 'chat_start', sessionId }));

    // Get conversation history
    const history = await query(
      'SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC',
      [sessionId]
    );

    // Get current project files for AI context
    const currentFiles = await getCurrentProjectFiles(sessionId);

    // Build enhanced system prompt with file context
    // Use AGENT_SYSTEM_PROMPT for agent sessions, SYSTEM_PROMPT for app sessions
    const basePrompt = sessionType === 'agent' ? AGENT_SYSTEM_PROMPT : SYSTEM_PROMPT;
    let enhancedPrompt = basePrompt;
    if (currentFiles.length > 0) {
      enhancedPrompt += '\n\nCURRENT PROJECT FILES:\nThe user\'s project currently has the following files. When they ask for changes, ONLY modify the files that need to change — do NOT regenerate files that don\'t need updates. Use action="update" for existing files and action="create" for new files.\n\n';
      for (const file of currentFiles) {
        enhancedPrompt += `--- ${file.path} ---\n${file.content}\n\n`;
      }
      enhancedPrompt += '\nIMPORTANT: If the user asks for a small change (like "change the color" or "add a button"), ONLY output the files that actually change. Do NOT regenerate unchanged files.';
    }

    // Stream AI response
    const aiProvider = createProvider(provider, apiKey);
    let fullContent = '';
    let usage = { inputTokens: 0, outputTokens: 0 };

    for await (const chunk of aiProvider.streamChat(history, enhancedPrompt, model)) {
      if (chunk.type === 'text') {
        fullContent += chunk.content;
        ws.send(JSON.stringify({ type: 'chat_text', content: chunk.content }));
      } else if (chunk.type === 'done') {
        usage = chunk.usage;
      }
    }

    // Parse file changes
    const fileChanges = parseFileChanges(fullContent);
    
    // Send file change events
    for (const file of fileChanges) {
      ws.send(JSON.stringify({ type: 'chat_file', file }));
    }

    // Setup/update container with generated files (APP sessions only — agents deploy separately)
    let containerInfo = null;
    if (fileChanges.length > 0 && sessionType === 'app') {
      try {
        // Check if session already has a container
        const sessionData = await query(
          'SELECT container_id FROM sessions WHERE id = ?',
          [sessionId]
        );

        if (sessionData[0]?.container_id) {
          // Update existing container
          containerInfo = await containerManager.updateSessionFiles(sessionId, fileChanges);
        } else {
          // First time — full setup
          containerInfo = await containerManager.setupSessionContainer(sessionId, fileChanges);
        }

        // Send container status to frontend
        ws.send(JSON.stringify({
          type: 'container_status',
          sessionId,
          status: 'running',
          port: containerInfo.port,
          previewUrl: `https://${sessionId}.${config.PREVIEW_DOMAIN}`
        }));
      } catch (containerError) {
        console.error('Container setup error:', containerError.message);
        // Non-fatal — chat still works, preview just won't be available
        ws.send(JSON.stringify({
          type: 'container_status',
          sessionId,
          status: 'error',
          error: containerError.message
        }));
      }
    }

    // Consume credits if using platform key
    let creditsConsumed = 0;
    if (!useOwnKey) {
      const totalTokens = usage.inputTokens + usage.outputTokens;
      const result = await creditsService.consumeCredits(userId, totalTokens);
      creditsConsumed = result.cost;
    }

    // Save assistant message
    const assistantMsgId = uuidv4();
    await query(
      `INSERT INTO chat_messages (id, session_id, role, content, file_changes, model, tokens_used, credits_consumed) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        assistantMsgId,
        sessionId,
        'assistant',
        fullContent,
        JSON.stringify(fileChanges),
        model || 'claude-sonnet-4-6',
        usage.inputTokens + usage.outputTokens,
        creditsConsumed
      ]
    );

    ws.send(JSON.stringify({
      type: 'chat_done',
      sessionId,
      fileChanges,
      creditsConsumed,
      containerPort: containerInfo?.port || null,
      previewUrl: containerInfo ? `https://${sessionId}.${config.PREVIEW_DOMAIN}` : null
    }));

  } catch (error) {
    console.error('Chat error:', error);
    ws.send(JSON.stringify({ type: 'chat_error', error: error.message }));
  }
}

/**
 * Handle join_agent — subscribe to agent log stream
 */
function handleJoinAgent(ws, clientInfo, message) {
  const { agentId } = message;
  clientInfo.agentId = agentId;
  ws.send(JSON.stringify({ type: 'joined_agent', agentId }));
}

/**
 * Handle leave_agent — unsubscribe from agent log stream
 */
function handleLeaveAgent(ws, clientInfo) {
  clientInfo.agentId = null;
  ws.send(JSON.stringify({ type: 'left_agent' }));
}

/**
 * Get current project files from chat messages (merged, latest wins)
 */
async function getCurrentProjectFiles(sessionId) {
  const messages = await query(
    `SELECT file_changes FROM chat_messages 
     WHERE session_id = ? AND role = 'assistant' AND file_changes IS NOT NULL
     ORDER BY created_at ASC`,
    [sessionId]
  );

  const fileMap = new Map();
  for (const msg of messages) {
    try {
      const changes = typeof msg.file_changes === 'string'
        ? JSON.parse(msg.file_changes)
        : msg.file_changes;
      if (!Array.isArray(changes)) continue;
      for (const file of changes) {
        if (file.action === 'delete') {
          fileMap.delete(file.path);
        } else {
          fileMap.set(file.path, file);
        }
      }
    } catch (err) {
      // Skip malformed file_changes
    }
  }

  return Array.from(fileMap.values());
}

module.exports = { setupWebSocket };
