#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ProductionHardeningStack } from "../lib/production-hardening-stack";

const app = new cdk.App();

// Staging environment
new ProductionHardeningStack(app, "ProductionHardening-Staging", {
  environment: "staging",
  region: "eu-north-1",
  accountId: process.env.CDK_DEFAULT_ACCOUNT || "123456789012",
  runtimeName: "personal_finance_agent",
  amplifyAppName: "finance-advisor-ui-staging",
  ecrRepositoryName: "finance-advisor-agent-staging",
  cognitoPoolName: "finance-advisor-users-staging",
  guardrailName: "finance-advisor-guardrail-staging",
});

// Production environment
new ProductionHardeningStack(app, "ProductionHardening-Production", {
  environment: "production",
  region: "eu-north-1",
  accountId: process.env.CDK_DEFAULT_ACCOUNT || "123456789012",
  runtimeName: "personal_finance_agent",
  amplifyAppName: "finance-advisor-ui",
  ecrRepositoryName: "finance-advisor-agent",
  cognitoPoolName: "finance-advisor-users",
  guardrailName: "finance-advisor-guardrail",
});
