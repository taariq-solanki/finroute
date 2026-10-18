#!/bin/bash
# ============================================================================
# FinRoute — Deploy Frontend to AWS Amplify
# ============================================================================
# Builds the Next.js frontend as a static export and deploys to AWS Amplify
# using manual deployment (no CodeCommit dependency).
#
# Prerequisites:
#   - AWS CLI configured with eu-north-1 region
#   - Node.js installed
#   - .venv activated (for boto3)
#
# Usage:
#   chmod +x deploy-frontend.sh
#   ./deploy-frontend.sh
# ============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGION="eu-north-1"
APP_NAME="finroute-ui"

echo "============================================"
echo "  Frontend Deployment to AWS Amplify"
echo "============================================"
echo ""

cd "$PROJECT_DIR"
source .venv/bin/activate

# Read config from .env.local
AGENTCORE_ENDPOINT=$(grep NEXT_PUBLIC_AGENTCORE_ENDPOINT "$PROJECT_DIR/frontend/.env.local" | cut -d= -f2-)
COGNITO_USER_POOL_ID=$(grep NEXT_PUBLIC_COGNITO_USER_POOL_ID "$PROJECT_DIR/frontend/.env.local" | cut -d= -f2)
COGNITO_CLIENT_ID=$(grep NEXT_PUBLIC_COGNITO_CLIENT_ID "$PROJECT_DIR/frontend/.env.local" | cut -d= -f2)

echo "AgentCore Endpoint: ${AGENTCORE_ENDPOINT:0:80}..."
echo "Cognito Pool: $COGNITO_USER_POOL_ID"
echo "Cognito Client: $COGNITO_CLIENT_ID"
echo ""

# ----------------------------------------------------------------------------
# Step 1: Build frontend
# ----------------------------------------------------------------------------
echo "━━━ Step 1: Building frontend ━━━"

cd "$PROJECT_DIR/frontend"
npm ci --silent 2>/dev/null || npm install --silent
npm run build
npx next export

echo "✓ Frontend built and exported to out/"
echo ""

# ----------------------------------------------------------------------------
# Step 2: Deploy to Amplify
# ----------------------------------------------------------------------------
echo "━━━ Step 2: Deploying to Amplify ━━━"

cd "$PROJECT_DIR"

# Values are passed via the environment (not string-spliced into Python literals)
# so a stray quote/newline in a derived value cannot break or inject the heredoc.
export REGION APP_NAME AGENTCORE_ENDPOINT COGNITO_USER_POOL_ID COGNITO_CLIENT_ID
python3 -c "
import boto3, zipfile, os, requests, sys

region = os.environ['REGION']
app_name = os.environ['APP_NAME']

client = boto3.client('amplify', region_name=region)

# Check if app exists
apps = client.list_apps()
app_id = None
for app in apps.get('apps', []):
    if app['name'] == app_name:
        app_id = app['appId']
        break

# Create app if not exists
if not app_id:
    response = client.create_app(
        name=app_name,
        platform='WEB',
        environmentVariables={
            'NEXT_PUBLIC_AGENTCORE_ENDPOINT': os.environ['AGENTCORE_ENDPOINT'],
            'NEXT_PUBLIC_COGNITO_USER_POOL_ID': os.environ['COGNITO_USER_POOL_ID'],
            'NEXT_PUBLIC_COGNITO_CLIENT_ID': os.environ['COGNITO_CLIENT_ID'],
            'NEXT_PUBLIC_COGNITO_REGION': region
        },
        customRules=[
            {'source': '/<*>', 'target': '/index.html', 'status': '404-200'}
        ]
    )
    app_id = response['app']['appId']
    client.create_branch(appId=app_id, branchName='main')
    print(f'✓ Amplify app created: {app_id}')
else:
    print(f'✓ Using existing Amplify app: {app_id}')

# Create deployment
deploy = client.create_deployment(appId=app_id, branchName='main')
upload_url = deploy['zipUploadUrl']
job_id = deploy['jobId']

# Zip the out/ directory
zip_path = '/tmp/amplify-frontend.zip'
out_dir = 'frontend/out'
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(out_dir):
        for file in files:
            file_path = os.path.join(root, file)
            arcname = os.path.relpath(file_path, out_dir)
            zf.write(file_path, arcname)

print(f'✓ Zip created: {os.path.getsize(zip_path) / 1024:.1f} KB')

# Upload
resp = requests.put(upload_url, data=open(zip_path, 'rb'))
if resp.status_code != 200:
    print(f'❌ Upload failed: {resp.status_code}')
    sys.exit(1)
print('✓ Artifacts uploaded')

# Start deployment
result = client.start_deployment(appId=app_id, branchName='main', jobId=job_id)
print(f'✓ Deployment started (Job ID: {job_id})')

# Wait for completion.
# Cap total polling so a job stuck in PENDING/RUNNING cannot hang the script
# forever. Non-SUCCEED terminal states (FAILED/CANCELLED/PROVISION_FAILED) leave
# the loop naturally and are reported by the branch below.
import time
MAX_POLLS = 60  # 60 x 10s = ~10 minutes
status = 'PENDING'
polls = 0
while status in ('PENDING', 'RUNNING'):
    if polls >= MAX_POLLS:
        print(f'❌ Deployment did not finish within {MAX_POLLS * 10 // 60} minutes (last status: {status})')
        sys.exit(1)
    time.sleep(10)
    polls += 1
    job = client.get_job(appId=app_id, branchName='main', jobId=job_id)
    status = job['job']['summary']['status']
    print(f'  Status: {status}')

if status == 'SUCCEED':
    print(f'')
    print(f'✅ Deployment Successful!')
    print(f'   URL: https://main.{app_id}.amplifyapp.com')
else:
    print(f'❌ Deployment failed: {status}')
    sys.exit(1)
"

echo ""
echo "============================================"
echo "  ✅ Frontend Deployment Complete!"
echo "============================================"
echo ""
