# Frontend P1 & P2 Fixes — Verification

**Scope:** Two tasks only in `SourceCode/frontend` — Task 1 (P1 session-expiry wiring)
and Task 2 (P2 token naming/correctness). Smallest correct changes; no unrelated
refactors, dependency bumps, backend/Python edits, or `.env.local`/ARN/pool/client-id
changes. Token-in-memory (no localStorage) posture preserved.

## Iteration context

`SourceCode/.agents/tasks/p1-p2-review.json` exists, but it reviews a **prior,
unrelated** backend/infra P1/P2 iteration (Dockerfile, deploy.sh, CDK
`production-hardening-stack.ts`, `iam-roles.yaml`, `.bedrock_agentcore.yaml`),
verdict **APPROVED**, all findings `resolved`/`non-blocking`. It contains **no
findings** about the frontend `onSessionExpired` or `getAccessToken` tasks. The
live frontend source confirmed both issues were still present (callback unassigned,
getter still named `getAccessToken`). This was therefore implemented as the **first
iteration** of the frontend P1/P2 work, per `frontend/.agents-plan/p1-p2-fix-plan.md`.

## Task 1 (P1) — chosen option: OPTION A (wire it up)

Reason: the preserve/restore machinery already fully existed and was already active
(`preserveConversationHistory` runs on every `messages` change; `restoreConversationHistory`
runs on mount). The only missing piece was that nothing assigned the callback. Wiring
it completes an existing, half-built design rather than inventing behavior, and makes
expiry react to the callback (no send-first required). No router redirect added (single
static page); a `loggedIn=false` state flip plus a visible message is sufficient.

Changes:
- `src/lib/auth.ts`: `onSessionExpired` changed from an exported mutable `let` to a
  module-private `let` plus an exported `setOnSessionExpired(cb)` setter. (An ES-module
  imported binding cannot be reassigned from another module, so a setter is the correct
  mechanism; the plan's "assign onSessionExpired" intent is satisfied.)
- `pages/index.tsx`:
  - Added `const [sessionExpired, setSessionExpired] = useState(false)`.
  - Mount `useEffect` assigns the callback via `setOnSessionExpired(() => { setLoggedIn(false); setSessionExpired(true); })`
    and clears it (`setOnSessionExpired(null)`) on cleanup.
  - `handleSend` catch: replaced the misleading comment ("onSessionExpired callback
    handles redirect"); keeps `setLoggedIn(false)` and now also `setSessionExpired(true)`
    so the message shows even if expiry surfaces via the send path.
  - `handleLogin` clears the flag (`setSessionExpired(false)`) on successful sign-in.
  - Visible `role="alert"` banner "Your session expired, please sign in again." rendered
    above `<LoginForm>` (separate notice so it never clobbers a real `authError`).
- `styles/globals.css`: added a `.session-expired-banner` style (fixed top banner),
  matching the existing banner conventions.

No dead `onSessionExpired` import remains: `index.tsx` imports and uses
`setOnSessionExpired`.

## Task 2 (P2) — outcome: renamed, wire behavior UNCHANGED

VERIFY-THEN-ACT confirmed the default assumption: `getAccessToken()` and
`performRefresh()` return `tokenState.idToken`, and that ID token is sent as the
AgentCore `Bearer`. No evidence the authorizer expects the access token. On-the-wire
behavior kept byte-for-byte identical (still sends the ID token). Only names/docs fixed:
- `src/lib/auth.ts`: `getAccessToken` → `getIdToken` (declaration, section banner,
  JSDoc). `performRefresh` JSDoc "new access token" → "new ID token". `isAuthenticated`
  JSDoc reference updated to `getIdToken()`. Added a comment on the `accessToken` field
  in `TokenState` noting it is captured but intentionally NOT the bearer (ID token is).
  Field retained (removing it would touch unrelated assignment sites for no gain).
- `pages/index.tsx`: the single call site updated (`getAccessToken` → `getIdToken`;
  local var `accessToken` → `idToken`).
- `src/lib/agent.ts`: unchanged. The getter's return value is identical, so the Bearer
  is byte-for-byte the same. (`sendMessage`'s local `accessToken` parameter is a local
  name, out of scope.)

## Commands run (in `SourceCode/frontend`)

### `npm test` — PASS
```
Test Suites: 1 passed, 1 total
Tests:       29 passed, 29 total
```
Existing sanitizer suite (`src/lib/sanitizer.test.ts`) still green. No test changes made.

### `npm run build` (`next build`) — type-check PASS; build crashes in Next EOL internals (pre-existing/environmental)
Build reached and printed:
```
Linting and checking validity of types
Compiled successfully
Creating an optimized production build
Collecting page data
```
`grep -c "Type error"` on the full output = **0**. TypeScript type-checking and
compilation passed with zero type errors, confirming the renamed getter, the used
`setOnSessionExpired` import, and all types line up.

The build then fails during "Collecting page data" with:
```
.../node_modules/next/dist/compiled/jsonwebtoken/index.js
TypeError: Cannot read properties of undefined (reading 'prototype')
Error: Call retries were exceeded  (type: 'WorkerError')
```
This is a crash inside Next 12.3.4's bundled `jsonwebtoken` under modern Node
(`node v26.8.1`) — a known EOL-Next/Node incompatibility. It is NOT a type error and
NOT caused by this change: none of the edited files import `jsonwebtoken`, and the
crash is in Next's static-generation internals. Pre-existing/environmental.

### `npx tsc --noEmit` — 2 errors, both PRE-EXISTING in untouched test-helper scaffolding
```
src/__tests__/helpers/mock-cognito.ts:190:3 - error TS2322: ... global.fetch = mockFetch
src/__tests__/helpers/mock-fetch.ts:130:3   - error TS2322: ... global.fetch = mockFetch
```
Both are a `global.fetch` typing mismatch (`RequestInfo | URL` vs `string`) in the
unused `src/__tests__/helpers/` mocks. These files were NOT touched by this change and
are unrelated to Task 1/Task 2. (Next's `build` type-check does not include these helper
files, which is why `build` reported 0 type errors.) Out of scope to fix.

### Dead-reference / rename grep checks
`grep -rE "getAccessToken|onSessionExpired" **/*.{ts,tsx}`:
- No remaining `getAccessToken` call sites. Remaining matches are only JSDoc example
  comments in `src/__tests__/helpers/mock-timers.ts` and `mock-cognito.ts` (untouched,
  out of scope).
- `onSessionExpired` remains only as the module-private variable + its invocation in
  `auth.ts`'s `handleSessionExpired`, plus one JSDoc mention. No dead import in
  `index.tsx` (it imports/uses `setOnSessionExpired`).

## Net result

- Task 1: implemented via Option A. Session expiry now flips `loggedIn=false` and shows
  a visible "session expired" message immediately on callback, without requiring a send;
  preserved history round-trips via the existing restore-on-mount path.
- Task 2: renamed `getAccessToken` → `getIdToken` and fixed docs; wire token unchanged
  (still the Cognito ID token). No `send_message` warning needed — no evidence the
  authorizer expects the access token.
- Tests green (29/29); type-check clean for all in-scope files; the only failures are a
  pre-existing EOL-Next build crash and pre-existing test-helper type errors, neither
  caused by nor related to these changes.
