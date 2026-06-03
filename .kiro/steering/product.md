# Product Overview

A **multi-agent financial assistant** built on AWS Bedrock AgentCore, branded for NEXT Insurance and powered by CloudAge.

It provides personal finance guidance through an orchestrator pattern that routes queries to specialized sub-agents:

- **Budget Agent** — Budgeting, spending analysis, savings recommendations, and expense tracking. Produces structured financial reports using Pydantic models.
- **Financial Analysis Agent** — Stock research, portfolio creation, performance comparisons, and investment analysis using live market data from Yahoo Finance.

The orchestrator coordinates between these agents, retrieves relevant conversation history via AgentCore Memory, and streams responses. A Bedrock Guardrail blocks Bitcoin/cryptocurrency investment advice.

## Deployment

- **Backend:** Containerized on AWS Bedrock AgentCore (eu-north-1)
- **Frontend:** Next.js app on AWS Amplify, authenticated via Cognito
- **Auth:** Cognito USER_PASSWORD_AUTH with JWT tokens
- **Region:** eu-north-1
