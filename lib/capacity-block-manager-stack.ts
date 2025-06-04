import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { CapacityBlockApi } from './capacity-block-api';
import { ApiGatewayLoggingRole } from './api-gateway-logging-role';
import { NagSuppressions } from 'cdk-nag';

export class CapacityBlockManagerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Create API Gateway logging role first to ensure CloudWatch logs are properly configured
    const apiGatewayLoggingRole = new ApiGatewayLoggingRole(this, 'ApiGatewayLoggingRole');

    // Create DynamoDB table with Point-in-Time Recovery enabled
    const table = new dynamodb.Table(this, 'CBJobTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }, // Use non-deprecated property
    });

    // Create Lambda function with custom policy instead of managed policy
    const handler = new lambda.Function(this, 'CapacityBlockHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: lambda.Code.fromAsset('src/extender'),
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    // Permissions for Capacity Block management with specific resources
    handler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "ec2:DescribeCapacityBlockExtensionOfferings",
        "ec2:PurchaseCapacityBlockExtension"
      ],
      resources: ["*"]
    }));

    // Add suppression for the wildcard resource in EC2 permissions
    NagSuppressions.addResourceSuppressions(
      handler,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'EC2 DescribeCapacityBlockExtensionOfferings and PurchaseCapacityBlockExtension do not support resource-level permissions',
          appliesTo: ['Resource::*']
        }
      ],
      true
    );

    // Permissions to access DynamoDB table
    table.grantReadWriteData(handler);

    // EventBridge rule to trigger Lambda every minute
    new events.Rule(this, 'CapacityBlockCronRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(handler)],
    });

    // SNS topic with HTTPS enforcement
    const approvalTopic = new sns.Topic(this, 'ApprovalTopic', {
      displayName: 'Capacity Block Extension Approvals',
      enforceSSL: true, // Address AwsSolutions-SNS3
    });

    // Subscribe an email address (must confirm via email)
    approvalTopic.addSubscription(
      new subscriptions.EmailSubscription('example@example.com') // ! Change this
    );

    // Grant Lambda publish permissions
    approvalTopic.grantPublish(handler);

    // Pass topic ARN to Lambda
    handler.addEnvironment('APPROVAL_TOPIC_ARN', approvalTopic.topicArn);

    // Create API with improved security
    const api = new CapacityBlockApi(this, 'CapacityBlockApi', {
      lambdaCodePath: 'src/api',
      table
    });

    // Add suppressions for IAM4 (AWS managed policies)
    NagSuppressions.addResourceSuppressions(
      handler,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'Lambda execution role requires AWSLambdaBasicExecutionRole for CloudWatch Logs access'
        }
      ],
      true
    );
    
    // Add global suppression for rotation lambda
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      '/CapacityBlockManagerStack/CapacityBlockApi/SecretRotationLambda/ServiceRole/DefaultPolicy/Resource',
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Secrets Manager rotation requires access to the secret and API Gateway',
          appliesTo: ['Resource::*']
        }
      ]
    );
  }
}
