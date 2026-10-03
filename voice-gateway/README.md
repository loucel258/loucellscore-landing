# voice-gateway

Always-on Node service that holds the WebSocket for each phone call from Twilio ConversationRelay and, per caller turn, calls the app's signed endpoint `POST {APP_URL}/api/agent/{slug}/voice/turn`, streaming the NDJSON reply back to Twilio as `text` tokens. Contract: `../docs/voice-architecture.md`.

## Env vars
| Var | Required | Notes |
|---|---|---|
| `VOICE_GATEWAY_SECRET` | yes | Same value as the app. Service refuses to start without it. |
| `APP_URL` | yes | e.g. `https://www.loucellscore.com` |
| `PORT` | no | default 8080 |

## How Twilio connects
The app's `/voice/incoming` returns TwiML `<Connect><ConversationRelay url="wss://<gateway>/relay">` with `<Parameter name="slug">` and `<Parameter name="ticket">`. The `setup` message carries them in `customParameters`.

Ticket format (the app mints exactly this, `src/lib/voice/auth.ts`): `base64url(JSON{slug,callSid,from,to,verified,maxMin,nonce,exp}) + "." + hex(HMAC_SHA256(key, base64urlPayload))`, `exp` = unix seconds, at most 120 s ahead; key = HKDF-SHA256(secret, salt "", info `loucells/voice-gateway/v1`, 32 bytes). The gateway checks: signature, expiry, `slug` equals the `slug` parameter, `callSid` equals the setup message's CallSid, and the nonce was never used (single use). Caller `from`/`to` and `verified` (SHAKEN/STIR attestation A) come from the ticket, which the app minted from the Twilio-signed webhook; the setup message is not trusted for them.

## Mapping
- `setup` -> `event:"start"` (welcome from the app). `prompt` (only `last:true`; partials ignored) -> `utterance` with `lang` ("en"/"es" from the BCP-47 code). `dtmf` -> `dtmf`. `interrupt` -> abort in-flight turn; `utteranceUntilInterrupt` is sent as `interruptedAgentText` on the next turn. Socket close -> `end` (fire and forget, 3 s).
- `text` -> `{type:"text",token,last:false}`; `end_turn` -> `{type:"text",token:"",last:true}`; `language` -> `{type:"language",ttsLanguage,transcriptionLanguage}` (en-US / es-US); `handoff` -> flush then `{type:"end",handoffData:'{"reason","target"}'}`; `hangup` -> flush then `{type:"end"}`.
- Error line, non-200, truncated stream, 8 s to first byte, 30 s total -> fixed fallback line in the call language.
- Silence: after the agent finishes (estimated playback at ~14 chars/s + 10 s), "Are you still there?" once; a second silence -> goodbye line and `end`. Caller speech resets it.
- Hard cap: the call ends with a goodbye line one minute after the ticket's `maxMin`.
- `end` (handoff, hangup, wrap-up) is sent after the last words have had time to play, so "I'm connecting you" is never cut off.
- Turn body adds `slug` and `callerVerified` (from the ticket) to every request.

## Run locally
```
npm install
VOICE_GATEWAY_SECRET=dev APP_URL=http://localhost:3000 npm run build && npm start
# expose with a tunnel (ngrok http 8080) and point ConversationRelay at wss://<tunnel>/relay
npm test && npm run typecheck
```
Docker: `docker build -t voice-gateway .`; Fly: copy `fly.toml.example` to `fly.toml` (two always-on machines in `iad`, rolling deploys, `kill_timeout = 300`).

## Deploys never hang up on a caller
On SIGTERM the gateway drains: `/health` returns 503 (the platform routes new calls to the other machine), new WebSocket upgrades get 503, and live calls continue until they end or 280 s pass. Then it exits.

## What it does NOT do
No business logic, no model calls, no database, no transcript storage. Logs are JSON lifecycle events keyed by callSid; phone numbers are masked to the last 4 and transcripts are never logged. Does not tell the app a prior turn failed (the contract has no field for it).
