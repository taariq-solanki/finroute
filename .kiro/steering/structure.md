# Project Structure

```
.
├── main.py                        # Orchestrator agent + AgentCore entrypoint
├── budget_agent.py                # Budget/spending sub-agent with structured output
├── financial_analysis_agent.py    # Investment/stock analysis sub-agent
├── utils/
│   ├── __init__.py                # Public API exports
│   ├── agentcore_utils.py         # Cognito user pool setup, auth, cleanup
│   ├── guardrail.py               # Bedrock Guardrail CRUD (Bitcoin advice filter)
│   └── message_formatter.py       # Conversation history display helpers
├── frontend/
│   ├── pages/
│   │   ├── _app.tsx               # App wrapper with global CSS
│   │   └── index.tsx              # Main chat page (auth + streaming)
│   ├── src/
│   │   ├── components/            # ChatInput, ChatMessage, LoginForm
│   │   └── lib/                   # auth.ts (Cognito), agent.ts (AgentCore API)
│   ├── styles/globals.css         # Plain CSS design system
│   ├── next-env.d.ts              # TypeScript declarations
│   ├── next.config.js             # Next.js config
│   ├── tsconfig.json              # TypeScript config
│   ├── package.json               # Next.js 12, react-markdown 6
│   └── README.md                  # Full setup and deployment guide
├── images/                        # Architecture diagrams
├── .kiro/steering/                # Steering rules for AI assistant
├── setup.sh                       # Full project setup automation
├── deploy.sh                      # Backend → AgentCore deployment
├── deploy-frontend.sh             # Frontend → AWS Amplify deployment
├── cleanup.sh                     # AWS resource teardown
├── amplify.yml                    # Amplify build config (appRoot: frontend)
├── Dockerfile                     # Production container (Python 3.12, ARM64)
├── .bedrock_agentcore.yaml        # AgentCore deployment config
├── .gitignore                     # Excludes .venv, node_modules, .next, etc.
├── requirements.txt               # Pinned Python dependencies
├── AWS_SingleAgent.ipynb          # Phase 1: Single agent
├── AWS_MultiAgent.ipynb           # Phase 2: Multi-agent orchestration
├── AWS_Deployment.ipynb           # Phase 3: AgentCore deployment
└── AWS_CleanUp.ipynb              # Resource cleanup notebook
```

## Architecture Pattern

- **Orchestrator pattern** — `main.py` delegates to sub-agents via `@tool`-wrapped functions.
- **Sub-agents as tools** — Each sub-agent is a standalone `Agent` instance exposed through a tool function.
- **Structured output** — Budget agent uses Pydantic models with `agent.structured_output()`.
- **Streaming** — Orchestrator uses `agent.stream_async()` for chunked delivery via AgentCore.
- **Frontend** — Next.js 12 (Pages Router) with plain CSS, Cognito auth, SSE streaming.

## Conventions

- Each agent file defines its own `BedrockModel`, system prompt, tools, and `Agent` instance at module level.
- Tools use the `@tool` decorator from strands-agents.
- All tools include input validation and return user-friendly error messages prefixed with ❌.
- Logging uses Python's `logging` module with a standard format.
- AWS region resolves dynamically via `boto3.Session().region_name`.
- `utils/` re-exports its public API through `__init__.py`.
- Frontend uses plain CSS (no Tailwind/PostCSS) for Next.js 12 compatibility.
- Cognito auth uses USER_PASSWORD_AUTH flow (not SRP).
- AgentCore session IDs must be at least 33 characters.
- `<thinking>` tags from the model are stripped client-side before rendering.
