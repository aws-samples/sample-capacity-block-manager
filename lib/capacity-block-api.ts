import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export interface CapacityBlockApiProps {
  lambdaCodePath: string;
  table: dynamodb.Table;
  environment?: Record<string, string>;
}

export class CapacityBlockApi extends Construct {
  public readonly api: apigateway.RestApi;
  public readonly apiKey: apigateway.IApiKey;
  public readonly handler: lambda.Function;
  public readonly apiSecretName: string;
  public readonly apiUrlParamName: string;

  constructor(scope: Construct, id: string, props: CapacityBlockApiProps) {
    super(scope, id);

    const { lambdaCodePath, environment = {} } = props;
    const stack = cdk.Stack.of(this);
    const stackName = stack.stackName;

    this.handler = new lambda.Function(this, 'CBApiHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: lambda.Code.fromAsset(lambdaCodePath),
      handler: 'index.handler',
      environment: {
        TABLE_NAME: props.table.tableName,
        ...environment,
      },
    });

    props.table.grantReadWriteData(this.handler);

    this.api = new apigateway.RestApi(this, 'CBApi', {
      restApiName: 'CapacityBlock API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
      apiKeySourceType: apigateway.ApiKeySourceType.HEADER,
    });

    const secret = new secretsmanager.Secret(this, 'ApiSecret', {
      secretName: `/cbm/${stackName}/apiSecretName`,
      generateSecretString: {
        generateStringKey: 'api_key',
        secretStringTemplate: JSON.stringify({ username: 'web_user' }),
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
    });

    const apiKey = this.api.addApiKey('ApiKey', {
      apiKeyName: `cbm-api-key`,
      value: secret.secretValueFromJson('api_key').unsafeUnwrap(),
    });

    const usagePlan = this.api.addUsagePlan('CBUsagePlan', {
      name: 'DefaultUsagePlan',
      apiStages: [{ api: this.api, stage: this.api.deploymentStage }],
    });
    usagePlan.addApiKey(apiKey);

    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      this.api.root.addMethod(method, new apigateway.LambdaIntegration(this.handler), {
        apiKeyRequired: true,
      });
    }

    const apiUrl = `https://${this.api.restApiId}.execute-api.${stack.region}.amazonaws.com/${this.api.deploymentStage.stageName}`;

    const apiUrlParam = new ssm.StringParameter(this, 'ApiUrlParam', {
      parameterName: `/cbm/${stackName}/apiUrl`,
      stringValue: apiUrl,
    });

    this.apiSecretName = secret.secretName;
    this.apiUrlParamName = apiUrlParam.parameterName;

    new cdk.CfnOutput(this, 'ApiSecretName', {
      value: this.apiSecretName,
      description: 'SecretsManager name storing the API key',
    });

    new cdk.CfnOutput(this, 'ApiUrlSSMParameter', {
      value: this.apiUrlParamName,
      description: 'SSM parameter storing the deployed API URL',
    });
  }
}
