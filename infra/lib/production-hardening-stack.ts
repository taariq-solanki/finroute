import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as amplify from "aws-cdk-lib/aws-amplify";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { ProductionHardeningStackProps } from "./types";
import { IamConstruct } from "./iam-construct";
import { WafConstruct } from "./waf-construct";
import { MemoryConstruct } from "./memory-construct";

/**
 * Main stack for production hardening of the Multi-Agent Financial Advisor.
 *
 * This stack defines all AWS resources required for the application:
 * - IAM construct (least-privilege policies)
 * - WAF construct (rate limiting, managed rules)
 * - Cognito User Pool and App Client
 * - ECR Repository
 * - CodeBuild Project (ARM64/Graviton)
 * - Amplify Application
 * - Secrets Manager secrets
 * - Bedrock Guardrail
 * - S3 buckets for AgentCore
 *
 * Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 5.7, 10.3
 */
export class ProductionHardeningStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: ProductionHardeningStackProps
  ) {
    super(scope, id, {
      ...props,
      env: {
        region: props.region,
        account: props.accountId,
      },
    });

    // Tag all resources with environment
    cdk.Tags.of(this).add("Environment", props.environment);
    cdk.Tags.of(this).add("Project", "multi-agent-financial-advisor");

    // =========================================================================
    // AgentCore Memory Construct - Long-term memory (FinancialAdvisorMemory)
    //
    // Instantiated before the IAM construct because FEAT-002's execution-role
    // memory IAM statement is scoped to memory.memoryArn. The MemoryConstruct
    // emits the `${environment}-agentcore-memory-id` CfnOutput itself, so no
    // duplicate output/exportName is declared in this stack.
    // =========================================================================
    const memory = new MemoryConstruct(this, "MemoryConstruct", {
      environment: props.environment,
    });

    // =========================================================================
    // IAM Construct - Least-privilege execution role
    // =========================================================================
    const iam = new IamConstruct(this, "IamConstruct", {
      environment: props.environment,
      region: props.region,
      accountId: props.accountId,
      runtimeName: props.runtimeName,
      ecrRepositoryName: props.ecrRepositoryName,
    });

    // =========================================================================
    // Cognito User Pool and App Client
    // =========================================================================
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: props.cognitoPoolName,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy:
        props.environment === "production"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool,
      userPoolClientName: `${props.cognitoPoolName}-client`,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      idTokenValidity: cdk.Duration.hours(1),
      preventUserExistenceErrors: true,
    });

    // =========================================================================
    // ECR Repository
    // =========================================================================
    const ecrRepository = new ecr.Repository(this, "EcrRepository", {
      repositoryName: props.ecrRepositoryName,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      removalPolicy:
        props.environment === "production"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: props.environment !== "production",
      lifecycleRules: [
        {
          description: "Keep only the last 5 images",
          maxImageCount: 5,
          rulePriority: 1,
          tagStatus: ecr.TagStatus.ANY,
        },
      ],
    });

    // =========================================================================
    // CodeBuild Project - ARM64/Graviton for Docker builds
    // =========================================================================
    const codeBuildProject = new codebuild.Project(this, "CodeBuildProject", {
      projectName: `${props.runtimeName}-build-${props.environment}`,
      description: `Docker image build for ${props.runtimeName} (${props.environment})`,
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: [
              "echo Logging in to Amazon ECR...",
              `aws ecr get-login-password --region ${props.region} | docker login --username AWS --password-stdin ${props.accountId}.dkr.ecr.${props.region}.amazonaws.com`,
            ],
          },
          build: {
            commands: [
              "echo Building the Docker image...",
              "docker build -t $IMAGE_REPO_NAME:$CODEBUILD_RESOLVED_SOURCE_VERSION .",
              `docker tag $IMAGE_REPO_NAME:$CODEBUILD_RESOLVED_SOURCE_VERSION ${props.accountId}.dkr.ecr.${props.region}.amazonaws.com/$IMAGE_REPO_NAME:latest`,
            ],
          },
          post_build: {
            commands: [
              "echo Pushing the Docker image...",
              `docker push ${props.accountId}.dkr.ecr.${props.region}.amazonaws.com/$IMAGE_REPO_NAME:latest`,
            ],
          },
        },
      }),
      environmentVariables: {
        AWS_ACCOUNT_ID: {
          value: props.accountId,
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
        },
        AWS_DEFAULT_REGION: {
          value: props.region,
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
        },
        IMAGE_REPO_NAME: {
          value: props.ecrRepositoryName,
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
        },
        ENVIRONMENT: {
          value: props.environment,
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
        },
      },
    });

    // Grant CodeBuild permission to push to ECR
    ecrRepository.grantPullPush(codeBuildProject);

    // =========================================================================
    // Amplify Application (L1 CfnApp - stable construct)
    // =========================================================================
    const amplifyApp = new amplify.CfnApp(this, "AmplifyApp", {
      name: props.amplifyAppName,
      platform: "WEB",
      buildSpec: [
        "version: 1",
        "applications:",
        "  - appRoot: frontend",
        "    frontend:",
        "      phases:",
        "        preBuild:",
        "          commands:",
        "            - npm ci",
        "        build:",
        "          commands:",
        "            - env | grep -i NEXT_PUBLIC >> .env.production || true",
        "            - npm run build",
        "            - npx next export",
        "      artifacts:",
        "        baseDirectory: out",
        "        files:",
        "          - '**/*'",
        "      cache:",
        "        paths:",
        "          - node_modules/**/*",
      ].join("\n"),
      environmentVariables: [
        {
          name: "NEXT_PUBLIC_COGNITO_REGION",
          value: props.region,
        },
        {
          name: "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
          value: userPool.userPoolId,
        },
        {
          name: "NEXT_PUBLIC_COGNITO_CLIENT_ID",
          value: userPoolClient.userPoolClientId,
        },
        {
          name: "NEXT_PUBLIC_AGENTCORE_ENDPOINT",
          value: `https://bedrock-agentcore.${props.region}.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3A${props.region}%3A${props.accountId}%3Aruntime%2F${props.runtimeName}/invocations`,
        },
        {
          name: "_LIVE_UPDATES",
          value: JSON.stringify([
            {
              pkg: "node",
              type: "nvm",
              version: "18",
            },
          ]),
        },
      ],
    });

    // Amplify branch configuration
    new amplify.CfnBranch(this, "AmplifyBranch", {
      appId: amplifyApp.attrAppId,
      branchName: props.environment === "production" ? "main" : "staging",
      enableAutoBuild: true,
      enablePullRequestPreview: props.environment === "staging",
      stage: props.environment === "production" ? "PRODUCTION" : "DEVELOPMENT",
    });

    // =========================================================================
    // WAF Construct - Rate limiting and managed rules
    //
    // IMPORTANT: WAF WebACL association with Amplify requires the Amplify
    // Firewall integration, which is NOT available in eu-north-1 as of
    // July 2025. The WebACL is created and logging is active, but the
    // association is skipped (amplifyAppArn: "SKIP").
    //
    // When Amplify Firewall support is added to eu-north-1, update
    // amplifyAppArn to: amplifyApp.attrArn
    // =========================================================================
    const waf = new WafConstruct(this, "WafConstruct", {
      environment: props.environment,
      amplifyAppArn: "SKIP", // eu-north-1 lacks Amplify Firewall integration
      rateLimitPerUser: 100,
      maxBodySizeBytes: 8192, // 8 KB
      logRetentionDays: 90,
    });

    // =========================================================================
    // Secrets Manager - Placeholder secrets for Cognito credentials
    // =========================================================================
    const cognitoSecret = new secretsmanager.Secret(this, "CognitoSecret", {
      secretName: `${props.environment}/finance-advisor/cognito-credentials`,
      description: `Cognito credentials for ${props.runtimeName} (${props.environment})`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          userPoolId: userPool.userPoolId,
          clientId: userPoolClient.userPoolClientId,
          region: props.region,
        }),
        generateStringKey: "placeholder",
      },
      removalPolicy:
        props.environment === "production"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // =========================================================================
    // Bedrock Guardrail - Content safety (CfnResource, no L2 construct)
    // =========================================================================
    const guardrail = new cdk.CfnResource(this, "BedrockGuardrail", {
      type: "AWS::Bedrock::Guardrail",
      properties: {
        Name: props.guardrailName,
        Description: `Content safety guardrail for ${props.runtimeName} (${props.environment})`,
        BlockedInputMessaging:
          "I am unable to process this request. Please rephrase your question.",
        BlockedOutputsMessaging:
          "I am unable to provide this response due to content policy.",
        ContentPolicyConfig: {
          FiltersConfig: [
            {
              Type: "SEXUAL",
              InputStrength: "HIGH",
              OutputStrength: "HIGH",
            },
            {
              Type: "VIOLENCE",
              InputStrength: "HIGH",
              OutputStrength: "HIGH",
            },
            {
              Type: "HATE",
              InputStrength: "HIGH",
              OutputStrength: "HIGH",
            },
            {
              Type: "INSULTS",
              InputStrength: "HIGH",
              OutputStrength: "HIGH",
            },
            {
              Type: "MISCONDUCT",
              InputStrength: "HIGH",
              OutputStrength: "HIGH",
            },
            {
              Type: "PROMPT_ATTACK",
              InputStrength: "HIGH",
              OutputStrength: "NONE",
            },
          ],
        },
        TopicPolicyConfig: {
          TopicsConfig: [
            {
              Name: "CryptocurrencyAdvice",
              Definition:
                "Providing investment advice specifically about cryptocurrency, bitcoin, or other digital currencies",
              Examples: [
                "Should I invest in Bitcoin?",
                "What crypto should I buy?",
                "Is Ethereum a good investment?",
              ],
              Type: "DENY",
            },
          ],
        },
      },
    });

    // =========================================================================
    // S3 Bucket - AgentCore artifacts
    // =========================================================================
    // Sanitize runtime name for S3 bucket naming (no underscores allowed)
    const sanitizedRuntimeName = props.runtimeName.replace(/_/g, "-");

    const agentCoreBucket = new s3.Bucket(this, "AgentCoreArtifactsBucket", {
      bucketName: `${sanitizedRuntimeName}-artifacts-${props.environment}-${props.accountId}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy:
        props.environment === "production"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.environment !== "production",
      lifecycleRules: [
        {
          id: "ExpireOldVersions",
          noncurrentVersionExpiration: cdk.Duration.days(30),
          enabled: true,
        },
      ],
    });

    // =========================================================================
    // Stack Outputs
    // =========================================================================
    new cdk.CfnOutput(this, "CognitoUserPoolId", {
      value: userPool.userPoolId,
      description: "Cognito User Pool ID",
      exportName: `${props.environment}-cognito-user-pool-id`,
    });

    new cdk.CfnOutput(this, "CognitoClientId", {
      value: userPoolClient.userPoolClientId,
      description: "Cognito User Pool Client ID",
      exportName: `${props.environment}-cognito-client-id`,
    });

    new cdk.CfnOutput(this, "EcrRepositoryUri", {
      value: ecrRepository.repositoryUri,
      description: "ECR Repository URI",
      exportName: `${props.environment}-ecr-repository-uri`,
    });

    new cdk.CfnOutput(this, "AmplifyAppUrl", {
      value: `https://${props.environment === "production" ? "main" : "staging"}.${amplifyApp.attrDefaultDomain}`,
      description: "Amplify Application URL",
      exportName: `${props.environment}-amplify-app-url`,
    });

    new cdk.CfnOutput(this, "IamRoleArn", {
      value: iam.executionRole.roleArn,
      description: "AgentCore Execution IAM Role ARN",
      exportName: `${props.environment}-iam-role-arn`,
    });

    new cdk.CfnOutput(this, "AgentCoreEndpointUrl", {
      value: `https://bedrock-agentcore.${props.region}.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3A${props.region}%3A${props.accountId}%3Aruntime%2F${props.runtimeName}/invocations`,
      description: "AgentCore Invocation Endpoint URL",
      exportName: `${props.environment}-agentcore-endpoint-url`,
    });

    new cdk.CfnOutput(this, "S3BucketName", {
      value: agentCoreBucket.bucketName,
      description: "S3 Bucket for AgentCore artifacts",
      exportName: `${props.environment}-s3-bucket-name`,
    });

    new cdk.CfnOutput(this, "GuardrailId", {
      value: guardrail.ref,
      description: "Bedrock Guardrail ID",
      exportName: `${props.environment}-guardrail-id`,
    });
  }
}
