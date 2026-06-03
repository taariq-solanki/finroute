#!/bin/bash
# ============================================================================
# Financial Advisor — Deploy Frontend to AWS Amplify
# ============================================================================
# This script deploys the Next.js frontend to AWS Amplify Hosting
# connected to AWS CodeCommit.
#
# Prerequisites:
#   - AWS CLI configured with eu-north-1 region
#   - Git credential helper configured for CodeCommit:
#       git config --global credential.helper '!aws codecommit credential-helper $@'
#       git config --global credential.UseHttpPath true
#   - Node.js installed
#
# Usage:
#   chmod +x deploy-frontend.sh
#   ./deploy-frontend.sh
# ============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGION="eu-north-1"
REPO_NAME="finance-advisor-frontend"
APP_NAME="finance-advisor-ui"

# AgentCore + Cognito config
AGENTCORE_ENDPOINT="https://bedrock-agentcore.eu-north-1.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aeu-north-1%3A015337708931%3Aruntime%2Fpersonal_finance_agent-mYf9CY3eON/invocations"
COGNITO_USER_POOL_ID="eu-north-1_21eZXl8aO"
COGNITO_CLIENT_ID="m7cbioiiuohbsj6eicmqu1t84"

echo "============================================"
echo "  Frontend Deployment to AWS Amplify"
echo "============================================"
echo ""

# ----------------------------------------------------------------------------
# Step 1: Create CodeCommit repo (if not exists)
# ----------------------------------------------------------------------------
echo "━━━ Step 1: CodeCommit Repository ━━━"

REPO_URL=$(aws codecommit get-repository --repository-name "$REPO_NAME" --region "$REGION" --query 'repositoryMetadata.cloneUrlHttp' --output text 2>/dev/null || echo "")

if [ -z "$REPO_URL" ]; then
    echo "  Creating CodeCommit repo: $REPO_NAME"
    REPO_URL=$(aws codecommit create-repository \
        --repository-name "$REPO_NAME" \
        --region "$REGION" \
        --query 'repositoryMetadata.cloneUrlHttp' \
        --output text)
    echo "✓ Repository created: $REPO_URL"
else
    echo "✓ Repository exists: $REPO_URL"
fi

# ----------------------------------------------------------------------------
# Step 2: Git init and push
# ----------------------------------------------------------------------------
echo ""
echo "━━━ Step 2: Push code to CodeCommit ━━━"

cd "$PROJECT_DIR"

# Initialize git if needed
if [ ! -d ".git" ]; then
    git init
    echo "✓ Git initialized"
fi

# Set remote
CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
if [ "$CURRENT_REMOTE" != "$REPO_URL" ]; then
    git remote remove origin 2>/dev/null || true
    git remote add origin "$REPO_URL"
    echo "✓ Remote set to: $REPO_URL"
fi

# Stage and commit
git add -A
git diff --cached --quiet 2>/dev/null || git commit -m "Deploy frontend $(date +%Y-%m-%d_%H:%M)"

# Push
echo "  Pushing to CodeCommit..."
git push -u origin main --force 2>/dev/null || git push -u origin master --force 2>/dev/null
echo "✓ Code pushed successfully"

# Determine branch name
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# ----------------------------------------------------------------------------
# Step 3: Create Amplify App
# ----------------------------------------------------------------------------
echo ""
echo "━━━ Step 3: Create Amplify App ━━━"

# Check if app already exists
EXISTING_APP_ID=$(aws amplify list-apps --region "$REGION" --query "apps[?name=='$APP_NAME'].appId" --output text 2>/dev/null || echo "")

if [ -n "$EXISTING_APP_ID" ] && [ "$EXISTING_APP_ID" != "None" ]; then
    echo "  App '$APP_NAME' already exists (ID: $EXISTING_APP_ID). Deleting..."
    aws amplify delete-app --app-id "$EXISTING_APP_ID" --region "$REGION" > /dev/null
    echo "  Deleted. Creating fresh..."
    sleep 2
fi

APP_ID=$(aws amplify create-app \
    --name "$APP_NAME" \
    --region "$REGION" \
    --platform WEB_COMPUTE \
    --repository "$REPO_URL" \
    --environment-variables \
        "NEXT_PUBLIC_AGENTCORE_ENDPOINT=$AGENTCORE_ENDPOINT,NEXT_PUBLIC_COGNITO_USER_POOL_ID=$COGNITO_USER_POOL_ID,NEXT_PUBLIC_COGNITO_CLIENT_ID=$COGNITO_CLIENT_ID,NEXT_PUBLIC_COGNITO_REGION=$REGION" \
    --query 'app.appId' \
    --output text)

echo "✓ Amplify app created: $APP_ID"

# ----------------------------------------------------------------------------
# Step 4: Connect branch
# ----------------------------------------------------------------------------
echo ""
echo "━━━ Step 4: Connect branch ━━━"

aws amplify create-branch \
    --app-id "$APP_ID" \
    --branch-name "$BRANCH" \
    --region "$REGION" > /dev/null

echo "✓ Branch '$BRANCH' connected"

# ----------------------------------------------------------------------------
# Step 5: Trigger build
# ----------------------------------------------------------------------------
echo ""
echo "━━━ Step 5: Trigger deployment ━━━"

JOB_ID=$(aws amplify start-job \
    --app-id "$APP_ID" \
    --branch-name "$BRANCH" \
    --job-type RELEASE \
    --region "$REGION" \
    --query 'jobSummary.jobId' \
    --output text)

echo "✓ Build triggered (Job ID: $JOB_ID)"

# ----------------------------------------------------------------------------
# Step 6: Wait for deployment
# ----------------------------------------------------------------------------
echo ""
echo "━━━ Step 6: Waiting for deployment... ━━━"
echo "  (This takes 2-5 minutes)"

STATUS="PENDING"
while [ "$STATUS" = "PENDING" ] || [ "$STATUS" = "RUNNING" ]; do
    sleep 15
    STATUS=$(aws amplify get-job \
        --app-id "$APP_ID" \
        --branch-name "$BRANCH" \
        --job-id "$JOB_ID" \
        --region "$REGION" \
        --query 'job.summary.status' \
        --output text 2>/dev/null || echo "RUNNING")
    echo "  Status: $STATUS"
done

echo ""

# ----------------------------------------------------------------------------
# Result
# ----------------------------------------------------------------------------
if [ "$STATUS" = "SUCCEED" ]; then
    echo "============================================"
    echo "  ✅ Deployment Successful!"
    echo "============================================"
    echo ""
    echo "  Your app is live at:"
    echo "  https://$BRANCH.$APP_ID.amplifyapp.com"
    echo ""
    echo "  App ID: $APP_ID"
    echo "  Region: $REGION"
    echo ""
    echo "  Future deployments: just 'git push' and"
    echo "  Amplify will auto-build."
    echo ""
else
    echo "============================================"
    echo "  ❌ Deployment Failed (Status: $STATUS)"
    echo "============================================"
    echo ""
    echo "  Check build logs:"
    echo "  aws amplify get-job --app-id $APP_ID --branch-name $BRANCH --job-id $JOB_ID --region $REGION"
    echo ""
    echo "  Or visit:"
    echo "  https://$REGION.console.aws.amazon.com/amplify/apps/$APP_ID"
    echo ""
fi
