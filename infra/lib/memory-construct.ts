import * as cdk from "aws-cdk-lib";
import { Memory, MemoryStrategy } from "aws-cdk-lib/aws-bedrockagentcore";
import { Construct } from "constructs";

/**
 * Properties for the AgentCore Memory construct.
 */
export interface MemoryConstructProps {
  /** Deployment environment (staging or production) */
  environment: string;
}

/*
 * ---------------------------------------------------------------------------
 * AgentCore Memory for the Multi-Agent Financial Advisor.
 *
 * This construct models the live resource `FinancialAdvisorMemory`
 * (physical id FinancialAdvisorMemory-7Yqinr2IDl) using the real L2
 * `Memory` construct (AWS::BedrockAgentCore::Memory) from
 * aws-cdk-lib/aws-bedrockagentcore.
 *
 * The three strategy names, their namespaces, and the 90-day short-term
 * event expiry mirror SourceCode/AWS_Deployment.ipynb Phase 3.2.1, which
 * is where the live memory was originally provisioned. The three strategy
 * types map onto the generated CloudFormation strategy properties as:
 *   - MemoryStrategy.usingSemantic       -> SemanticMemoryStrategy
 *   - MemoryStrategy.usingUserPreference -> UserPreferenceMemoryStrategy
 *   - MemoryStrategy.usingSummarization  -> SummaryMemoryStrategy
 *
 * FEAT-002 consumes `memoryArn` to scope the AgentCore execution role's
 * least-privilege memory IAM statement.
 * ---------------------------------------------------------------------------
 */
export class MemoryConstruct extends Construct {
  /** The ARN of the AgentCore memory resource (consumed by the IAM construct) */
  public readonly memoryArn: string;

  /** The id of the AgentCore memory resource */
  public readonly memoryId: string;

  constructor(scope: Construct, id: string, props: MemoryConstructProps) {
    super(scope, id);

    const memory = new Memory(this, "FinancialAdvisorMemory", {
      memoryName: "FinancialAdvisorMemory",
      description: "Memory for personal finance advisor agent",
      expirationDuration: cdk.Duration.days(90),
      memoryStrategies: [
        MemoryStrategy.usingSemantic({
          strategyName: "financial_facts",
          description:
            "Extracts and stores user financial facts (income, expenses, goals)",
          namespaces: ["finance/user/{actorId}/facts"],
        }),
        MemoryStrategy.usingUserPreference({
          strategyName: "user_preferences",
          description:
            "Captures user preferences for investment risk, budget priorities",
          namespaces: ["finance/user/{actorId}/preferences"],
        }),
        MemoryStrategy.usingSummarization({
          strategyName: "conversation_summary",
          description: "Summarizes financial advisory conversations",
          namespaces: ["finance/user/{actorId}/sessions/{sessionId}"],
        }),
      ],
    });

    this.memoryArn = memory.memoryArn;
    this.memoryId = memory.memoryId;

    // Export the memory id for cross-stack references
    new cdk.CfnOutput(this, "MemoryId", {
      value: this.memoryId,
      description: `AgentCore memory id for FinancialAdvisorMemory (${props.environment})`,
      exportName: `${props.environment}-agentcore-memory-id`,
    });
  }
}
