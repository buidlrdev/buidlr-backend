/**
 * AI service - unified provider interface for streaming chat
 */

const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Provider configurations
const PROVIDERS = {
  anthropic: {
    displayName: 'Anthropic',
    defaultModel: 'claude-sonnet-4-6',
    models: ['claude-sonnet-4-6', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307']
  },
  openai: {
    displayName: 'OpenAI',
    defaultModel: 'gpt-5.5',
    models: ['gpt-5.5', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']
  },
  gemini: {
    displayName: 'Google Gemini',
    defaultModel: 'gemini-3.5-flash',
    models: ['gemini-3.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro']
  },
  deepseek: {
    displayName: 'DeepSeek',
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-coder']
  },
  groq: {
    displayName: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768']
  }
};

/**
 * Create a provider instance with streaming chat capability
 * @param {string} provider - Provider name
 * @param {string} apiKey - API key
 * @returns {Object} - Provider instance with streamChat method
 */
function createProvider(provider, apiKey) {
  const config = PROVIDERS[provider];
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  return {
    /**
     * Stream chat completion as an async generator
     * @param {Array} messages - Chat messages
     * @param {string} systemPrompt - System prompt
     * @param {string} model - Model to use (optional)
     * @yields {{type: string, content?: string, usage?: Object}}
     */
    async *streamChat(messages, systemPrompt, model = config.defaultModel) {
      switch (provider) {
        case 'anthropic':
          yield* streamAnthropic(apiKey, messages, systemPrompt, model);
          break;
        case 'openai':
          yield* streamOpenAI(apiKey, messages, systemPrompt, model, 'https://api.openai.com/v1');
          break;
        case 'gemini':
          yield* streamGemini(apiKey, messages, systemPrompt, model);
          break;
        case 'deepseek':
          yield* streamOpenAI(apiKey, messages, systemPrompt, model, 'https://api.deepseek.com');
          break;
        case 'groq':
          yield* streamOpenAI(apiKey, messages, systemPrompt, model, 'https://api.groq.com/openai/v1');
          break;
        default:
          throw new Error(`Provider ${provider} not implemented`);
      }
    }
  };
}

/**
 * Stream from Anthropic API
 */
async function* streamAnthropic(apiKey, messages, systemPrompt, model) {
  const client = new Anthropic({ apiKey });
  
  const stream = await client.messages.stream({
    model,
    max_tokens: 32000,
    system: systemPrompt,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content
    }))
  });

  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield { type: 'text', content: event.delta.text };
    }
    if (event.type === 'message_delta' && event.usage) {
      outputTokens = event.usage.output_tokens;
    }
    if (event.type === 'message_start' && event.message.usage) {
      inputTokens = event.message.usage.input_tokens;
    }
  }

  yield { type: 'done', usage: { inputTokens, outputTokens } };
}

/**
 * Stream from OpenAI-compatible APIs (OpenAI, DeepSeek, Groq)
 */
async function* streamOpenAI(apiKey, messages, systemPrompt, model, baseURL) {
  const client = new OpenAI({ apiKey, baseURL });

  const stream = await client.chat.completions.create({
    model,
    max_tokens: 32000,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ]
  });

  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of stream) {
    if (chunk.choices[0]?.delta?.content) {
      yield { type: 'text', content: chunk.choices[0].delta.content };
    }
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens || 0;
      outputTokens = chunk.usage.completion_tokens || 0;
    }
  }

  yield { type: 'done', usage: { inputTokens, outputTokens } };
}

/**
 * Stream from Google Gemini API
 */
async function* streamGemini(apiKey, messages, systemPrompt, model) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ 
    model,
    systemInstruction: systemPrompt
  });

  // Convert messages to Gemini format
  const history = messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const lastMessage = messages[messages.length - 1];
  
  const chat = geminiModel.startChat({ history });
  const result = await chat.sendMessageStream(lastMessage.content);

  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      yield { type: 'text', content: text };
    }
  }

  // Get usage from final response
  const response = await result.response;
  if (response.usageMetadata) {
    inputTokens = response.usageMetadata.promptTokenCount || 0;
    outputTokens = response.usageMetadata.candidatesTokenCount || 0;
  }

  yield { type: 'done', usage: { inputTokens, outputTokens } };
}

module.exports = {
  createProvider,
  PROVIDERS
};
