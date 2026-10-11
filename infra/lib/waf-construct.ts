import * as cdk from "aws-cdk-lib";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

/**
 * Properties for the WAF construct.
 */
export interface WafConstructProps {
  /** Deployment environment (staging or production) */
  environment: string;
  /** ARN of the Amplify application to protect */
  amplifyAppArn: string;
  /** Maximum requests per evaluation window per user (WAF minimum is 100) */
  rateLimitPerUser: number;
  /** Maximum allowed request body size in bytes */
  maxBodySizeBytes: number;
  /** CloudWatch log retention period in days */
  logRetentionDays: number;
}

/**
 * WAF construct providing rate limiting, body size constraints,
 * and AWS managed rule groups for the Multi-Agent Financial Advisor.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */
export class WafConstruct extends Construct {
  public readonly webAcl: wafv2.CfnWebACL;
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: WafConstructProps) {
    super(scope, id);

    // CloudWatch log group for WAF blocked request logs
    // Name must start with "aws-waf-logs-" for WAF logging integration
    this.logGroup = new logs.LogGroup(this, "WafLogGroup", {
      logGroupName: `aws-waf-logs-${props.environment}-finance-advisor`,
      retention: logs.RetentionDays.THREE_MONTHS, // 90 days
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create the WebACL with all rules and custom response bodies
    this.webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      name: `${props.environment}-finance-advisor-waf`,
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${props.environment}-finance-advisor-waf`,
        sampledRequestsEnabled: true,
      },

      // Custom response bodies for rate limit and body size violations
      customResponseBodies: {
        RateLimitBody: {
          contentType: "APPLICATION_JSON",
          content: JSON.stringify({
            error: "Rate limit exceeded",
            message: "Too many requests. Please wait before trying again.",
            retryAfter: 60,
          }),
        },
        BodyTooLargeBody: {
          contentType: "APPLICATION_JSON",
          content: JSON.stringify({
            error: "Payload too large",
            message: "Request body exceeds the maximum allowed size of 8 KB.",
          }),
        },
      },

      rules: [
        // Rule 1: Rate limiting - 100 requests per 5-minute evaluation window
        // WAF rate-based rules use a 5-minute sliding window (minimum limit is 100)
        {
          name: "RateLimitPerUser",
          priority: 1,
          action: {
            block: {
              customResponse: {
                responseCode: 429,
                responseHeaders: [
                  {
                    name: "Retry-After",
                    value: "60",
                  },
                ],
                customResponseBodyKey: "RateLimitBody",
              },
            },
          },
          statement: {
            rateBasedStatement: {
              limit: props.rateLimitPerUser,
              aggregateKeyType: "IP",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${props.environment}-rate-limit`,
            sampledRequestsEnabled: true,
          },
        },

        // Rule 2: Body size constraint - block requests > 8 KB (HTTP 413)
        {
          name: "BodySizeConstraint",
          priority: 2,
          action: {
            block: {
              customResponse: {
                responseCode: 413,
                customResponseBodyKey: "BodyTooLargeBody",
              },
            },
          },
          statement: {
            sizeConstraintStatement: {
              fieldToMatch: {
                body: {
                  oversizeHandling: "MATCH",
                },
              },
              comparisonOperator: "GT",
              size: props.maxBodySizeBytes,
              textTransformations: [
                {
                  priority: 0,
                  type: "NONE",
                },
              ],
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${props.environment}-body-size`,
            sampledRequestsEnabled: true,
          },
        },

        // Rule 3: AWS Managed Rules - Common Rule Set (XSS, bad bots, etc.)
        {
          name: "AWSManagedRulesCommonRuleSet",
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${props.environment}-common-rules`,
            sampledRequestsEnabled: true,
          },
        },

        // Rule 4: AWS Managed Rules - SQL Injection
        {
          name: "AWSManagedRulesSQLiRuleSet",
          priority: 4,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesSQLiRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${props.environment}-sqli-rules`,
            sampledRequestsEnabled: true,
          },
        },

        // Rule 5: AWS Managed Rules - Known Bad Inputs
        {
          name: "AWSManagedRulesKnownBadInputsRuleSet",
          priority: 5,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesKnownBadInputsRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${props.environment}-bad-inputs-rules`,
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // Associate the WebACL with the Amplify application
    // Note: WAF WebACL association with Amplify is only available in regions
    // where Amplify firewall integration is supported. The association is
    // created only when explicitly enabled, allowing the WebACL to be
    // associated manually via the Amplify console in supported regions.
    if (props.amplifyAppArn && props.amplifyAppArn !== "SKIP") {
      new wafv2.CfnWebACLAssociation(this, "WebAclAssociation", {
        webAclArn: this.webAcl.attrArn,
        resourceArn: props.amplifyAppArn,
      });
    }

    // Configure WAF logging to CloudWatch for blocked requests
    new wafv2.CfnLoggingConfiguration(this, "WafLogging", {
      resourceArn: this.webAcl.attrArn,
      logDestinationConfigs: [this.logGroup.logGroupArn],
      loggingFilter: {
        DefaultBehavior: "DROP",
        Filters: [
          {
            Behavior: "KEEP",
            Conditions: [
              {
                ActionCondition: {
                  Action: "BLOCK",
                },
              },
            ],
            Requirement: "MEETS_ANY",
          },
        ],
      },
    });
  }
}
