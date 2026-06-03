export interface AuthTokens {
  accessToken: string;
}

const REGION = process.env.NEXT_PUBLIC_COGNITO_REGION || "eu-north-1";
const CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "";
const USER_POOL_ID = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "";

/**
 * Sign in using USER_PASSWORD_AUTH flow (InitiateAuth API directly).
 */
export async function signIn(
  username: string,
  password: string
): Promise<AuthTokens> {
  const endpoint = `https://cognito-idp.${REGION}.amazonaws.com/`;

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
    throw new Error(
      data.message || data.__type || "Authentication failed"
    );
  }

  if (data.AuthenticationResult) {
    const tokens: AuthTokens = {
      accessToken: data.AuthenticationResult.AccessToken,
    };

    // Store in localStorage for session persistence
    if (typeof window !== "undefined") {
      localStorage.setItem("finance_auth", JSON.stringify(tokens));
    }

    return tokens;
  }

  throw new Error("Unexpected authentication response");
}

/**
 * Get current session from localStorage.
 */
export async function getCurrentSession(): Promise<AuthTokens | null> {
  if (typeof window === "undefined") return null;

  const stored = localStorage.getItem("finance_auth");
  if (!stored) return null;

  try {
    return JSON.parse(stored) as AuthTokens;
  } catch {
    return null;
  }
}

/**
 * Sign out by clearing stored tokens.
 */
export function signOut(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("finance_auth");
  }
}
