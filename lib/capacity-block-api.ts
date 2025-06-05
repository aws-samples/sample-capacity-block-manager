import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';

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

    // Create CloudWatch log group for API access logs
    const accessLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create Lambda function with more secure IAM permissions
    this.handler = new lambda.Function(this, 'CBApiHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: lambda.Code.fromAsset(lambdaCodePath),
      handler: 'index.handler',
      environment: {
        TABLE_NAME: props.table.tableName,
        ...environment,
      },
      // Add tracing for better observability
      tracing: lambda.Tracing.ACTIVE,
    });

    // Add suppressions for IAM4 findings
    NagSuppressions.addResourceSuppressions(
      this.handler,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'Lambda execution role requires AWSLambdaBasicExecutionRole for CloudWatch Logs access'
        }
      ],
      true
    );

    // Grant specific permissions to the Lambda function instead of using managed policies
    props.table.grantReadWriteData(this.handler);

    // Add suppressions for IAM5 findings on the handler
    NagSuppressions.addResourceSuppressions(
      this.handler,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'DynamoDB permissions are scoped to specific table',
          appliesTo: ['Resource::*']
        }
      ],
      true
    );

    // Create API with improved security settings
    this.api = new apigateway.RestApi(this, 'CBApi', {
      restApiName: 'CapacityBlock API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
      apiKeySourceType: apigateway.ApiKeySourceType.HEADER,
      // Enable CloudWatch logging for API Gateway
      deployOptions: {
        accessLogDestination: new apigateway.LogGroupLogDestination(accessLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        tracingEnabled: true,
        stageName: 'prod',
        metricsEnabled: true,
      },
      // Use REGIONAL endpoint type only
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      minCompressionSize: cdk.Size.kibibytes(10),
    });

    // Create request validator for API
    const requestValidator = new apigateway.RequestValidator(this, 'DefaultValidator', {
      restApi: this.api,
      validateRequestBody: true,
      validateRequestParameters: true,
    });

    // Create a model for request validation
    const requestModel = this.api.addModel('RequestModel', {
      contentType: 'application/json',
      modelName: 'CBRequestModel',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['PK'],
        properties: {
          PK: { type: apigateway.JsonSchemaType.STRING },
          // Add other properties as needed
        },
      },
    });

    // Create rotation Lambda for secret with custom policy
    const rotationLambda = new lambda.Function(this, 'SecretRotationLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: lambda.Code.fromAsset('src/rotation'),
      handler: 'index.handler',
      environment: {
        API_ID: this.api.restApiId,
      },
    });
    
    // Add suppressions for IAM4 findings on rotation lambda
    NagSuppressions.addResourceSuppressions(
      rotationLambda,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'Lambda execution role requires AWSLambdaBasicExecutionRole for CloudWatch Logs access'
        }
      ],
      true
    );

    // Add suppressions for IAM5 findings on rotation lambda
    NagSuppressions.addResourceSuppressions(
      rotationLambda,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Secrets Manager rotation requires access to the secret',
          appliesTo: ['Resource::*']
        }
      ],
      true
    );
    
    // Create API key with improved security
    const secret = new secretsmanager.Secret(this, 'ApiSecret', {
      secretName: `/cbm/${stackName}/apiSecretName`,
      generateSecretString: {
        generateStringKey: 'api_key',
        secretStringTemplate: JSON.stringify({ username: 'web_user' }),
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
    });
    
    // Set up rotation for the secret
    secret.addRotationSchedule('RotationSchedule', {
      rotationLambda: rotationLambda,
      automaticallyAfter: cdk.Duration.days(30),
    });

    const apiKey = this.api.addApiKey('ApiKey', {
      apiKeyName: `cbm-api-key`,
      value: secret.secretValueFromJson('api_key').unsafeUnwrap(),
    });

    // Update the rotation Lambda with the API key ID
    const cfnApiKey = apiKey.node.defaultChild as apigateway.CfnApiKey;
    rotationLambda.addEnvironment('API_KEY_ID', cfnApiKey.ref);

    const usagePlan = this.api.addUsagePlan('CBUsagePlan', {
      name: 'DefaultUsagePlan',
      apiStages: [{ api: this.api, stage: this.api.deploymentStage }],
      // Add rate limiting for security
      throttle: {
        rateLimit: 10,
        burstLimit: 20,
      },
      quota: {
        limit: 1000,
        period: apigateway.Period.DAY,
      },
    });
    usagePlan.addApiKey(apiKey);

    // Create a WAF WebACL for the API
    const webAcl = new wafv2.CfnWebACL(this, 'ApiWafAcl', {
      defaultAction: { allow: {} },
      scope: 'REGIONAL',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'CBApiWaf',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'RateLimitRule',
          priority: 1,
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimit',
            sampledRequestsEnabled: true,
          },
          statement: {
            rateBasedStatement: {
              limit: 100,
              aggregateKeyType: 'IP',
            },
          },
        },
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSet',
            sampledRequestsEnabled: true,
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
        },
      ],
    });

    // Associate WAF WebACL with API stage
    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: `arn:aws:apigateway:${stack.region}::/restapis/${this.api.restApiId}/stages/${this.api.deploymentStage.stageName}`,
      webAclArn: webAcl.attrArn,
    });

    // Create integration response configuration
    const integrationResponses = [
      {
        statusCode: '200',
        responseParameters: {
          'method.response.header.Content-Type': "'application/json'",
          'method.response.header.Access-Control-Allow-Origin': "'*'",
        },
      },
      {
        selectionPattern: '4\\d{2}',
        statusCode: '400',
        responseParameters: {
          'method.response.header.Content-Type': "'application/json'",
          'method.response.header.Access-Control-Allow-Origin': "'*'",
        },
      },
      {
        selectionPattern: '5\\d{2}',
        statusCode: '500',
        responseParameters: {
          'method.response.header.Content-Type': "'application/json'",
          'method.response.header.Access-Control-Allow-Origin': "'*'",
        },
      },
    ];

    // Create method response configuration
    const methodResponses = [
      {
        statusCode: '200',
        responseParameters: {
          'method.response.header.Content-Type': true,
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      },
      {
        statusCode: '400',
        responseParameters: {
          'method.response.header.Content-Type': true,
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      },
      {
        statusCode: '500',
        responseParameters: {
          'method.response.header.Content-Type': true,
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      },
    ];

    // Add methods to root resource for collection operations
    for (const method of ['GET', 'POST']) {
      this.api.root.addMethod(
        method, 
        new apigateway.LambdaIntegration(this.handler, {
          proxy: true,
          integrationResponses,
        }),
        {
          apiKeyRequired: true,
          requestValidator: requestValidator,
          requestModels: method === 'POST' ? { 'application/json': requestModel } : undefined,
          methodResponses,
        }
      );
    }

    // Create resource for individual item operations with path parameter
    const pkResource = this.api.root.addResource('{PK}');
    
    // Add methods to PK resource for individual item operations
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      pkResource.addMethod(
        method, 
        new apigateway.LambdaIntegration(this.handler, {
          proxy: true,
          integrationResponses,
        }),
        {
          apiKeyRequired: true,
          requestValidator: requestValidator,
          requestModels: method === 'PUT' ? { 'application/json': requestModel } : undefined,
          methodResponses,
          requestParameters: {
            'method.request.path.PK': true, // Make PK path parameter required
          },
        }
      );
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
