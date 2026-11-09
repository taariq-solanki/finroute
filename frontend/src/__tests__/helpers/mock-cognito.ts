/**
 * Mock Cognito utilities for testing authentication flows.
 * Simulates InitiateAuth responses for sign-in, token refresh,
 * and various failure scenarios.
 */

export interface CognitoTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until access token expires
}

export interface CognitoAuthResult {
  AuthenticationResult: {
    AccessToken: string;
    IdToken: string;
    RefreshToken?: string;
    ExpiresIn: number;
    TokenType: string;
  };
}

export interface CognitoRefreshResult {
  AuthenticationResult: {
    AccessToken: string;
    IdToken: string;
    ExpiresIn: number;
    TokenType: string;
  };
}

export interface CognitoErrorResponse {
  __type: string;
  message: string;
}

/**
 * Default test tokens with predictable values for assertions.
 */
export const DEFAULT_TOKENS: CognitoTokens = {
  accessToken: "test-access-token-abc123",
  idToken: "test-id-token-def456",
  refreshToken: "test-refresh-token-ghi789",
  expiresIn: 3600, // 1 hour
};

/**
 * Creates a successful InitiateAuth response for USER_PASSWORD_AUTH or
 * USER_SRP_AUTH flows.
 */
export function createAuthSuccess(tokens: Partial<CognitoTokens> = {}): CognitoAuthResult {
  const merged = { ...DEFAULT_TOKENS, ...tokens };
  return {
    AuthenticationResult: {
      AccessToken: merged.accessToken,
      IdToken: merged.idToken,
      RefreshToken: merged.refreshToken,
      ExpiresIn: merged.expiresIn,
      TokenType: "Bearer",
    },
  };
}

/**
 * Creates a successful token refresh response.
 * Note: Cognito refresh responses do NOT include a new RefreshToken.
 */
export function createRefreshSuccess(
  tokens: Partial<Omit<CognitoTokens, "refreshToken">> = {}
): CognitoRefreshResult {
  const merged = { ...DEFAULT_TOKENS, ...tokens };
  return {
    AuthenticationResult: {
      AccessToken: merged.accessToken,
      IdToken: merged.idToken,
      ExpiresIn: merged.expiresIn,
      TokenType: "Bearer",
    },
  };
}

/**
 * Common Cognito error responses for testing failure scenarios.
 */
export const COGNITO_ERRORS = {
  notAuthorized: {
    __type: "NotAuthorizedException",
    message: "Incorrect username or password.",
  } as CognitoErrorResponse,

  userNotFound: {
    __type: "UserNotFoundException",
    message: "User does not exist.",
  } as CognitoErrorResponse,

  invalidRefreshToken: {
    __type: "NotAuthorizedException",
    message: "Invalid Refresh Token.",
  } as CognitoErrorResponse,

  expiredRefreshToken: {
    __type: "NotAuthorizedException",
    message: "Refresh Token has expired.",
  } as CognitoErrorResponse,

  tooManyRequests: {
    __type: "TooManyRequestsException",
    message: "Too many requests. Please try again later.",
  } as CognitoErrorResponse,

  internalError: {
    __type: "InternalErrorException",
    message: "An internal error has occurred.",
  } as CognitoErrorResponse,

  passwordResetRequired: {
    __type: "PasswordResetRequiredException",
    message: "Password reset required for the user.",
  } as CognitoErrorResponse,
};

/**
 * Installs a mock for Cognito InitiateAuth API calls made via fetch.
 * Returns a controller to configure responses for auth and refresh flows.
 *
 * @param cognitoEndpoint - The Cognito endpoint URL to intercept
 *
 * @example
 * ```ts
 * const cognito = installMockCognito();
 *
 * // Simulate successful sign-in
 * cognito.onSignIn(createAuthSuccess());
 * await signIn('user@example.com', 'password');
 *
 * // Simulate refresh failure
 * cognito.onRefresh(COGNITO_ERRORS.invalidRefreshToken, 400);
 * await getAccessToken(); // should trigger session expiry
 * ```
 */
export function installMockCognito(cognitoEndpoint = "https://cognito-idp.eu-north-1.amazonaws.com/") {
  const calls: { action: string; body: Record<string, unknown> }[] = [];
  let signInResponse: { body: unknown; status: number } | null = null;
  let refreshResponse: { body: unknown; status: number } | null = null;

  const originalFetch = global.fetch;

  const mockFetch = jest.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    // Only intercept Cognito requests
    if (!url.includes("cognito-idp") && url !== cognitoEndpoint) {
      if (originalFetch) {
        return originalFetch(url, options);
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    }

    const headers = options?.headers as Record<string, string> | undefined;
    const target = headers?.["X-Amz-Target"] || "";
    const body = options?.body ? JSON.parse(options.body as string) : {};

    let action = "unknown";
    if (target.includes("InitiateAuth")) {
      action = body.AuthFlow === "REFRESH_TOKEN_AUTH" ? "refresh" : "signIn";
    }

    calls.push({ action, body });

    let response: { body: unknown; status: number };

    if (action === "signIn" && signInResponse) {
      response = signInResponse;
    } else if (action === "refresh" && refreshResponse) {
      response = refreshResponse;
    } else {
      // Default: successful auth
      response = { body: createAuthSuccess(), status: 200 };
    }

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.status === 200 ? "OK" : "Error",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    } as unknown as Response;
  });

  global.fetch = mockFetch as unknown as typeof global.fetch;

  return {
    /** All recorded Cognito API calls */
    get calls() {
      return calls;
    },

    /** The underlying jest mock function */
    mock: mockFetch,

    /** Set the response for sign-in (InitiateAuth with USER_PASSWORD_AUTH) */
    onSignIn(body: CognitoAuthResult | CognitoErrorResponse, status = 200) {
      signInResponse = { body, status };
    },

    /** Set the response for token refresh (InitiateAuth with REFRESH_TOKEN_AUTH) */
    onRefresh(body: CognitoRefreshResult | CognitoErrorResponse, status = 200) {
      refreshResponse = { body, status };
    },

    /** Simulate a network timeout on the next Cognito request */
    simulateTimeout(timeoutMs = 10000) {
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Request timeout")), timeoutMs);
          })
      );
    },

    /** Simulate a network error on the next Cognito request */
    simulateNetworkError(message = "Failed to fetch") {
      mockFetch.mockRejectedValueOnce(new Error(message));
    },

    /** Reset all state */
    reset() {
      calls.length = 0;
      signInResponse = null;
      refreshResponse = null;
      mockFetch.mockClear();
    },

    /** Restore original fetch */
    restore() {
      global.fetch = originalFetch;
    },
  };
}
