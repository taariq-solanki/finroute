/*
 * ---------------------------------------------------------------------------
 * Runtime inbound JWT authorizer configuration.
 *
 * The AgentCore runtime is created by the bedrock-agentcore-starter-toolkit
 * (via deploy.sh), NOT modeled in this CDK app. This typed config documents
 * the Cognito-backed inbound JWT authorizer that deploy.sh applies at launch,
 * so a from-scratch deployment can reproduce the same authorizer settings.
 * The stack emits it as a CfnOutput for reference; CDK does not provision the
 * runtime itself.
 * ---------------------------------------------------------------------------
 */

/**
 * Typed shape of the AgentCore runtime inbound JWT authorizer configuration.
 */
export interface RuntimeJwtAuthorizerConfig {
  /** Cognito app client ids allowed to invoke the runtime */
  allowedClients: string[];
  /** OIDC discovery URL for the Cognito user pool */
  discoveryUrl: string;
}

/**
 * Build the custom JWT authorizer config for the toolkit-managed AgentCore runtime.
 *
 * @param region AWS region of the Cognito user pool (e.g. eu-north-1)
 * @param userPoolId Cognito user pool id
 * @param clientId Cognito app client id allowed to invoke the runtime
 * @returns the `customJWTAuthorizer` config consumed by the deploy path
 */
export function buildCustomJwtAuthorizer(
  region: string,
  userPoolId: string,
  clientId: string
): { customJWTAuthorizer: RuntimeJwtAuthorizerConfig } {
  return {
    customJWTAuthorizer: {
      allowedClients: [clientId],
      discoveryUrl: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/openid-configuration`,
    },
  };
}
