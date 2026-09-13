import { assert, object } from './schema.js'

// Explicit wire protocol, never infer a provider implementation from a model name.
export function providerPatches(raw, baseURL) {
  assert(object(raw) && Object.keys(raw).every(k => ['adapter', 'model', 'maxTokens', 'contextWindow'].includes(k)), 'Invalid provider configuration')
  assert(['deepseek-native', 'pi-chat-completions'].includes(raw.adapter), 'Unsupported provider adapter')
  assert(typeof raw.model === 'string' && /^[a-zA-Z0-9._\[\]-]{1,100}$/.test(raw.model), 'Invalid model ID')
  const maxTokens = raw.maxTokens ?? 2048, contextWindow = raw.contextWindow ?? 32768
  assert(Number.isSafeInteger(maxTokens) && maxTokens >= 100 && maxTokens <= 16000, 'Invalid provider output cap')
  assert(Number.isSafeInteger(contextWindow) && contextWindow >= maxTokens && contextWindow <= 1000000, 'Invalid configured context window')
  const retryPolicy = { mode: 'normal', maxRetries: 0 }
  if (raw.adapter === 'deepseek-native') return [
    { id: 'llm-pi-ai', disabled: true },
    { id: 'llm-deepseek', disabled: false, config: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL, thinking: 'disabled', reasoningEffort: 'off', maxTokens, streamIdleTimeoutMs: 30000, retryPolicy } },
    { id: 'agent-default-model', config: { provider: 'deepseek-official', model: raw.model } },
  ]
  return [
    { id: 'llm-deepseek', disabled: true },
    { id: 'llm-pi-ai', disabled: false, config: { providers: { 'router-gateway': {
      api: 'openai-completions', apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL,
      models: [{ id: raw.model, contextWindow, maxTokens, input: ['text'] }],
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: true, maxTokensField: 'max_tokens' },
      reasoning: 'off', timeoutMs: 60000, streamIdleTimeoutMs: 30000, retryPolicy,
    } } } },
    { id: 'agent-default-model', config: { provider: 'router-gateway', model: raw.model } },
  ]
}
