# P1 & P2 Deploy-Readiness Fixes — Verification Evidence

Iteration: FIRST (no `.agents/tasks/p1-p2-review.json` present).
All commands run from the project root
`/Users/cloudageglobal/Desktop/Ai_ML_GenAI_GenBI_AgenticAi_MultiAgentAi_HarnessEngineering/AgenticAI/StrandsSubAgents/SourceCode`
unless noted. Recreated venv is `.venv` (CPython 3.12.14, provisioned by uv).

---

## P1.1 — Dockerfile base image pinned to Python 3.12

- Edit: `Dockerfile` line 1 changed from `ghcr.io/astral-sh/uv:python3.13-bookworm-slim`
  to `ghcr.io/astral-sh/uv:python3.12-bookworm-slim`. Only the Python minor version in
  the tag changed; no other instruction was touched by this edit.
- Tag validity: confirmed `python3.12-bookworm-slim` is a published variant of the
  astral-sh/uv image family (Docker Hub `astral/uv` mirror lists the exact
  `python3.12-bookworm-slim` tag). Content was rephrased for compliance with licensing
  restrictions.
- Docker not run locally (no local build in this environment); evidence is the targeted
  single-line tag edit plus the passing 3.12 test run below, confirming the 3.12 runtime
  is consistent with `pyproject.toml` (`requires-python = ">=3.12"`).

## P1.2 — Working Python 3.12 venv + test suite RUN

Interpreter provisioning:
```
uv --version            -> uv 0.12.5
which python3.12         -> not found (system)
.venv/pyvenv.cfg (old)  -> home=/opt/homebrew/opt/python@3.12/bin (removed interpreter) — DEAD
uv python install 3.12  -> Installed Python 3.12.14 (cpython-3.12.14-macos-aarch64)
uv python find 3.12     -> ~/.local/share/uv/python/cpython-3.12-macos-aarch64-none/bin/python3.12
```

Venv recreation + deps:
```
uv venv --python 3.12 --clear .venv   -> Using CPython 3.12.14; created
uv pip install -r requirements.txt -r requirements-test.txt   -> OK (all resolved/installed)
```

Test run — plain command named in the instructions:
```
source .venv/bin/activate && python -m pytest
-> 95 passed in 10.68s
```
`pyproject.toml` has NO `addopts`, so plain `python -m pytest` does not enable
coverage; it exits 0 with all 95 tests passing.

Test run WITH coverage (to exercise the `fail_under=80` gate):
```
python -m pytest --cov --cov-report=term-missing
-> 95 passed in 41.92s
-> CoverageWarning: Module main was never imported (module-not-imported)
-> ERROR: Coverage failure: total of 49.74 is less than fail-under=80.00

Name                          Stmts   Miss   Cover
budget_agent.py                  52      6  88.46%
config.py                        51     15  70.59%
financial_analysis_agent.py     112     19  83.04%
input_sanitizer.py               28      0 100.00%
request_factory.py               91     28  69.23%
utils/__init__.py                 4      0 100.00%
utils/agentcore_utils.py        106     96   9.43%
utils/guardrail.py               57     49  14.04%
utils/message_formatter.py       84     81   3.57%
TOTAL                           585    294  49.74%
```

RESULT: **95/95 tests pass. Coverage = 49.74%, below the configured `fail_under=80`.**

Analysis (NOT papered over): the shortfall is a real, pre-existing test-coverage gap in
the current repo, not an env-introduced defect. The coverage `source` in `pyproject.toml`
lists `main`, `utils` (incl. `message_formatter`, `agentcore_utils`, `guardrail`), but the
`tests/` suite contains no tests importing/exercising `main.py` (the BedrockAgentCoreApp
entrypoint), `utils/message_formatter.py` (3.57%), `utils/agentcore_utils.py` (9.43%), or
`utils/guardrail.py` (14.04%). Per task constraints I did NOT lower `fail_under`, did NOT
delete/skip tests, and did NOT author new tests (out of scope for P1/P2). This is flagged
as needs-user-decision: closing the gap requires writing additional tests for those
modules (a scope expansion) or an explicit decision on the coverage policy.

## P1.3 — `.bedrock_agentcore.yaml` entrypoint fixed

- Edit: `entrypoint:` changed from the stale absolute path
  `/Users/cloudageglobal/Documents/Projects/Week_4/StrandsMultiAgent/SourceCode/main.py`
  to the relative `main.py` (matches `deploy.sh` `configure(entrypoint='main.py', ...)`).
- No other key changed (execution_role, account 015337708931, region, ECR repo,
  agent_id/agent_arn, memory_id, codebuild, authorizer_configuration all untouched).
- Verify:
```
python -c "import yaml; d=yaml.safe_load(open('.bedrock_agentcore.yaml')); \
  print(d['agents']['personal_finance_agent']['entrypoint'])"
-> main.py
```

## P2.1 — CDK Amplify endpoint env var reconciled

- File: `infra/lib/production-hardening-stack.ts`.
- Amplify env var renamed `NEXT_PUBLIC_AGENT_ENDPOINT` -> `NEXT_PUBLIC_AGENTCORE_ENDPOINT`
  and its value changed from the `/agents/${runtimeName}/invocations` form to the
  url-encoded-ARN `/runtimes/arn%3A...%3Aruntime%2F${runtimeName}/invocations` form,
  matching `setup.sh` line ~206, `deploy.sh`, and the var name read by
  `frontend/src/lib/agent.ts`.
- `AgentCoreEndpointUrl` CfnOutput value updated to the same `/runtimes/` form (logical id
  and exportName unchanged).
- Cognito vars verified against `frontend/src/lib/auth.ts`
  (`NEXT_PUBLIC_COGNITO_REGION`, `NEXT_PUBLIC_COGNITO_CLIENT_ID`,
  `NEXT_PUBLIC_COGNITO_USER_POOL_ID`): names match — no change needed.
- Verify:
```
cd infra && npm run build        -> tsc, exit 0 (no type errors)
npx cdk synth --quiet            -> Successfully synthesized (exit 0)
grep NEXT_PUBLIC_AGENTCORE_ENDPOINT cdk.out/*.template.json
  -> present in both Staging & Production templates with /runtimes/{encoded-arn}/invocations
grep "/agents/|NEXT_PUBLIC_AGENT_ENDPOINT" stack source  -> No matches found
```

## P2.2 — AGENTCORE_MEMORY_ID injected via deploy path

- Gap confirmed: `main.py` reads `os.environ.get('AGENTCORE_MEMORY_ID')` and no-ops memory
  when unset; `deploy.sh` previously called `runtime.launch()` with no args, so memory was
  silently disabled on the deploy.sh path (only `AWS_Deployment.ipynb` injected it).
- Toolkit signature confirmed: `AWS_Deployment.ipynb` uses
  `agentcore_runtime.launch(env_vars={...})`, so `env_vars=` is a supported argument.
- Fix in `deploy.sh`: read `MEMORY_ID` from `.bedrock_agentcore.yaml` before the python
  block, then pass
  `runtime.launch(env_vars={'OTEL_PYTHON_EXCLUDED_URLS': '/ping,/invocations',
  'AGENTCORE_MEMORY_ID': '$MEMORY_ID'})`. No identifier changed (`$MEMORY_ID` resolves to
  the existing `personal_finance_agent_mem-35VQoI2mZl`).
- Verify:
```
MEMORY_ID extraction -> personal_finance_agent_mem-35VQoI2mZl
bash -n deploy.sh    -> no syntax errors
```
Live `./deploy.sh` NOT run (requires AWS creds; out of scope).

## P2.3 — iam-roles.yaml documented as legacy (NOT deleted)

- Grep across repo for `iam-roles.yaml`, `AgentCoreExecutionRole`,
  `AWSTransformAgentInvokeRole`, `transform-agents`: matches appear only inside
  `iam-roles.yaml` itself, `.kiro/specs` docs, and the `.agents/tasks` readiness/plan docs.
  No deploy/setup/cleanup script, CDK file, or app module consumes it. (The CDK
  `infra/lib/iam-construct.ts` has a construct *id* "AgentCoreExecutionRole" but produces
  the live least-privilege role `agentcore-execution-personal_finance_agent-staging`.)
- Action: added a header comment block at the top of `iam-roles.yaml` stating it is a
  legacy/secondary AWS-Transform artifact NOT used by the current CDK + deploy.sh path, and
  that the authoritative IAM source is `infra/lib/iam-construct.ts`. No resource, policy,
  or output changed. File NOT deleted.
- Verify: header present; file still parses as YAML (CloudFormation `!GetAtt`/`!Ref` custom
  tags stripped before `yaml.safe_load`, which then succeeds).

## Final regression / syntax checks

```
python -m py_compile main.py   -> OK
bash -n deploy.sh              -> OK
bash -n setup.sh              -> OK
python -m pytest              -> 95 passed (re-run after all edits; no import/collection breakage)
```

Edited files: `Dockerfile`, `.bedrock_agentcore.yaml` (entrypoint only),
`infra/lib/production-hardening-stack.ts`, `deploy.sh`, `iam-roles.yaml`.
No files deleted. No staging identifiers / account IDs / ARNs / Cognito IDs / guardrail IDs
changed. `fail_under` left at 80. No tests deleted or skipped.
