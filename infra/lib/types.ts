import * as cdk from "aws-cdk-lib";

/**
 * Configuration properties for the Production Hardening CDK stack.
 * Parameterized to support both staging and production environments
 * from a single template.
 */
export interface ProductionHardeningStackProps extends cdk.StackProps {
  /** Deployment environment - determines resource naming and configuration */
  environment: "staging" | "production";

  /** AWS region for all resources (e.g., eu-north-1) */
  region: string;

  /** AWS account ID for resource ARN construction */
  accountId: string;

  /** AgentCore Runtime name (e.g., personal_finance_agent) */
  runtimeName: string;

  /** Amplify application name (e.g., finance-advisor-ui) */
  amplifyAppName: string;

  /** ECR repository name for agent container images */
  ecrRepositoryName: string;

  /** Cognito User Pool name */
  cognitoPoolName: string;

  /** Bedrock Guardrail name */
  guardrailName: string;
}
