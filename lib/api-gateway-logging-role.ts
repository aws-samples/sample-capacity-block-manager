import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { NagSuppressions } from 'cdk-nag';

export class ApiGatewayLoggingRole extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Create IAM role for API Gateway CloudWatch logging
    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs')
      ],
      description: 'Role for API Gateway to push logs to CloudWatch',
    });

    // Add suppressions for IAM4 (AWS managed policies)
    NagSuppressions.addResourceSuppressions(
      this.role,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'API Gateway requires AmazonAPIGatewayPushToCloudWatchLogs managed policy for CloudWatch Logs access'
        }
      ],
      true
    );

    // Update API Gateway account settings with the CloudWatch Logs role ARN
    const cfnAccount = new apigateway.CfnAccount(this, 'Account', {
      cloudWatchRoleArn: this.role.roleArn,
    });
  }
}
