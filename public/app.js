const $ = (id) => document.getElementById(id);

const configFields = ['baseURL', 'accessTokenUrl', 'clientId', 'clientSecret'];
const STORAGE_KEY = 'bix-console-config';

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const field of configFields) {
      if (saved[field]) $(field).value = saved[field];
    }
  } catch {
    // ignore corrupt storage
  }
}

function saveConfig() {
  const cfg = {};
  for (const field of configFields) cfg[field] = $(field).value.trim();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  return cfg;
}

configFields.forEach((field) => $(field).addEventListener('change', saveConfig));
loadConfig();

// --- Token refresh ---

$('refreshTokenBtn').addEventListener('click', async () => {
  const cfg = saveConfig();
  const tokenStatus = $('tokenStatus');
  $('refreshTokenBtn').disabled = true;
  tokenStatus.textContent = 'Requesting new token…';
  try {
    const resp = await fetch('/api/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    const data = await resp.json();
    if (data.ok) {
      const expires = data.expiresAt ? new Date(data.expiresAt).toLocaleTimeString() : 'unknown';
      tokenStatus.textContent = `New token ${data.tokenPreview} acquired, expires ${expires}`;
    } else {
      tokenStatus.textContent = `Failed: ${data.error}`;
    }
  } catch (e) {
    tokenStatus.textContent = `Failed: ${e.message}`;
  } finally {
    $('refreshTokenBtn').disabled = false;
  }
});

function setStatus(text, cls) {
  const pill = $('status-pill');
  pill.textContent = text;
  pill.className = `pill ${cls}`;
}

function appendLine(container, text, cls) {
  const div = document.createElement('div');
  div.className = `line${cls ? ' ' + cls : ''}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// --- Register ---

$('registerBtn').addEventListener('click', async () => {
  const cfg = saveConfig();
  const out = $('registerOutput');
  out.textContent = '';
  let payload;
  try {
    payload = JSON.parse($('registerBody').value);
  } catch (e) {
    out.textContent = `Invalid JSON in request body: ${e.message}`;
    return;
  }

  $('registerBtn').disabled = true;
  setStatus('registering…', 'busy');
  try {
    const resp = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cfg, payload }),
    });
    const data = await resp.json();
    out.textContent = JSON.stringify(data, null, 2);

    if (data.ok) {
      setStatus('registered', 'connected');
      const body = data.body || {};
      const candidate = body.ID || body.registerID || body.id || body.RegisterID || body.extractID;
      if (candidate) $('registerID').value = candidate;
    } else {
      setStatus('register failed', 'error');
    }
  } catch (e) {
    out.textContent = `Request failed: ${e.message}`;
    setStatus('error', 'error');
  } finally {
    $('registerBtn').disabled = false;
  }
});

// --- Connect (stream) ---

let currentReader = null;
let currentController = null;

function tryAppendJsonAware(container, chunkText) {
  const trimmed = chunkText.trim();
  if (!trimmed) return;
  // Chunk may contain one or more JSON objects/lines; split conservatively on newlines.
  const parts = trimmed.split(/\r?\n/).filter(Boolean);
  for (const part of parts) {
    try {
      const parsed = JSON.parse(part);
      appendLine(container, JSON.stringify(parsed, null, 2));
    } catch {
      appendLine(container, part);
    }
  }
}

async function startConnect() {
  const cfg = saveConfig();
  const registerID = $('registerID').value.trim();
  const out = $('streamOutput');

  if (!registerID) {
    appendLine(out, 'Set a Register ID first (run Register, or paste one).', 'err');
    return;
  }

  const params = new URLSearchParams({ ...cfg, registerID });
  $('connectBtn').disabled = true;
  $('disconnectBtn').disabled = false;
  setStatus('connecting…', 'busy');

  currentController = new AbortController();
  try {
    const resp = await fetch(`/api/connect?${params.toString()}`, {
      signal: currentController.signal,
    });

    if (!resp.ok || !resp.body) {
      const data = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      appendLine(out, `Connect failed: ${data.error || resp.status}`, 'err');
      setStatus('error', 'error');
      return;
    }

    setStatus('streaming', 'connected');
    const reader = resp.body.getReader();
    currentReader = reader;
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      tryAppendJsonAware(out, text);
    }
    setStatus('stream ended', 'idle');
  } catch (e) {
    if (e.name !== 'AbortError') {
      appendLine(out, `Stream error: ${e.message}`, 'err');
      setStatus('error', 'error');
    } else {
      setStatus('stopped', 'idle');
    }
  } finally {
    currentReader = null;
    currentController = null;
    $('connectBtn').disabled = false;
    $('disconnectBtn').disabled = true;
  }
}

$('connectBtn').addEventListener('click', startConnect);

$('disconnectBtn').addEventListener('click', () => {
  if (currentController) currentController.abort();
  if (currentReader) currentReader.cancel().catch(() => {});
});

$('clearBtn').addEventListener('click', () => {
  $('streamOutput').textContent = '';
});
