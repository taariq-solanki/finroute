#!/bin/bash
# ============================================================================
# FinRoute — Full Teardown
# ============================================================================
# Removes every AWS resource the project creates, so no charges accrue.
# Safe to run repeatedly (idempotent-ish: skips what's already gone).
# Local code and docs are never touched.
#
# Cleans both us-east-1 (current) and eu-north-1 (the original region) so a
# half-migrated state leaves nothing behind. Edit REGIONS to change.
#
# Usage:
#   chmod +x teardown.sh
#   ./teardown.sh            # prompts for confirmation
#   ./teardown.sh --yes      # no prompt (careful)
# ============================================================================

set +e  # keep going even if individual deletes fail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGIONS="us-east-1 eu-north-1"
STATE_FILE="$PROJECT_DIR/.finroute-deploy-state"

if [ "$1" != "--yes" ]; then
  echo "⚠️  This DELETES all FinRoute AWS resources in: $REGIONS"
  echo "   (EC2 Decider, AgentCore runtime+memory, Amplify, Cognito, guardrail,"
  echo "    ECR, S3, CodeBuild, CloudWatch logs, Secrets, IAM roles)"
  read -p "Proceed? (yes/no): " C
  [ "$C" != "yes" ] && { echo "Cancelled."; exit 0; }
fi

cd "$PROJECT_DIR"

# ----------------------------------------------------------------------------
# EC2 Decider first (biggest cost). Use saved state if present, else discover.
# ----------------------------------------------------------------------------
echo "━━━ EC2 Decider ━━━"
for R in $REGIONS; do
  # discover by tag Name=finroute-decider
  for IID in $(aws ec2 describe-instances --region "$R" \
      --filters "Name=tag:Name,Values=finroute-decider" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
      --query "Reservations[].Instances[].InstanceId" --output text 2>/dev/null); do
    echo "  terminating $IID ($R)"
    aws ec2 terminate-instances --region "$R" --instance-ids "$IID" >/dev/null 2>&1
    aws ec2 wait instance-terminated --region "$R" --instance-ids "$IID" 2>/dev/null
  done
  # delete our security groups (name prefix) after instances are gone
  for SG in $(aws ec2 describe-security-groups --region "$R" \
      --filters "Name=group-name,Values=finroute-decider-sg*" \
      --query "SecurityGroups[].GroupId" --output text 2>/dev/null); do
    aws ec2 delete-security-group --region "$R" --group-id "$SG" 2>/dev/null && echo "  ✓ SG $SG deleted ($R)"
  done
done

# ----------------------------------------------------------------------------
# AgentCore runtime + memory, Amplify, Cognito, guardrail, ECR, S3, CodeBuild, logs, secrets
# ----------------------------------------------------------------------------
for R in $REGIONS; do
  echo "━━━ Region: $R ━━━"

  for id in $(aws bedrock-agentcore-control list-agent-runtimes --region "$R" --query "agentRuntimes[?contains(agentRuntimeName,'finroute')].agentRuntimeId" --output text 2>/dev/null); do
    aws bedrock-agentcore-control delete-agent-runtime --agent-runtime-id "$id" --region "$R" >/dev/null 2>&1 && echo "  ✓ runtime $id"
  done

  for id in $(aws bedrock-agentcore-control list-memories --region "$R" --query "memories[?starts_with(id,'FinancialAdvisorMemory')].id" --output text 2>/dev/null); do
    aws bedrock-agentcore-control delete-memory --memory-id "$id" --region "$R" >/dev/null 2>&1 && echo "  ✓ memory $id"
  done

  for id in $(aws amplify list-apps --region "$R" --query "apps[?name=='finroute-ui'].appId" --output text 2>/dev/null); do
    aws amplify delete-app --app-id "$id" --region "$R" >/dev/null 2>&1 && echo "  ✓ amplify $id"
  done

  for id in $(aws cognito-idp list-user-pools --max-results 60 --region "$R" --query "UserPools[?Name=='agentpool'].Id" --output text 2>/dev/null); do
    aws cognito-idp delete-user-pool --user-pool-id "$id" --region "$R" 2>/dev/null && echo "  ✓ cognito $id"
  done

  for id in $(aws bedrock list-guardrails --region "$R" --query "guardrails[?name=='guardrail-no-bitcoin-advice'].id" --output text 2>/dev/null); do
    aws bedrock delete-guardrail --guardrail-identifier "$id" --region "$R" >/dev/null 2>&1 && echo "  ✓ guardrail $id"
  done

  aws ecr delete-repository --repository-name bedrock-agentcore-finroute_agent --force --region "$R" >/dev/null 2>&1 && echo "  ✓ ECR repo"

  for b in $(aws s3api list-buckets --query "Buckets[?contains(Name,'bedrock-agentcore') && contains(Name,'$R')].Name" --output text 2>/dev/null); do
    aws s3 rb "s3://$b" --force >/dev/null 2>&1 && echo "  ✓ S3 $b"
  done

  aws codebuild delete-project --name bedrock-agentcore-finroute_agent-builder --region "$R" 2>/dev/null && echo "  ✓ codebuild"

  for lg in $(aws logs describe-log-groups --region "$R" --query "logGroups[?contains(logGroupName,'finroute') || contains(logGroupName,'bedrock-agentcore')].logGroupName" --output text 2>/dev/null); do
    aws logs delete-log-group --log-group-name "$lg" --region "$R" 2>/dev/null && echo "  ✓ log group $lg"
  done

  for sn in $(aws secretsmanager list-secrets --region "$R" --query "SecretList[?contains(Name,'agentcore-project-credentials')].Name" --output text 2>/dev/null); do
    aws secretsmanager delete-secret --secret-id "$sn" --force-delete-without-recovery --region "$R" >/dev/null 2>&1 && echo "  ✓ secret $sn"
  done
done

# ----------------------------------------------------------------------------
# IAM roles (global namespace, region-suffixed names)
# ----------------------------------------------------------------------------
echo "━━━ IAM roles ━━━"
for role in $(aws iam list-roles --query "Roles[?contains(RoleName,'AmazonBedrockAgentCoreSDKRuntime') || contains(RoleName,'AmazonBedrockAgentCoreSDKCodeBuild')].RoleName" --output text 2>/dev/null); do
  for p in $(aws iam list-attached-role-policies --role-name "$role" --query "AttachedPolicies[].PolicyArn" --output text 2>/dev/null); do
    aws iam detach-role-policy --role-name "$role" --policy-arn "$p" 2>/dev/null
  done
  for ip in $(aws iam list-role-policies --role-name "$role" --query "PolicyNames[]" --output text 2>/dev/null); do
    aws iam delete-role-policy --role-name "$role" --policy-name "$ip" 2>/dev/null
  done
  aws iam delete-role --role-name "$role" 2>/dev/null && echo "  ✓ role $role"
done

[ -f "$STATE_FILE" ] && rm -f "$STATE_FILE"

echo ""
echo "============================================"
echo "  ✅ Teardown complete"
echo "============================================"
echo "Note: AgentCore runtime/memory finish deleting asynchronously (~1-2 min)."
echo "Your \$5 budget alarm is left in place as a safety net (delete manually if unwanted)."
echo "Local code and docs are untouched."
