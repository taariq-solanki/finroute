import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * Properties for the IAM construct that creates the AgentCore execution role.
 */
export interface IamConstructProps {
  /** Deployment environment (staging or production) */
  environment: string;
  /** AWS region for resource ARN construction */
  region: string;
  /** AWS account ID for resource ARN construction */
  accountId: string;
  /** AgentCore Runtime name (e.g., personal_finance_agent) */
  runtimeName: string;
  /** ECR repository name for agent container images */
  ecrRepositoryName: string;
  /** ARN of the AgentCore Memory resource from MemoryConstruct (scopes the memory data-plane statement) */
  memoryArn: string;
}

/**
 * CDK Construct that creates the AgentCore execution IAM role with
 * least-privilege policies scoped to specific resource ARNs.
 *
 * Policy statements are organized with a maximum of 6 actions per statement
 * for auditability (Requirement 3.7).
 */
export class IamConstruct extends Construct {
  /** The IAM execution role for AgentCore runtime */
  public readonly executionRole: iam.Role;

  constructor(scope: Construct, id: string, props: IamConstructProps) {
    super(scope, id);

    const { environment, region, accountId, runtimeName, ecrRepositoryName } =
      props;

    // Construct specific resource ARNs
    const modelArn = `arn:aws:bedrock:${region}::foundation-model/eu.amazon.nova-pro-v1:0`;
    const ecrRepositoryArn = `arn:aws:ecr:${region}:${accountId}:repository/${ecrRepositoryName}`;
    // Also grant access to the toolkit-created ECR repo (bedrock-agentcore-<runtimeName>)
    const toolkitEcrRepositoryArn = `arn:aws:ecr:${region}:${accountId}:repository/bedrock-agentcore-${runtimeName}`;
    const logGroupArn = `arn:aws:logs:${region}:${accountId}:log-group:/aws/bedrock-agentcore/${runtimeName}:*`;
    const guardrailArn = `arn:aws:bedrock:${region}:${accountId}:guardrail/*`;

    // Create the execution role with trust policy for bedrock-agentcore
    this.executionRole = new iam.Role(this, "AgentCoreExecutionRole", {
      roleName: `agentcore-execution-${runtimeName}-${environment}`,
      description: `Execution role for AgentCore runtime ${runtimeName} (${environment})`,
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
    });

    // Statement 1: Bedrock model invocation via Converse API
    // Note: Strands SDK uses bedrock:Converse/ConverseStream (not InvokeModel).
    // InvokeModel retained for backwards compatibility with direct API calls.
    // Requirement 3.1
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "BedrockModelInvocation",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:Converse",
          "bedrock:ConverseStream",
        ],
        resources: [modelArn],
      })
    );

    // Statement 2: Bedrock Guardrails (apply, list, get)
    // Required for runtime guardrail enforcement and discovery
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "BedrockGuardrails",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:ApplyGuardrail",
          "bedrock:ListGuardrails",
          "bedrock:GetGuardrail",
        ],
        resources: [guardrailArn],
      })
    );

    // Statement 3: ECR image pull (3 actions, both CDK-managed and toolkit-created repos)
    // Requirement 3.2
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "EcrImagePull",
        effect: iam.Effect.ALLOW,
        actions: [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchCheckLayerAvailability",
        ],
        resources: [ecrRepositoryArn, toolkitEcrRepositoryArn],
      })
    );

    // Statement 4: ECR auth token (1 action, wildcard Resource per AWS constraint)
    // Requirement 3.4
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "EcrAuthToken",
        effect: iam.Effect.ALLOW,
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      })
    );

    // Statement 5: CloudWatch Logs (3 actions, specific log group ARN with trailing *)
    // Requirement 3.3
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CloudWatchLogs",
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [logGroupArn],
      })
    );

    // Statement 6: AgentCore Memory data-plane access (6 actions, scoped to the
    // specific memory ARN and its child resources).
    // Mirrors the live inline policy `AgentCoreMemoryAccess` on the execution role.
    // Least-privilege: no bedrock-agentcore:* wildcard and no "*" resource — only
    // the six event/memory-record data-plane actions on props.memoryArn (and ARN/*).
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AgentCoreMemoryAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock-agentcore:CreateEvent",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:GetEvent",
          "bedrock-agentcore:RetrieveMemoryRecords",
          "bedrock-agentcore:ListMemoryRecords",
          "bedrock-agentcore:GetMemoryRecord",
        ],
        resources: [props.memoryArn, `${props.memoryArn}/*`],
      })
    );

    // NOTE: Region-restriction Deny statement removed.
    // The original DenyBedrockOutsideRegion statement (aws:RequestedRegion != eu-north-1)
    // blocked ConverseStream because the aws:RequestedRegion condition key is not
    // populated for all Bedrock API actions. Region scoping is enforced via resource
    // ARNs instead (model ARN includes the region).

    // Output the role ARN for cross-stack references
    new cdk.CfnOutput(this, "ExecutionRoleArn", {
      value: this.executionRole.roleArn,
      description: `AgentCore execution role ARN (${environment})`,
      exportName: `agentcore-execution-role-arn-${environment}`,
    });
  }
}
