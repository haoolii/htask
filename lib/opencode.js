'use strict';

class OpenCodeV2 {
  constructor(base, timeoutMs = 10000, password) {
    const url = new URL(base);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('OpenCode server must be on host loopback');
    }
    this.base = url.origin;
    this.timeoutMs = timeoutMs;
    this.authorization = password ? `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` : undefined;
  }

  async request(method, path, body) {
    const response = await fetch(this.base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.authorization ? { authorization: this.authorization } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`OpenCode ${method} ${path} returned HTTP ${response.status}`);
    if (response.status === 204) return undefined;
    return response.json();
  }

  async createSession(title, model) {
    const result = await this.request('POST', '/api/session', { title, model });
    if (!result.data || typeof result.data.id !== 'string') throw new Error('Invalid session response');
    return result.data;
  }

  sendPrompt(id, text, options = {}) {
    return this.request('POST', `/api/session/${encodeURIComponent(id)}/prompt`, { text, ...options });
  }

  interrupt(id) {
    return this.request('POST', `/api/session/${encodeURIComponent(id)}/interrupt`, {});
  }

  getSession(id) {
    return this.request('GET', `/api/session/${encodeURIComponent(id)}`);
  }
}

module.exports = { OpenCodeV2 };
