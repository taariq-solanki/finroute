# Tech Stack

## Language & Runtime
- Python 3.12 (backend)
- TypeScript / Next.js 12 (frontend)

## Backend Libraries
- **strands-agents 1.7.1** — Agent framework (Agent, tool decorator, BedrockModel)
- **strands-agents-tools 0.2.6** — Built-in tool library (calculator, etc.)
- **bedrock-agentcore 0.1.3** — AgentCore app framework and memory client
- **bedrock-agentcore-starter-toolkit 0.1.10** — Deployment scaffolding
- **pydantic 2.11.7** — Data validation and structured output models
- **yfinance 0.2.65** — Live stock market data
- **matplotlib** — Chart visualization
- **pandas** — Data manipulation
- **boto3** — AWS SDK (Bedrock, Cognito, Secrets Manager)

## Frontend Libraries
- **next 12.3.4** — React framework (Pages Router)
- **react 18.2.0** — UI library
- **react-markdown 6.0.3** — Markdown rendering (CommonJS compatible)
- Plain CSS (no Tailwind, no PostCSS)

## Infrastructure
- **AWS Bedrock** — LLM provider (model: `eu.amazon.nova-pro-v1:0`)
- **AWS Bedrock AgentCore** — Backend deployment with memory + auth
- **AWS Amplify** — Frontend hosting (auto-deploys from CodeCommit)
- **AWS CodeCommit** — Git repository
- **AWS Cognito** — User authentication (USER_PASSWORD_AUTH)
- **AWS Secrets Manager** — Credential storage
- **Docker** — Container (Python 3.12 slim, ARM64, via astral-sh/uv)
- **OpenTelemetry** — Observability instrumentation

## Package Management
- **uv** — Python dependency resolver
- **npm** — Frontend package manager

## Common Commands

```bash
# === Backend ===
source .venv/bin/activate
pip install -r requirements.txt       # Install Python deps
python -m main                        # Run locally
opentelemetry-instrument python -m main  # Run with tracing

# === Frontend ===
cd frontend
npm install                           # Install Node deps
npm run dev -- -p 3001                # Local dev server
npm run build                         # Production build

# === Docker ===
docker build -t finance-assistant .
docker run -p 8080:8080 finance-assistant

# === Deployment ===
./setup.sh                            # Full project setup
./deploy.sh                           # Deploy backend to AgentCore
./deploy-frontend.sh                  # Deploy frontend to Amplify
./cleanup.sh                          # Remove all AWS resources
```

## Jupyter Notebooks
Phase notebooks (`AWS_SingleAgent.ipynb`, `AWS_MultiAgent.ipynb`, `AWS_Deployment.ipynb`) are used for guided exercises. `AWS_CleanUp.ipynb` handles resource teardown.
