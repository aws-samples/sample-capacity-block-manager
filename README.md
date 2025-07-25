# Guidance for Capacity Block Manager on AWS

![](./logo.png)

This Guidance demonstrates how to automate management of AWS Capacity Block compute environments using a CDK-deployed API and Lambda function. It supports extension logic, approval workflows, and secure API-key-based access for continuous capacity management.

## Table of Contents

1. [Overview](#overview)
    - [Cost](#cost)
2. [Prerequisites](#prerequisites)
    - [Operating System](#operating-system)
    - [AWS CDK Bootstrap](#aws-cdk-bootstrap)
3. [Deployment Steps](#deployment-steps)
4. [Deployment Validation](#deployment-validation)
5. [Running the Guidance](#running-the-guidance)
6. [Next Steps](#next-steps)
7. [Cleanup](#cleanup)
8. [FAQ, known issues, additional considerations, and limitations](#faq-known-issues-additional-considerations-and-limitations)

## Overview

This Guidance automates the entire capacity block lifecycle management process for organizations using AWS Capacity Blocks. It solves the challenges of manual capacity management by providing automated extension detection that continuously monitors capacity blocks approaching expiration, configurable approval workflows for capacity extensions, secure API management with RESTful API and authentication for programmatic access, and cost optimization that maintains optimal balance between on-demand and reserved capacity.

![Capacity Block Manager Architecture](diagram.png)

The Capacity Block Manager follows a serverless architecture:

1. **EventBridge Rule**: A scheduled EventBridge rule runs every minute, triggering the Capacity Block Manager Lambda function
2. **Lambda Function**: Scans DynamoDB for capacity block records and processes extensions based on configuration
3. **DynamoDB**: Stores capacity block records with configuration, status, and expiration details
4. **SNS Topic** (Optional): Sends approval notifications when required
5. **API Gateway**: Provides RESTful API for managing capacity block records with authentication
6. **Secrets Manager**: Securely stores API keys with automatic rotation

### Cost

You are responsible for the cost of the AWS services used while running this Guidance. As of December 2024, the cost for running this Guidance with the default settings in the US East (Ohio) region is approximately $7.40 per month for processing typical capacity block management workloads.

We recommend creating a [Budget](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html) through [AWS Cost Explorer](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/) to help manage costs. Prices are subject to change. For full details, refer to the pricing webpage for each AWS service used in this Guidance.

#### Sample Cost Table

The following table provides a sample cost breakdown for deploying this Guidance with the default parameters in the US East (Ohio) Region for one month.

| AWS service | Dimensions | Cost [USD] |
| ----------- | ------------ | ------------ |
| AWS WAF | 1 Web ACL with 2 rules | $7.00 |
| AWS Secrets Manager | 1 secret with rotation | $0.40 |
| AWS Lambda | 200 requests per month | $0.00 |
| Amazon DynamoDB | Small data storage (.001 GB) | $0.00 |
| Amazon EventBridge | 90 events per month | $0.00 |
| Amazon API Gateway | 90 REST API requests per month | $0.00 |
| Amazon SNS | 90 notifications per month | $0.00 |
| **Total** | | **$7.40** |

## Prerequisites

### Operating System

These deployment instructions are optimized to best work on **Amazon Linux 2023 AMI**. Deployment on another OS may require additional steps.

Required software:
- Node.js 18.x or later
- npm 8.x or later
- AWS CLI v2
- Git

Install commands for Amazon Linux 2023:
```bash
# Install Node.js and npm
sudo dnf install nodejs npm -y

# Install AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Verify installations
node --version
npm --version
aws --version
```

### AWS CDK Bootstrap

This Guidance uses AWS CDK. If you are using AWS CDK for the first time, please perform the following bootstrapping:

```bash
npm install -g aws-cdk
cdk bootstrap aws://ACCOUNT-NUMBER/REGION
```

Replace `ACCOUNT-NUMBER` with your AWS account ID and `REGION` with your preferred AWS region.

### AWS Account Requirements

- AWS CLI configured with appropriate permissions
- IAM permissions for:
  - Lambda function creation and execution
  - DynamoDB table creation and management
  - API Gateway creation and management
  - EventBridge rule creation
  - Secrets Manager access
  - SNS topic creation (if using approval workflow)
  - WAF Web ACL creation

### Service Limits

This Guidance operates within default AWS service limits. No service limit increases are required for typical usage patterns.

### Supported Regions

This Guidance can be deployed in any AWS region that supports all the required services:
- AWS Lambda
- Amazon DynamoDB
- Amazon API Gateway
- Amazon EventBridge
- AWS Secrets Manager
- Amazon SNS
- AWS WAF

## Deployment Steps

1. Clone the repository:
   ```bash
   git clone <repository-url>
   ```

2. Navigate to the project directory:
   ```bash
   cd sample-capacity-block-manager
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. (Optional) Set up email notifications for approval workflow:
   ```bash
   export ADMIN_EMAIL=your.email@example.com
   ```

5. Deploy the stack:
   ```bash
   npx cdk deploy
   ```

6. Capture the API URL and Secret Name from the deployment output or retrieve from SSM:
   ```bash
   # Get API URL
   aws ssm get-parameter --name /cbm/CapacityBlockManagerStack/apiUrl --query "Parameter.Value" --output text
   
   # Get Secret Name
   aws ssm get-parameter --name /cbm/CapacityBlockManagerStack/apiSecretName --query "Parameter.Value" --output text
   ```

## Deployment Validation

1. Open the CloudFormation console and verify the status of the template with the name `CapacityBlockManagerStack`

2. If deployment is successful, you should see:
   - A DynamoDB table with the name starting with `CapacityBlockManagerStack-CBJobTable`
   - Lambda functions for capacity block processing and API handling
   - An API Gateway with the name `CapacityBlock API`
   - A Secrets Manager secret for API key storage

3. Run the following CLI command to validate the deployment:
   ```bash
   aws cloudformation describe-stacks --stack-name CapacityBlockManagerStack --query "Stacks[0].StackStatus"
   ```
   
   Expected output: `"CREATE_COMPLETE"`

4. Test API connectivity:
   ```bash
   # Retrieve API key
   SECRET_NAME=$(aws ssm get-parameter --name /cbm/CapacityBlockManagerStack/apiSecretName --query "Parameter.Value" --output text)
   API_KEY=$(aws secretsmanager get-secret-value --secret-id $SECRET_NAME --query "SecretString" --output text | jq -r '.api_key')
   
   # Get API URL
   API_URL=$(aws ssm get-parameter --name /cbm/CapacityBlockManagerStack/apiUrl --query "Parameter.Value" --output text)
   
   # Test API
   curl -X GET $API_URL -H "x-api-key: $API_KEY" -H "Content-Type: application/json"
   ```

## Running the Guidance

### Guidance Inputs

The system processes capacity block records stored in DynamoDB with the following structure:

```json
{
  "PK": "unique-identifier",
  "capacity_block_id": "cr-1234567890abcdef0",
  "instance_type": "p4de.24xlarge",
  "region": "us-east-1",
  "end_time": "2025-06-13T17:00:00Z",
  "extend_by_days": 7,
  "require_approval": false,
  "extension_lookahead_days": 2,
  "status": "ACTIVE"
}
```

### Commands to Run

1. **Create a capacity block record via API**:
   ```bash
   curl -X POST $API_URL \
     -H "x-api-key: $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "PK": "test-capacity-block",
       "capacity_block_id": "cr-1234567890abcdef0",
       "instance_type": "p4de.24xlarge",
       "region": "us-east-1",
       "end_time": "2025-06-13T17:00:00Z",
       "extend_by_days": 7,
       "require_approval": false,
       "extension_lookahead_days": 2,
       "status": "ACTIVE"
     }'
   ```

2. **List all capacity block records**:
   ```bash
   curl -X GET $API_URL \
     -H "x-api-key: $API_KEY" \
     -H "Content-Type: application/json"
   ```

3. **Use the test script** (requires Python and boto3):
   ```bash
   cd test
   pip install -r requirements.txt
   python seed_compute_envs_via_api.py
   ```

### Expected Output

**API Response for successful creation**:
```json
{
  "statusCode": 200,
  "body": "{\"message\":\"Item created successfully\",\"item\":{\"PK\":\"test-capacity-block\",\"capacity_block_id\":\"cr-1234567890abcdef0\",\"createdAt\":\"2024-12-25T16:00:00.000Z\"}}"
}
```

**Lambda Processing Logs** (visible in CloudWatch):
```
[INFO] Scanning table CapacityBlockManagerStack-CBJobTable...
[INFO] Retrieved 1 items from table
[INFO] Processing item: test-capacity-block
[DEBUG] Now: 2024-12-25T16:00:00.000Z, End: 2025-06-13T17:00:00Z, Lookahead: 2025-06-11T17:00:00Z
[INFO] Item test-capacity-block is not yet in extension window
```

### Output Description

- The system continuously monitors capacity blocks every minute via EventBridge
- When a capacity block approaches its expiration (within the lookahead window), the system automatically processes extension requests
- If approval is required, notifications are sent via SNS
- All processing activities are logged to CloudWatch for monitoring and troubleshooting

## Next Steps

To enhance this Guidance according to your requirements:

1. **Customize Extension Logic**: Modify the Lambda function in `src/extender/index.js` to implement custom extension logic based on your business rules

2. **Integrate with External Systems**: Use the API to integrate with existing capacity management or monitoring systems

3. **Enhanced Monitoring**: Add CloudWatch dashboards and alarms for capacity block metrics

4. **Multi-Region Support**: Deploy the stack in multiple regions for global capacity management

5. **Advanced Approval Workflows**: Integrate with AWS Step Functions for complex approval processes

6. **Cost Optimization**: Implement logic to analyze capacity utilization and optimize extension decisions

## Cleanup

1. Delete the CloudFormation stack:
   ```bash
   npx cdk destroy
   ```

2. Confirm deletion when prompted by typing `y`

3. Manually delete any remaining resources if needed:
   - CloudWatch log groups (if retention is set to never expire)
   - Any manually created capacity block reservations

4. If you used the approval workflow, unsubscribe from SNS notifications:
   - Go to the SNS console
   - Find the topic created by the stack
   - Unsubscribe your email address

## FAQ, known issues, additional considerations, and limitations

### Known Issues

**Issue**: API Gateway returns 403 Forbidden
**Resolution**: Ensure the API key is correctly retrieved from Secrets Manager and included in the `x-api-key` header

**Issue**: Lambda function timeout during capacity block processing
**Resolution**: The function has a 30-second timeout. For large numbers of capacity blocks, consider implementing pagination or increasing the timeout

### Additional Considerations

- This Guidance creates API endpoints that require API key authentication. Ensure API keys are properly managed and rotated
- The EventBridge rule runs every minute, which may generate CloudWatch logs. Monitor log retention settings to manage costs
- Capacity block extensions are subject to AWS availability and pricing at the time of extension
- The approval workflow requires manual confirmation of SNS email subscriptions

### Limitations

- The system processes capacity blocks sequentially, which may impact performance with large numbers of reservations
- Extension decisions are based on time-based rules only; utilization-based extensions require custom implementation
- The solution is designed for single-account capacity management; cross-account scenarios require additional IAM configuration

For any feedback, questions, or suggestions, please use the issues tab under this repository.

## Revisions

| Version | Date | Description |
|---------|------|-------------|
| 1.0.0 | December 2024 | Initial release with automated capacity block management |

## Notices

Customers are responsible for making their own independent assessment of the information in this Guidance. This Guidance: (a) is for informational purposes only, (b) represents AWS current product offerings and practices, which are subject to change without notice, and (c) does not create any commitments or assurances from AWS and its affiliates, suppliers or licensors. AWS products or services are provided "as is" without warranties, representations, or conditions of any kind, whether express or implied. AWS responsibilities and liabilities to its customers are controlled by AWS agreements, and this Guidance is not part of, nor does it modify, any agreement between AWS and its customers.
