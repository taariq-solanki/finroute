/**
 * Auth Module - Secure Token Lifecycle Management
 *
 * Tokens are stored in a module-scoped closure (not exported, not on window,
 * not in localStorage) to mitigate XSS token theft.
 *
 * Features:
 * - In-memory token storage via closure
 * - Automatic token refresh when expiring within 30 seconds
 * - Refresh request coalescing (single in-flight refresh)
 * - Session expiry callback with conversation history preservation
 */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string; // ISO string for serialization
}

interface TokenState {
  // Captured from Cognito but intentionally NOT used as the AgentCore bearer;
  // the ID token (idToken) is sent as the Bearer instead.
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number; // UTC epoch seconds
  refreshExpiresAt: number; // UTC epoch seconds
}

// ─── Environment Configuration ───────────────────────────────────────────────

const REGION = process.env.NEXT_PUBLIC_COGNITO_REGION || "eu-north-1";
const CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "";
const USER_POOL_ID = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "";

// ─── Module-Scoped Closure State ─────────────────────────────────────────────
// Not accessible from document scope, window, or DevTools

let tokenState: TokenState | null = null;
let refreshPromise: Promise<string> | null = null;

// ─── Session Expiry Callback ─────────────────────────────────────────────────

/**
 * Settable callback invoked when session expires.
 * Receives serialized conversation messages (JSON string) stored to sessionStorage.
 * The application should set this to handle redirect + message preservation.
 */
let onSessionExpired: ((preservedMessages: string) => void) | null = null;

/**
 * Assign (or clear with null) the session-expiry callback. Exposed as a setter
 * because an ES-module imported binding cannot be reassigned from another module.
 */
export function setOnSessionExpired(
  callback: ((preservedMessages: string) => void) | null
): void {
  onSessionExpired = callback;
}

// ─── Helper: Parse JWT exp claim ─────────────────────────────────────────────

function parseJwtExpiry(token: string): number {
  try {
    const payloadBase64 = token.split(".")[1];
    // Handle base64url encoding (replace URL-safe chars and add padding)
    const base64 = payloadBase64.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(
      typeof atob !== "undefined"
        ? atob(base64)
        : Buffer.from(base64, "base64").toString("utf-8")
    );
    return payload.exp as number;
  } catch {
    // Default: token expires in 1 hour if we cannot parse
    return Math.floor(Date.now() / 1000) + 3600;
  }
}

// ─── Cognito Endpoint ────────────────────────────────────────────────────────

function getCognitoEndpoint(): string {
  return `https://cognito-idp.${REGION}.amazonaws.com/`;
}

// ─── signIn ──────────────────────────────────────────────────────────────────

/**
 * Authenticate with Cognito using USER_PASSWORD_AUTH flow.
 * Stores tokens in the module-scoped closure (not localStorage).
 */
export async function signIn(username: string, password: string): Promise<void> {
  const endpoint = getCognitoEndpoint();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.__type || "Authentication failed");
  }

  if (data.AuthenticationResult) {
    const { AccessToken, RefreshToken, IdToken, ExpiresIn } =
      data.AuthenticationResult;

    const now = Math.floor(Date.now() / 1000);

    tokenState = {
      accessToken: AccessToken,
      refreshToken: RefreshToken || "",
      idToken: IdToken || "",
      expiresAt: parseJwtExpiry(AccessToken),
      // Refresh tokens typically expire in 30 days; use ExpiresIn as fallback
      refreshExpiresAt: RefreshToken
        ? now + 30 * 24 * 3600
        : now + (ExpiresIn || 3600),
    };

    return;
  }

  throw new Error("Unexpected authentication response");
}

// ─── Token Refresh (Internal) ────────────────────────────────────────────────

/**
 * Perform a single token refresh against Cognito.
 * Returns the new ID token on success.
 * On failure, triggers session expiry flow.
 */
async function performRefresh(): Promise<string> {
  if (!tokenState || !tokenState.refreshToken) {
    throw new Error("No refresh token available");
  }

  const now = Math.floor(Date.now() / 1000);

  // Check if refresh token itself is expired
  if (now >= tokenState.refreshExpiresAt) {
    throw new Error("Refresh token expired");
  }

  const endpoint = getCognitoEndpoint();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: CLIENT_ID,
        AuthParameters: {
          REFRESH_TOKEN: tokenState.refreshToken,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.__type || "Token refresh failed");
    }

    if (data.AuthenticationResult) {
      const { AccessToken, IdToken } = data.AuthenticationResult;

      // Update token state in closure (refresh token stays the same)
      tokenState = {
        ...tokenState,
        accessToken: AccessToken,
        idToken: IdToken || tokenState.idToken,
        expiresAt: parseJwtExpiry(AccessToken),
      };

      return tokenState.idToken;
    }

    throw new Error("Unexpected refresh response");
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// ─── getIdToken ──────────────────────────────────────────────────────────────

/**
 * Get the current ID token, automatically refreshing if it expires
 * within the next 30 seconds. This is the token sent as the AgentCore bearer.
 *
 * Implements refresh coalescing: only one in-flight refresh at a time.
 * Additional callers await the same promise.
 */
export async function getIdToken(): Promise<string> {
  if (!tokenState) {
    handleSessionExpired();
    throw new Error("Not authenticated");
  }

  const now = Math.floor(Date.now() / 1000);
  const timeUntilExpiry = tokenState.expiresAt - now;

  // If token is valid and not expiring within 30 seconds, return it
  if (timeUntilExpiry > 30) {
    return tokenState.idToken;
  }

  // Token is expired or expiring soon - refresh needed
  // Coalesce: if a refresh is already in-flight, await it
  if (refreshPromise) {
    return refreshPromise;
  }

  // Start a new refresh and store the promise for coalescing
  refreshPromise = performRefresh()
    .then((newToken) => {
      refreshPromise = null;
      return newToken;
    })
    .catch((error) => {
      refreshPromise = null;
      handleSessionExpired();
      throw error;
    });

  return refreshPromise;
}

// ─── signOut ─────────────────────────────────────────────────────────────────

/**
 * Clear all in-memory token state. Does not call Cognito revoke endpoint.
 */
export function signOut(): void {
  tokenState = null;
  refreshPromise = null;
}

// ─── isAuthenticated ─────────────────────────────────────────────────────────

/**
 * Check if there is an active session (token state exists in closure).
 * Does NOT check token expiry - use getIdToken() for that.
 */
export function isAuthenticated(): boolean {
  return tokenState !== null;
}

// ─── Session Expiry Handling ─────────────────────────────────────────────────

/**
 * Handle session expiry:
 * 1. Serialize conversation history to sessionStorage (messages only, no tokens)
 * 2. Clear in-memory state
 * 3. Invoke the onSessionExpired callback
 */
function handleSessionExpired(): void {
  // Attempt to preserve conversation history from sessionStorage
  let preservedMessages = "[]";

  if (typeof window !== "undefined") {
    try {
      // Read current messages from the app's state via a known key
      const existingMessages = sessionStorage.getItem(
        "finance_advisor_messages"
      );
      if (existingMessages) {
        preservedMessages = existingMessages;
      }
    } catch {
      // sessionStorage may be unavailable (private browsing, quota exceeded)
    }
  }

  // Clear token state
  tokenState = null;
  refreshPromise = null;

  // Invoke callback if set
  if (onSessionExpired) {
    onSessionExpired(preservedMessages);
  }
}

/**
 * Preserve conversation messages to sessionStorage.
 * Call this from the UI layer whenever messages change so that
 * on session expiry the latest state is available.
 */
export function preserveConversationHistory(messages: ChatMessage[]): void {
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(
        "finance_advisor_messages",
        JSON.stringify(messages)
      );
    } catch {
      // Silently fail if sessionStorage is unavailable or quota exceeded
    }
  }
}

/**
 * Restore previously preserved conversation messages from sessionStorage.
 * Returns the messages array or null if nothing was preserved.
 */
export function restoreConversationHistory(): ChatMessage[] | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = sessionStorage.getItem("finance_advisor_messages");
    if (stored) {
      sessionStorage.removeItem("finance_advisor_messages");
      return JSON.parse(stored) as ChatMessage[];
    }
  } catch {
    // Silently fail
  }

  return null;
}
