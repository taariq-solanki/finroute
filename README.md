# Financial Advisor — Multi-Agent AI Platform

AI-powered financial assistant built on AWS Bedrock AgentCore with a Next.js frontend.
NEXT Insurance branding · Powered by CloudAge.

---

## Backend (Python)

### Prerequisites
- Python 3.12 (`brew install python@3.12` on macOS)
- AWS CLI v2 configured with `eu-north-1` region (`aws configure set region eu-north-1`)
- AWS account with the following enabled:
  - Amazon Nova Pro model access in Bedrock (eu-north-1) — enable via AWS Console → Bedrock → Model access
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
python -c "from utils import retrieve_credentials_from_secrets_manager; print(retrieve_credentials_from_secrets_manager())"
```

### Run locally

```bash
source .venv/bin/activate
python -m main
```

### Run with OpenTelemetry (production mode)

```bash
opentelemetry-instrument python -m main
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
User → Frontend (Next.js / Amplify)
         ↓ Bearer token + SSE
       AgentCore Runtime (eu-north-1)
         ↓
       Orchestrator Agent (main.py)
         ├── Budget Agent (budget_agent.py)
         └── Financial Analysis Agent (financial_analysis_agent.py)
```

- **Model:** Amazon Nova Pro (`eu.amazon.nova-pro-v1:0`)
- **Auth:** Cognito USER_PASSWORD_AUTH
- **Guardrail:** Blocks Bitcoin/crypto investment advice
- **Memory:** AgentCore Memory for conversation persistence
