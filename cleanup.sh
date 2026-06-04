#!/bin/bash
# ============================================================================
# Financial Advisor — Cleanup All AWS Resources
# ============================================================================
# Removes all AWS resources created by this project.
#
# Usage:
#   chmod +x cleanup.sh
#   ./cleanup.sh
# ============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGION="eu-north-1"

echo "============================================"
echo "  Financial Advisor — Resource Cleanup"
echo "============================================"
echo ""
echo "⚠️  This will DELETE all AWS resources created by this project."
echo "  Region: $REGION"
echo ""
read -p "Are you sure? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Cancelled."
    exit 0
fi

cd "$PROJECT_DIR"
source .venv/bin/activate 2>/dev/null || true

echo ""

# ----------------------------------------------------------------------------
# Step 1: Delete AgentCore Runtime
# ----------------------------------------------------------------------------
echo "━━━ Step 1: Deleting AgentCore Runtime ━━━"

python -c "
import boto3
client = boto3.client('bedrock-agentcore-control', region_name='$REGION')
try:
    runtimes = client.list_agent_runtimes()
    for rt in runtimes.get('agentRuntimes', []):
        if 'personal_finance_agent' in rt['agentRuntimeName']:
            print(f'  Deleting runtime: {rt[\"agentRuntimeId\"]}')
            client.delete_agent_runtime(agentRuntimeId=rt['agentRuntimeId'])
            print(f'  ✓ Runtime deleted')
except Exception as e:
    print(f'  ⚠️  Could not delete runtime: {e}')
" 2>/dev/null || echo "  ⚠️  Runtime cleanup skipped"

echo ""

# ----------------------------------------------------------------------------
# Step 2: Delete Bedrock Guardrail
# ----------------------------------------------------------------------------
echo "━━━ Step 2: Deleting Bedrock Guardrail ━━━"

python -c "
from utils.guardrail import delete_guardrail
delete_guardrail()
" 2>/dev/null || echo "  ⚠️  Guardrail cleanup skipped"

echo ""

# ----------------------------------------------------------------------------
# Step 3: Delete Cognito User Pool
# ----------------------------------------------------------------------------
echo "━━━ Step 3: Deleting Cognito User Pool ━━━"

python -c "
from utils.agentcore_utils import delete_cognito_user_pool
delete_cognito_user_pool()
# Also clean any other pools created by this project
import boto3
client = boto3.client('cognito-idp', region_name='$REGION')
pools = client.list_user_pools(MaxResults=20)
for pool in pools.get('UserPools', []):
    if 'agentcore' in pool['Name'].lower() or 'finance' in pool['Name'].lower():
        print(f'  Deleting pool: {pool[\"Name\"]} ({pool[\"Id\"]})')
        client.delete_user_pool(UserPoolId=pool['Id'])
        print(f'  ✓ Deleted')
" 2>/dev/null || echo "  ⚠️  Cognito cleanup skipped"

echo ""

# ----------------------------------------------------------------------------
# Step 4: Delete IAM Role
# ----------------------------------------------------------------------------
echo "━━━ Step 4: Cleaning up IAM role ━━━"

ROLE_NAME="AmazonBedrockAgentCoreSDKRuntime-$REGION"

# Detach policies first
for POLICY in "arn:aws:iam::aws:policy/AmazonBedrockFullAccess" \
              "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess" \
              "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"; do
    aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn "$POLICY" 2>/dev/null || true
done

# Delete inline policies
for POLICY_NAME in $(aws iam list-role-policies --role-name "$ROLE_NAME" --query 'PolicyNames[]' --output text 2>/dev/null || echo ""); do
    aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" 2>/dev/null || true
done

# Delete the role
aws iam delete-role --role-name "$ROLE_NAME" 2>/dev/null && \
    echo "  ✓ IAM role '$ROLE_NAME' deleted" || \
    echo "  ⚠️  Could not delete IAM role"

# Delete CodeBuild role
CODEBUILD_ROLE=$(aws iam list-roles --query "Roles[?contains(RoleName, 'AgentCoreSDKCodeBuild')].RoleName" --output text 2>/dev/null || echo "")
if [ -n "$CODEBUILD_ROLE" ]; then
    for POLICY in $(aws iam list-attached-role-policies --role-name "$CODEBUILD_ROLE" --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null); do
        aws iam detach-role-policy --role-name "$CODEBUILD_ROLE" --policy-arn "$POLICY" 2>/dev/null || true
    done
    for POLICY_NAME in $(aws iam list-role-policies --role-name "$CODEBUILD_ROLE" --query 'PolicyNames[]' --output text 2>/dev/null); do
        aws iam delete-role-policy --role-name "$CODEBUILD_ROLE" --policy-name "$POLICY_NAME" 2>/dev/null || true
    done
    aws iam delete-role --role-name "$CODEBUILD_ROLE" 2>/dev/null && \
        echo "  ✓ CodeBuild role '$CODEBUILD_ROLE' deleted" || true
fi

# Delete Amplify service role
if aws iam get-role --role-name AmplifyServiceRole &>/dev/null 2>&1; then
    for POLICY in $(aws iam list-attached-role-policies --role-name AmplifyServiceRole --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null); do
        aws iam detach-role-policy --role-name AmplifyServiceRole --policy-arn "$POLICY" 2>/dev/null || true
    done
    aws iam delete-role --role-name AmplifyServiceRole 2>/dev/null && \
        echo "  ✓ Amplify service role deleted" || true
fi

echo ""

# ----------------------------------------------------------------------------
# Step 5: Delete S3 Buckets
# ----------------------------------------------------------------------------
echo "━━━ Step 5: Cleaning up S3 buckets ━━━"

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
for BUCKET in $(aws s3 ls --region "$REGION" 2>/dev/null | awk '{print $3}' | grep -i "bedrock-agentcore"); do
    echo "  Deleting bucket: $BUCKET"
    aws s3 rb "s3://$BUCKET" --force --region "$REGION" 2>/dev/null && \
        echo "  ✓ Deleted" || echo "  ⚠️  Could not delete"
done

echo ""

# ----------------------------------------------------------------------------
# Step 6: Delete ECR Repository
# ----------------------------------------------------------------------------
echo "━━━ Step 6: Cleaning up ECR ━━━"

for REPO in $(aws ecr describe-repositories --region "$REGION" --query 'repositories[?contains(repositoryName, `bedrock-agentcore`)].repositoryName' --output text 2>/dev/null); do
    echo "  Deleting ECR repo: $REPO"
    aws ecr delete-repository --repository-name "$REPO" --force --region "$REGION" 2>/dev/null && \
        echo "  ✓ Deleted" || echo "  ⚠️  Could not delete"
done

echo ""

# ----------------------------------------------------------------------------
# Step 7: Delete CodeBuild Project
# ----------------------------------------------------------------------------
echo "━━━ Step 7: Cleaning up CodeBuild ━━━"

for PROJECT in $(aws codebuild list-projects --region "$REGION" --query 'projects' --output text 2>/dev/null | tr '\t' '\n' | grep "bedrock-agentcore"); do
    echo "  Deleting project: $PROJECT"
    aws codebuild delete-project --name "$PROJECT" --region "$REGION" 2>/dev/null && \
        echo "  ✓ Deleted" || echo "  ⚠️  Could not delete"
done

echo ""

# ----------------------------------------------------------------------------
# Step 8: Delete Amplify App
# ----------------------------------------------------------------------------
echo "━━━ Step 8: Cleaning up Amplify ━━━"

for APP_ID in $(aws amplify list-apps --region "$REGION" --query "apps[?contains(name, 'finance-advisor')].appId" --output text 2>/dev/null); do
    echo "  Deleting Amplify app: $APP_ID"
    aws amplify delete-app --app-id "$APP_ID" --region "$REGION" 2>/dev/null && \
        echo "  ✓ Deleted" || echo "  ⚠️  Could not delete"
done

echo ""

# ----------------------------------------------------------------------------
# Step 9: Delete CodeCommit Repository
# ----------------------------------------------------------------------------
echo "━━━ Step 9: Cleaning up CodeCommit ━━━"

aws codecommit delete-repository --repository-name "finance-advisor-frontend" --region "$REGION" 2>/dev/null && \
    echo "  ✓ CodeCommit repo deleted" || echo "  ⚠️  No CodeCommit repo found"

echo ""

# ----------------------------------------------------------------------------
# Step 10: Delete Secrets Manager entries
# ----------------------------------------------------------------------------
echo "━━━ Step 10: Cleaning up Secrets Manager ━━━"

python -c "
import boto3
client = boto3.client('secretsmanager', region_name='$REGION')
try:
    secrets = client.list_secrets(
        Filters=[{'Key': 'name', 'Values': ['agentcore-project-credentials']}]
    )
    active = [s for s in secrets.get('SecretList', []) if not s.get('DeletedDate')]
    for secret in active:
        print(f'  Deleting secret: {secret[\"Name\"]}')
        client.delete_secret(SecretId=secret['Name'], ForceDeleteWithoutRecovery=True)
        print(f'  ✓ Deleted')
    if not active:
        print('  No project secrets found')
except Exception as e:
    print(f'  ⚠️  Could not clean secrets: {e}')
" 2>/dev/null || echo "  ⚠️  Secrets cleanup skipped"

echo ""
echo "============================================"
echo "  ✅ Cleanup Complete!"
echo "============================================"
echo ""
echo "All AWS resources have been removed."
echo "Local files (.venv, node_modules) are untouched."
echo ""
