#!/bin/bash
# ============================================================================
# FinRoute — Full Redeploy (us-east-1) incl. EC2-hosted Decider
# ============================================================================
# One command to stand the whole project back up after a teardown.
# Captures every lesson learned during the first deploy:
#   - us-east-1 (where this account has working Bedrock quota; eu-north-1 was 0)
#   - creates a fresh AgentCore memory and wires its id into the deploy
#   - EC2 Decider via user-data bootstrap (systemd, --host 0.0.0.0, --no-warmup)
#   - DECIDER_ENDPOINT wired into the AgentCore agent, then agent redeployed
#
# The .dockerignore fix (excludes .venv-decider) and toolkit template tweaks
# are already baked into the repo, so the image stays under AgentCore's 2048 MB.
#
# Usage:
#   chmod +x redeploy.sh
#   ./redeploy.sh                 # full deploy, agent + frontend + EC2 Decider
#   ./redeploy.sh --no-ec2        # skip the billable EC2 Decider (LLM-fallback routing)
# ============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGION="us-east-1"
INSTANCE_TYPE="m5.xlarge"
DECIDER_MODEL="StrandsAgents/strands-decider-2B-qwen3.5-v1-2610"
STATE_FILE="$PROJECT_DIR/.finroute-deploy-state"

DEPLOY_EC2=1
[ "$1" = "--no-ec2" ] && DEPLOY_EC2=0

cd "$PROJECT_DIR"

echo "============================================"
echo "  FinRoute — Full Redeploy ($REGION)"
echo "============================================"
aws configure set region "$REGION"
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
echo "Account: $AWS_ACCOUNT | Region: $REGION | EC2 Decider: $([ $DEPLOY_EC2 = 1 ] && echo yes || echo no)"
echo "" > "$STATE_FILE"

# ----------------------------------------------------------------------------
# Step 1: Fresh AgentCore memory + wire its id into deploy.sh
# ----------------------------------------------------------------------------
echo "━━━ Step 1: Creating AgentCore memory ━━━"
MEMORY_ID=$(aws bedrock-agentcore-control create-memory --region "$REGION" \
  --name "FinancialAdvisorMemory" --event-expiry-duration 90 \
  --query "memory.id" --output text)
echo "✓ memory: $MEMORY_ID"
echo "MEMORY_ID=$MEMORY_ID" >> "$STATE_FILE"
# Update the DEFAULT_MEMORY_ID in deploy.sh so the deploy wires the right one
sed -i "s/^DEFAULT_MEMORY_ID=\".*\"/DEFAULT_MEMORY_ID=\"$MEMORY_ID\"/" deploy.sh

# ----------------------------------------------------------------------------
# Step 2: Setup (IAM role, Cognito, guardrail, .env.local)
# ----------------------------------------------------------------------------
echo "━━━ Step 2: setup.sh ━━━"
./setup.sh

# ----------------------------------------------------------------------------
# Step 3 (optional): Launch EC2 Decider via user-data bootstrap
# ----------------------------------------------------------------------------
DECIDER_ENDPOINT=""
if [ "$DEPLOY_EC2" = "1" ]; then
  echo "━━━ Step 3: Launching EC2 Decider ($INSTANCE_TYPE) ━━━"

  VPC=$(aws ec2 describe-vpcs --region "$REGION" --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text)
  SUBNET=$(aws ec2 describe-subnets --region "$REGION" --filters "Name=vpc-id,Values=$VPC" --query "Subnets[0].SubnetId" --output text)
  AMI=$(aws ec2 describe-images --region "$REGION" --owners amazon \
    --filters "Name=name,Values=al2023-ami-2023.*-x86_64" "Name=state,Values=available" \
    --query "sort_by(Images,&CreationDate)[-1].ImageId" --output text)

  # Security group (reachable on 8010 for AgentCore; 22 for SSH fallback)
  SG=$(aws ec2 create-security-group --region "$REGION" \
    --group-name "finroute-decider-sg-$$" --description "FinRoute Decider" \
    --vpc-id "$VPC" --query "GroupId" --output text)
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG" \
    --ip-permissions 'IpProtocol=tcp,FromPort=8010,ToPort=8010,IpRanges=[{CidrIp=0.0.0.0/0,Description="Decider"}]' >/dev/null
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG" \
    --ip-permissions 'IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=0.0.0.0/0,Description="SSH"}]' >/dev/null
  echo "✓ security group: $SG"

  # User-data bootstrap: installs decider, runs it as a systemd service
  UD=$(mktemp)
  cat > "$UD" << 'USERDATA'
#!/bin/bash
exec > /var/log/decider-setup.log 2>&1
set -x
dnf install -y python3.12 python3.12-pip git gcc || yum install -y python3.12 python3.12-pip git gcc
python3.12 -m venv /opt/decider
/opt/decider/bin/pip install --upgrade pip
/opt/decider/bin/pip install strands-decider
cat > /etc/systemd/system/decider.service << 'UNIT'
[Unit]
Description=Strands Decider 2B server
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
Environment=OMP_NUM_THREADS=2
Environment=HF_HOME=/opt/decider/hf
ExecStart=/opt/decider/bin/strands-decider serve StrandsAgents/strands-decider-2B-qwen3.5-v1-2610 --device cpu --host 0.0.0.0 --port 8010 --no-warmup
Restart=on-failure
RestartSec=10
User=root
[Install]
WantedBy=multi-user.target
UNIT
mkdir -p /opt/decider/hf
systemctl daemon-reload
systemctl enable decider.service
systemctl start decider.service
echo "=== BOOTSTRAP COMPLETE ==="
USERDATA

  IID=$(aws ec2 run-instances --region "$REGION" \
    --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
    --security-group-ids "$SG" --subnet-id "$SUBNET" --associate-public-ip-address \
    --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=30,VolumeType=gp3,DeleteOnTermination=true}' \
    --user-data "file://$UD" \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=finroute-decider},{Key=Project,Value=FinRoute}]' \
    --query "Instances[0].InstanceId" --output text)
  rm -f "$UD"
  echo "✓ instance: $IID (waiting for running state...)"
  aws ec2 wait instance-running --region "$REGION" --instance-ids "$IID"
  IP=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$IID" \
    --query "Reservations[0].Instances[0].PublicIpAddress" --output text)
  echo "✓ public IP: $IP"
  echo "DECIDER_INSTANCE_ID=$IID" >> "$STATE_FILE"
  echo "DECIDER_SG=$SG" >> "$STATE_FILE"
  echo "DECIDER_IP=$IP" >> "$STATE_FILE"

  DECIDER_ENDPOINT="http://$IP:8010/v1/systemone"
  echo "Waiting for Decider server to come up (install + model load, up to ~12 min)..."
  for i in $(seq 1 48); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$DECIDER_ENDPOINT" -X POST -H "content-type: application/json" -d '{}' 2>/dev/null || echo 000)
    if [ "$code" != "000" ] && [ -n "$code" ]; then echo "✓ Decider responding (HTTP $code)"; break; fi
    sleep 15
    [ "$i" = "48" ] && echo "⚠️  Decider not up yet; agent will fall back to LLM routing until it is."
  done
fi

# ----------------------------------------------------------------------------
# Step 4: Deploy the agent (with DECIDER_ENDPOINT if EC2 was launched)
# ----------------------------------------------------------------------------
echo "━━━ Step 4: deploy.sh (agent) ━━━"
DECIDER_ENDPOINT="$DECIDER_ENDPOINT" ./deploy.sh

# ----------------------------------------------------------------------------
# Step 5: Deploy the frontend
# ----------------------------------------------------------------------------
echo "━━━ Step 5: deploy-frontend.sh ━━━"
./deploy-frontend.sh

# ----------------------------------------------------------------------------
# Step 6 (optional): CloudWatch observability dashboard for the new runtime
# ----------------------------------------------------------------------------
RUNTIME_ID=$(aws bedrock-agentcore-control list-agent-runtimes --region "$REGION" \
  --query "agentRuntimes[?contains(agentRuntimeName,'finroute')].agentRuntimeId | [0]" \
  --output text 2>/dev/null)
if [ -n "$RUNTIME_ID" ] && [ "$RUNTIME_ID" != "None" ] && [ -x ./observability/dashboard.sh ]; then
  echo "━━━ Step 6: observability dashboard ━━━"
  ./observability/dashboard.sh "$RUNTIME_ID" "$REGION" || echo "  (dashboard step skipped)"
  echo "RUNTIME_ID=$RUNTIME_ID" >> "$STATE_FILE"
fi

# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------
echo ""
echo "============================================"
echo "  ✅ Redeploy complete"
echo "============================================"
echo "Memory: $MEMORY_ID"
[ "$DEPLOY_EC2" = "1" ] && echo "Decider EC2: $IID @ $IP  (DECIDER_ENDPOINT=$DECIDER_ENDPOINT)"
echo "State saved to: $STATE_FILE"
echo ""
echo "Login credentials:"
python3 -c "from utils import retrieve_credentials_from_secrets_manager as r; c=r(); print('  user:',c['username']); print('  pass:',c['password'])" 2>/dev/null || echo "  (retrieve via Secrets Manager)"
echo ""
[ "$DEPLOY_EC2" = "1" ] && echo "⚠️  Remember to STOP or TERMINATE the EC2 Decider when done: ./teardown.sh"
