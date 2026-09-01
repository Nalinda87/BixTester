# Pega BIX Extraction Console

A small local web UI for calling the Pega BIX Extraction `register` and `connect`
APIs: register a caller, then stream the continuous JSON output from `connect`
in the browser.

Built against the endpoints described in the accompanying Postman collection:

- `POST /api/extract/v1/registration` — register a caller against a target application/object.
- `GET /api/extract/v1/connect/{registerID}` — long-lived streaming connection that emits JSON.

Both calls require an OAuth2 `client_credentials` token from Pega.

## Why there's a backend

The browser can't safely hold your OAuth client secret, and Pega's endpoints
aren't CORS-enabled for arbitrary origins, so a small Node/Express server
(`server.js`) proxies both calls: it fetches (and caches) the OAuth token
server-side, forwards `register`, and relays the `connect` stream to the page
chunk-by-chunk as it arrives.

## Setup

```bash
npm install
npm start
```

Then open http://localhost:4173

## Usage

1. Fill in **Connection**: Base URL, Access Token URL, Client ID, Client Secret.
   These are saved only in your browser's local storage and sent to the local
   proxy server on each request — never committed to source control.
2. Edit the **Register** request body JSON and click **Register**. On success
   the app tries to auto-fill the Register ID from the response; adjust
   `public/app.js` if your Pega instance uses a different response field name
   for the ID.
3. Click **Start streaming** under **Connect** to open the stream; output is
   appended live, pretty-printed when it's valid JSON. **Stop** cancels it.

## Notes

- No credentials are hardcoded in this repo — the connection fields are blank
  placeholders in `public/index.html`.
- `Pega.postman_collection.json` (if present locally) contains real
  credentials for a specific Pega instance and is gitignored; keep it local.
