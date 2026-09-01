const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory token cache, keyed by accessTokenUrl+clientId so re-connecting
// a stream doesn't force a fresh OAuth round trip every time.
const tokenCache = new Map();

async function getAccessToken({ accessTokenUrl, clientId, clientSecret }) {
  const cacheKey = `${accessTokenUrl}::${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 5000) {
    return cached.token;
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch(accessTokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Token endpoint did not return JSON (status ${resp.status}): ${text.slice(0, 300)}`);
  }

  if (!resp.ok || !data.access_token) {
    throw new Error(`Token request failed (status ${resp.status}): ${text.slice(0, 300)}`);
  }

  const ttlMs = (Number(data.expires_in) || 300) * 1000;
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + ttlMs });
  return data.access_token;
}

function requireAuthConfig(body) {
  const { accessTokenUrl, clientId, clientSecret, baseURL } = body || {};
  if (!accessTokenUrl || !clientId || !clientSecret || !baseURL) {
    const err = new Error('Missing one of: baseURL, accessTokenUrl, clientId, clientSecret');
    err.status = 400;
    throw err;
  }
  return { accessTokenUrl, clientId, clientSecret, baseURL };
}

// POST /api/register  { baseURL, accessTokenUrl, clientId, clientSecret, payload }
app.post('/api/register', async (req, res) => {
  try {
    const auth = requireAuthConfig(req.body);
    const payload = req.body.payload || {};

    const token = await getAccessToken(auth);
    const url = `${auth.baseURL.replace(/\/+$/, '')}/api/extract/v1/registration`;

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // leave json null, return raw text
    }

    res.status(upstream.status).json({
      ok: upstream.ok,
      status: upstream.status,
      body: json !== null ? json : text,
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// GET /api/connect  ?baseURL=&accessTokenUrl=&clientId=&clientSecret=&registerID=
// Streams the upstream response back to the client as it arrives.
app.get('/api/connect', async (req, res) => {
  try {
    const auth = requireAuthConfig(req.query);
    const { registerID } = req.query;
    if (!registerID) {
      res.status(400).json({ ok: false, error: 'Missing registerID' });
      return;
    }

    const token = await getAccessToken(auth);
    const url = `${auth.baseURL.replace(/\/+$/, '')}/api/extract/v1/connect/${encodeURIComponent(registerID)}`;

    const upstream = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-streaming, application/json, */*',
        'Content-Type': 'text/plain',
        'Content-Transfer-Encoding': 'chunked',
        'Access-Control-Allow-Origin': '*',
      },
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      res.status(upstream.status || 502).json({ ok: false, status: upstream.status, error: text || 'Upstream error' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    req.on('close', () => {
      reader.cancel().catch(() => {});
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(err.status || 500).json({ ok: false, error: err.message });
    } else {
      res.end();
    }
  }
});

const PORT = process.env.PORT || 4173;
app.listen(PORT, () => {
  console.log(`BIX extraction console running at http://localhost:${PORT}`);
});
