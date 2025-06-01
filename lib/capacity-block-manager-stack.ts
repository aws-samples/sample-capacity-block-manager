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

export class CapacityBlockManagerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'CBJobTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const handler = new lambda.Function(this, 'CapacityBlockHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: lambda.Code.fromAsset('src/extender'),
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    // Permissions for Capacity Block management
    handler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "ec2:DescribeCapacityBlockExtensionOfferings",
        "ec2:PurchaseCapacityBlockExtension"
      ],
      resources: ["*"]
    }));

    // Permissions to access DynamoDB table
    table.grantReadWriteData(handler);

    // // EventBridge rule to trigger Lambda every minute
    new events.Rule(this, 'CapacityBlockCronRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(handler)],
    });


    // SNS topic
    const approvalTopic = new sns.Topic(this, 'ApprovalTopic', {
      displayName: 'Capacity Block Extension Approvals',
    });

    // Subscribe an email address (must confirm via email)
    approvalTopic.addSubscription(
      new subscriptions.EmailSubscription('kabdolha@amazon.com') // ! Change this
    );

    // Grant Lambda publish permissions
    approvalTopic.grantPublish(handler);

    // Pass topic ARN to Lambda
    handler.addEnvironment('APPROVAL_TOPIC_ARN', approvalTopic.topicArn);

    new CapacityBlockApi(this, 'CapacityBlockApi', {
      lambdaCodePath: 'src/api',
      table
    });
  }
}
