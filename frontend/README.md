# Financial Advisor — Multi-Agent AI Platform

AI-powered financial assistant built on AWS Bedrock AgentCore with a Next.js frontend.
NEXT Insurance branding · Powered by CloudAge.

---

## Backend (Python)

### Prerequisites
- Python 3.12
- AWS CLI configured with `eu-north-1` region
- Amazon Nova Pro model access enabled in Bedrock

### Setup

```bash
# Create virtual environment
python3.12 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
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
from utils.agentcore_utils import retrieve_credentials_from_secrets_manager
creds = retrieve_credentials_from_secrets_manager("agentcore-project-credentials-XXXXXXXX")
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

This handles CodeCommit push, Amplify app creation, and deployment automatically.

---

## Scripts

| Script | Description |
|--------|-------------|
| `./setup.sh` | Full project setup (Python env, IAM roles, Cognito, guardrail, frontend) |
| `./deploy.sh` | Deploy backend agent to AgentCore |
| `./deploy-frontend.sh` | Deploy frontend to AWS Amplify |
| `./cleanup.sh` | Remove all AWS resources |

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
