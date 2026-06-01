/**
 * Chat routes - SSE fallback for AI chat
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { createProvider } = require('../services/ai');
const { decrypt } = require('../services/encryption');
const creditsService = require('../services/credits');
const config = require('../config');
const { SYSTEM_PROMPT, parseFileChanges, estimateCreditCost } = require('../config');

/**
 * POST /api/chat
 * SSE endpoint for chat streaming
 */
router.post('/', async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { sessionId, message, useOwnKey, provider = 'anthropic', model } = req.body;

    if (!sessionId || !message) {
      sendEvent('chat_error', { error: 'sessionId and message are required' });
      return res.end();
    }

    // Verify session belongs to user
    const sessions = await query(
      'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
      [sessionId, req.userId]
    );

    if (sessions.length === 0) {
      sendEvent('chat_error', { error: 'Session not found' });
      return res.end();
    }

    // Save user message
    const userMsgId = uuidv4();
    await query(
      'INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)',
      [userMsgId, sessionId, 'user', message]
    );

    // Resolve API key
    let apiKey;
    if (useOwnKey) {
      const keys = await query(
        'SELECT encrypted_key FROM ai_keys WHERE user_id = ? AND provider = ? AND is_default = TRUE',
        [req.userId, provider]
      );
      if (keys.length === 0) {
        // Fall back to any key for this provider
        const anyKey = await query(
          'SELECT encrypted_key FROM ai_keys WHERE user_id = ? AND provider = ? LIMIT 1',
          [req.userId, provider]
        );
        if (anyKey.length === 0) {
          sendEvent('chat_error', { error: `No API key found for provider: ${provider}` });
          return res.end();
        }
        apiKey = decrypt(anyKey[0].encrypted_key);
      } else {
        apiKey = decrypt(keys[0].encrypted_key);
      }
    } else {
      // Use platform API key
      apiKey = config.ANTHROPIC_API_KEY;
      
      // Check credit balance
      const balance = await creditsService.getBalance(req.userId);
      const estimatedCost = estimateCreditCost(message.length);
      if (balance < estimatedCost) {
        sendEvent('credit_low', { balance, required: estimatedCost });
        return res.end();
      }
    }

    sendEvent('chat_start', { sessionId });

    // Get conversation history
    const history = await query(
      'SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC',
      [sessionId]
    );

    // Stream AI response
    const aiProvider = createProvider(provider, apiKey);
    let fullContent = '';
    let usage = { inputTokens: 0, outputTokens: 0 };

    for await (const chunk of aiProvider.streamChat(history, SYSTEM_PROMPT, model)) {
      if (chunk.type === 'text') {
        fullContent += chunk.content;
        sendEvent('chat_text', { content: chunk.content });
      } else if (chunk.type === 'done') {
        usage = chunk.usage;
      }
    }

    // Parse file changes
    const fileChanges = parseFileChanges(fullContent);
    
    // Send file change events
    for (const file of fileChanges) {
      sendEvent('chat_file', { file });
    }

    // Consume credits if using platform key
    let creditsConsumed = 0;
    if (!useOwnKey) {
      const totalTokens = usage.inputTokens + usage.outputTokens;
      const result = await creditsService.consumeCredits(req.userId, totalTokens);
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

    sendEvent('chat_done', { sessionId, fileChanges, creditsConsumed });
    res.end();

  } catch (error) {
    console.error('Chat error:', error);
    sendEvent('chat_error', { error: error.message });
    res.end();
  }
});

module.exports = router;
