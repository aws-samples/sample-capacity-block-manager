#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CapacityBlockManagerStack } from '../lib/capacity-block-manager-stack';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { Aspects } from 'aws-cdk-lib';

const app = new cdk.App();

// Add AWS Solutions Checks to the entire app
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

const stack = new CapacityBlockManagerStack(app, 'CapacityBlockManagerStack', {
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */
  description: "Guidance for Automated Management of AWS Capacity Blocks (SO9612)"
  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  
  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});

// Add suppressions for API Gateway authorization
// We're using API Key auth which is acceptable for this use case
NagSuppressions.addResourceSuppressionsByPath(
  stack,
  [
    // Root resource methods (collection operations)
    '/CapacityBlockManagerStack/CapacityBlockApi/CBApi/Default/GET/Resource',
    '/CapacityBlockManagerStack/CapacityBlockApi/CBApi/Default/POST/Resource',
    
    // PK resource methods (item operations)
    '/CapacityBlockManagerStack/CapacityBlockApi/CBApi/Default/{PK}/GET/Resource',
    '/CapacityBlockManagerStack/CapacityBlockApi/CBApi/Default/{PK}/PUT/Resource',
    '/CapacityBlockManagerStack/CapacityBlockApi/CBApi/Default/{PK}/DELETE/Resource',
    '/CapacityBlockManagerStack/CapacityBlockApi/CBApi/Default/{PK}/PATCH/Resource',
  ],
  [
    {
      id: 'AwsSolutions-APIG4',
      reason: 'API uses API Key authentication which is sufficient for this internal tool',
    },
    {
      id: 'AwsSolutions-COG4',
      reason: 'API uses API Key authentication instead of Cognito as it is an internal tool with limited access',
    },
  ]
);
