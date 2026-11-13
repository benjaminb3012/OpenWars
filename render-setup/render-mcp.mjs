#!/usr/bin/env node
// Minimal Render MCP client fallback for environments without a native MCP connector.
// Reads RENDER_API_KEY from the process environment. Never prints or stores the key.
// Usage: node render-mcp.mjs <toolName> ['{"json":"arguments"}']

const ENDPOINT = 'https://mcp.render.com/mcp';
const CLIENT_INFO = { name: 'arena-render-setup', version: '1.0.0' };

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function parseRpcBody(text, contentType) {
  if (!text) return null;
  if ((contentType || '').includes('text/event-stream')) {
    const messages = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        messages.push(JSON.parse(payload));
      } catch {
        // Ignore non-JSON SSE payloads.
      }
    }
    return messages;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pickRpcMessage(parsed, id) {
  if (parsed == null) return null;
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.find((m) => m && m.id === id) || null;
}

async function rpc({ method, params, id, apiKey, sessionId, protocolVersion }) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${apiKey}`,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  if (protocolVersion) headers['MCP-Protocol-Version'] = protocolVersion;

  const body = { jsonrpc: '2.0', method };
  if (id !== undefined) body.id = id;
  if (params !== undefined) body.params = params;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const nextSession = res.headers.get('mcp-session-id') || sessionId;
  const text = await res.text();

  if (!res.ok) {
    const snippet = text.slice(0, 500).replace(/\s+/g, ' ');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${snippet}`);
  }
  if (res.status === 202 || !text) {
    return { sessionId: nextSession, result: null };
  }

  const parsed = parseRpcBody(text, res.headers.get('content-type'));
  const message = id === undefined ? null : pickRpcMessage(parsed, id);
  if (id !== undefined && !message) {
    throw new Error(`No JSON-RPC response for id=${id}; body=${text.slice(0, 500)}`);
  }
  if (message && message.error) {
    throw new Error(`MCP error ${message.error.code}: ${message.error.message}`);
  }
  return { sessionId: nextSession, result: message ? message.result : null };
}

async function main() {
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey) {
    fail(
      'RENDER_API_KEY is not set in this process environment. Set it securely outside the repository and retry. Do not paste the key into chat.',
      2,
    );
  }

  const toolName = process.argv[2];
  if (!toolName) {
    fail('Usage: node render-mcp.mjs <toolName> [\'{"json":"arguments"}\']', 2);
  }

  let toolArgs = {};
  if (process.argv[3]) {
    try {
      toolArgs = JSON.parse(process.argv[3]);
    } catch {
      fail('Tool arguments must be valid JSON.', 2);
    }
  }

  try {
    const init = await rpc({
      method: 'initialize',
      id: 1,
      apiKey,
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
    });
    const protocolVersion = init.result?.protocolVersion || '2025-06-18';
    const sessionId = init.sessionId;

    await rpc({
      method: 'notifications/initialized',
      apiKey,
      sessionId,
      protocolVersion,
    });

    const call = await rpc({
      method: 'tools/call',
      id: 2,
      apiKey,
      sessionId,
      protocolVersion,
      params: { name: toolName, arguments: toolArgs },
    });

    console.log(JSON.stringify(call.result, null, 2));
    if (call.result && call.result.isError) process.exit(1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/HTTP 401/.test(message)) {
      fail(
        'Render returned 401. Check that RENDER_API_KEY is valid, not revoked, and available to this process. If this connection previously worked with OAuth, re-authorize instead of rewriting config.',
        1,
      );
    }
    fail(`Render MCP call failed: ${message}`, 1);
  }
}

main();
