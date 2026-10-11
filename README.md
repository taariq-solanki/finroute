# Financial Advisor - Multi-Agent AI Platform

AI-powered financial assistant built on AWS Bedrock AgentCore with a Next.js frontend.
NEXT Insurance branding - Powered by CloudAge.

---

## Current Deployment (Staging)

| Resource | Value |
|----------|-------|
| AgentCore Runtime | `personal_finance_agent-mc5EysEAKi` |
| Memory | `personal_finance_agent_mem-35VQoI2mZl` (STM_ONLY) |
| Cognito Pool | `eu-north-1_3CoCO4SDy` |
| Cognito Client | `33rn8bdj5b8g7rusoqe2s7agfn` |
| Amplify App | `d3jywevc7tu25i` |
| Frontend URL | https://main.d3jywevc7tu25i.amplifyapp.com |
| CDK Stack | `ProductionHardening-Staging` |
| IAM Role | `agentcore-execution-personal_finance_agent-staging` |
| Guardrail | `g8sr2bf9cymw` (`finance-advisor-guardrail-staging`) |
| Region | `eu-north-1` |
| WAF WebACL | Deployed but NOT associated (eu-north-1 lacks Amplify Firewall) |

---

## Deployment Steps (ranked)

Run in order on a fresh account. Steps 5–7 (git/Amplify) are optional — use them for CI/CD builds instead of the manual `./deploy-frontend.sh` in step 4.

```bash
# 0. One-time prerequisites: AWS CLI configured for eu-north-1, Nova Pro model
#    access enabled in Bedrock, Python 3.12 + Node 18 available.
aws configure set region eu-north-1
aws sts get-caller-identity                 # confirm account & creds

# 1. Provision AWS resources (IAM role, Cognito, guardrail) + install deps
chmod +x setup.sh deploy.sh deploy-frontend.sh
./setup.sh

# 2. Verify the backend is green before deploying
source .venv/bin/activate && python -m pytest

# 3. Deploy the agent to AgentCore (builds/pushes container, rewrites .env.local)
./deploy.sh

# 4. Deploy the frontend to Amplify (manual static-export upload)
./deploy-frontend.sh

# --- OR, instead of step 4, use the Git-based Amplify build (steps 5-7) ---

# 5. Create the CodeCommit repo (once) and push
pipx install git-remote-codecommit        # one-time: CodeCommit git helper
aws codecommit create-repository --repository-name finance-advisor-frontend --region eu-north-1
git push origin main

# 6. In the Amplify console: New app -> Host web app -> AWS CodeCommit ->
#    pick finance-advisor-frontend + main branch (auto-detects amplify.yml,
#    which pins Node 18 for the build).

# 7. Set NEXT_PUBLIC_* env vars in Amplify (AgentCore endpoint from step 3,
#    plus Cognito pool/client/region) and trigger a build.

# Teardown: remove all AWS resources
./cleanup.sh
```

---

## Backend (Python)

### Prerequisites
- Python 3.12 (`brew install python@3.12` on macOS)
- AWS CLI v2 configured with `eu-north-1` region (`aws configure set region eu-north-1`)
- AWS account with the following enabled:
  - Amazon Nova Pro model access in Bedrock (eu-north-1) - enable via AWS Console -> Bedrock -> Model access
  - Permissions to create: IAM roles, Cognito user pools, ECR repos, CodeBuild projects, Secrets Manager secrets, Amplify apps, Bedrock AgentCore runtimes
- Node.js v18+ (for frontend)
- No Docker required (CodeBuild handles container builds in the cloud)

### Quick Start (Fresh Account)

```bash
chmod +x setup.sh deploy.sh deploy-frontend.sh
./setup.sh            # Sets up Python env, IAM roles, Cognito, guardrail, frontend deps
./deploy.sh           # Deploys agent to AgentCore Runtime (~5 min first time)
./deploy-frontend.sh  # Builds frontend & deploys to Amplify
```

### Retrieve Login Credentials

```bash
source .venv/bin/activate
python3 -c "from utils import retrieve_credentials_from_secrets_manager; print(retrieve_credentials_from_secrets_manager())"
```

### Run locally

```bash
source .venv/bin/activate
python3 -m main
```

### Run with OpenTelemetry (production mode)

```bash
opentelemetry-instrument python3 -m main
```

### Deploy to AgentCore

```bash
./deploy.sh
```

### Create Cognito user pool & credentials

```python
from utils import setup_cognito_user_pool
result = setup_cognito_user_pool()
```

### Retrieve stored credentials

```python
from utils import retrieve_credentials_from_secrets_manager
creds = retrieve_credentials_from_secrets_manager()  # Auto-discovers the secret
print(f"Username: {creds['username']}")
print(f"Password: {creds['password']}")
```

### Build Docker image

```bash
docker build -t finance-assistant .
docker run -p 8080:8080 -p 8000:8000 finance-assistant
```

---

## Frontend (Next.js)

### Prerequisites
- Node.js (any recent version)
- Backend deployed to AgentCore (or running locally)

### Setup

```bash
cd frontend
npm install
```

### Configure environment

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_AGENTCORE_ENDPOINT=https://bedrock-agentcore.eu-north-1.amazonaws.com/runtimes/YOUR_ENCODED_ARN/invocations
NEXT_PUBLIC_COGNITO_USER_POOL_ID=eu-north-1_XXXXXXXXX
NEXT_PUBLIC_COGNITO_CLIENT_ID=your-client-id
NEXT_PUBLIC_COGNITO_REGION=eu-north-1
```

### Run development server

```bash
npm run dev -- -p 3001
```

Open http://localhost:3001

### Build for production

```bash
npm run build
npm run start
```

### Deploy to AWS Amplify

```bash
cd ..
./deploy-frontend.sh
```

This builds the frontend as a static export, creates an Amplify app, and deploys automatically (no Docker or CodeCommit push required).

---

## Infrastructure (CDK)

The `infra/` directory contains AWS CDK (TypeScript) for production hardening:

```bash
cd infra
npm install
npx cdk deploy ProductionHardening-Staging
```

### Key CDK constructs:

| Construct | Purpose |
|-----------|---------|
| `iam-construct.ts` | Least-privilege execution role (Converse API, Guardrails, ECR, Logs) |
| `waf-construct.ts` | WAF WebACL with rate limiting, body size, managed rules |
| `production-hardening-stack.ts` | Main stack: Cognito, ECR, CodeBuild, Amplify, Guardrail, S3 |

### IAM Policy (post-deployment corrections)

The IAM policy was updated during deployment to fix runtime issues:

- Added `bedrock:Converse` and `bedrock:ConverseStream` (Strands SDK uses Converse API, not InvokeModel)
- Added `bedrock:ApplyGuardrail`, `bedrock:ListGuardrails`, `bedrock:GetGuardrail`
- Added ECR access for toolkit-created repo `bedrock-agentcore-personal_finance_agent`
- Removed the `DenyBedrockOutsideRegion` statement (`aws:RequestedRegion` condition key is not populated for ConverseStream, causing false denies)

### WAF Note

The WAF WebACL is deployed and logging blocked requests, but is NOT associated with the Amplify app. Amplify Firewall integration is not available in eu-north-1. When support is added, update `amplifyAppArn` in `production-hardening-stack.ts`.

---

## Production-Hardening Changes

Key code fixes applied during deployment to AgentCore:

### Lazy initialization (AgentCore container compatibility)
- `utils/guardrail.py` - boto3 clients initialized via `_get_bedrock_client()` / `_get_bedrock_runtime()` functions (not module-level) to avoid import-time AWS calls
- `request_factory.py` - BedrockModel initialized via `_get_bedrock_model()` function (not module-level)

### Authentication fix
- `deploy.sh` - the runtime is configured with a `customJWTAuthorizer` scoped to the Cognito pool (`allowedClients=[<app client id>]`, Cognito OIDC `discoveryUrl`)
- `frontend/src/lib/auth.ts` - `getAccessToken()` returns the Cognito **access token** as the bearer. AgentCore's `customJWTAuthorizer` validates the access token's `client_id` claim against `allowedClients`; a Cognito ID token carries the client id in `aud` (no `client_id` claim) and is rejected with 401, so the access token is the correct bearer

### SSE streaming fix
- `frontend/src/lib/agent.ts` - `finalize()` treats stream end without `[DONE]` marker as normal completion (AgentCore does not send `[DONE]`)

### Guardrail discovery
- `utils/guardrail.py` - `get_guardrail_id()` searches for multiple names: `finance-advisor-guardrail-staging`, `finance-advisor-guardrail-production`, `guardrail-no-bitcoin-advice`

### Container security
- `Dockerfile` - Added `apt-get update && apt-get upgrade` to patch system CVEs (perl, gnutls28, openssl)

### Error handling
- `main.py` - Safe-by-default: unhandled exceptions return a generic `"An internal error occurred. Please try again."` to the client. Set `DEBUG_ERRORS=1` to opt into the detailed `f"Error: {type(exc).__name__}: {str(exc)[:200]}"` for staging debugging. Full detail is always written to the logs regardless.

### Script fixes
- `deploy.sh` / `deploy-frontend.sh` / `setup.sh` / `cleanup.sh` - Standardized inline Python invocations to `python3` and hardened shell→Python heredocs (values passed via the environment instead of string interpolation)
- `deploy.sh` - On a fresh account, `execution_role` uses the setup-created role `AmazonBedrockAgentCoreSDKRuntime-<region>`. (The live staging environment above was provisioned via CDK and therefore shows the CDK-created role `agentcore-execution-personal_finance_agent-staging`.)

### Testing
- `conftest.py` - Root-level conftest that mocks `bedrock_agentcore` for local pytest runs

---

## Scripts

| Script | Description |
|--------|-------------|
| `./setup.sh` | Full project setup (Python env, IAM roles, Cognito, guardrail, frontend deps) |
| `./deploy.sh` | Deploy backend agent to AgentCore Runtime via CodeBuild |
| `./deploy-frontend.sh` | Build & deploy frontend to AWS Amplify (static export) |
| `./cleanup.sh` | Remove all AWS resources (AgentCore, Cognito, ECR, IAM, Amplify) |

## Jupyter Notebooks (POC Demo)

Run these in order for a step-by-step walkthrough:

| Notebook | Description |
|----------|-------------|
| `AWS_SingleAgent.ipynb` | Build a single Strands agent with budget analysis |
| `AWS_MultiAgent.ipynb` | Build multi-agent orchestrator with investment analysis |
| `AWS_Deployment.ipynb` | Deploy to AgentCore Runtime with Cognito, Memory & Guardrails |
| `AWS_CleanUp.ipynb` | Tear down all AWS resources |

---

## Architecture

```
User -> Frontend (Next.js / Amplify)
         | Bearer token (Cognito access token) + SSE
         v
       AgentCore Runtime (eu-north-1)
         | customJWTAuthorizer validates `client_id` claim
         v
       Orchestrator Agent (main.py)
         |-- Budget Agent (budget_agent.py)
         |-- Financial Analysis Agent (financial_analysis_agent.py)
         |
       Bedrock Guardrail (blocks crypto/bitcoin advice)
       AgentCore Memory (STM_ONLY - cross-session persistence)
```

- **Model:** Amazon Nova Pro (`eu.amazon.nova-pro-v1:0`) via Converse API
- **Auth:** Cognito USER_PASSWORD_AUTH (access token for AgentCore `client_id` JWT validation)
- **Guardrail:** Blocks Bitcoin/crypto investment advice (`finance-advisor-guardrail-staging`)
- **Memory:** AgentCore Memory (STM_ONLY mode)
- **Container:** ARM64/Graviton via CodeBuild, `ghcr.io/astral-sh/uv:python3.12-bookworm-slim` base
- **WAF:** WebACL deployed (rate limit 100/5min, body 8KB, AWS managed rules) - not yet associated
