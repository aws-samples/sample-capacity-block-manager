# Capacity Block Manager (CBM)

This project automates management of AWS Capacity Block compute environments using a CDK-deployed API and Lambda function. It supports extension logic, approval workflows, and secure API-key-based access.

## 🔍 Overview

The Capacity Block Manager (CBM) helps you:

- Track and manage AWS Capacity Block reservations
- Automate extension workflows for existing capacity blocks
- Implement approval processes for capacity changes
- Securely manage compute environments via API

---

## 🔧 Deployment Instructions

1. **Install dependencies**

```bash
npm install
```

2. **Deploy the stack**

```bash
npx cdk deploy
```

This will:

- Create a DynamoDB table
- Deploy a Lambda function
- Deploy an API Gateway with API key authentication
- Generate and store the API key in AWS Secrets Manager
- Output the following **SSM parameters**:
  - `/cbm/<StackName>/apiSecretName` — name of the secret containing the API key
  - `/cbm/<StackName>/apiUrl` — the full URL of the deployed API

---

## 📡 Using the API

Once deployed:

1. Look at the CloudFormation output:
   - `ApiSecretName` → name of the Secrets Manager entry holding the API key
   - `ApiUrlSSMParameter` → parameter name in SSM for the API Gateway URL

2. Use your preferred AWS tooling to retrieve values:

```bash
aws ssm get-parameter --name /cbm/CapacityBlockManagerStack/apiUrl
aws ssm get-parameter --name /cbm/CapacityBlockManagerStack/apiSecretName
```

3. Retrieve the API key from Secrets Manager:

```bash
# First get the secret name
SECRET_NAME=$(aws ssm get-parameter --name /cbm/CapacityBlockManagerStack/apiSecretName --query "Parameter.Value" --output text)

# Then retrieve the actual API key
API_KEY=$(aws secretsmanager get-secret-value --secret-id $SECRET_NAME --query "SecretString" --output text)
```

4. Get the API URL:

```bash
API_URL=$(aws ssm get-parameter --name /cbm/CapacityBlockManagerStack/apiUrl --query "Parameter.Value" --output text)
```

---

## 🧪 Test Script Example

See [`test/seed_compute_envs_via_api.py`](./test/seed_compute_envs_via_api.py):

- Fetches the API key and URL from SSM
- Looks up active Capacity Block reservations
- Posts entries to the API using `POST`
- Can be used to test both approval and non-approval workflows

> **Note:** Be sure to set the correct AWS credentials/profile with access to SSM, Secrets Manager, and EC2 DescribeCapacityReservations.

---

## 📚 API Reference

All requests must include the `x-api-key` header with your API key.

### Supported Methods

| Method  | Endpoint      | Description                        | Path Parameters  |
|---------|---------------|------------------------------------|------------------|
| `GET`   | `/`           | List all compute environments      | None             |
| `GET`   | `/{PK}`       | Get one environment by PK          | `PK` (required)  |
| `POST`  | `/`           | Create a new compute environment   | None             |
| `PUT`   | `/{PK}`       | Update an existing environment     | `PK` (required)  |
| `DELETE`| `/{PK}`       | Delete by PK                       | `PK` (required)  |
| `PATCH` | `/{PK}`       | Approve an environment             | `PK` (required)  |

### Data Model

Compute environment objects have the following structure:

```json
{
  "PK": "string",                  // Primary key (unique identifier)
  "capacityReservationId": "string", // AWS Capacity Reservation ID
  "instanceType": "string",        // EC2 instance type
  "availabilityZone": "string",    // AWS Availability Zone
  "platform": "string",            // Platform (e.g., "Linux/UNIX")
  "tenancy": "string",             // Tenancy type
  "startDate": "string",           // ISO date string
  "endDate": "string",             // ISO date string
  "instanceCount": number,         // Number of instances
  "approved": boolean,             // Approval status
  "createdAt": "string",           // ISO date string
  "updatedAt": "string"            // ISO date string
}
```

### Example API Requests

#### List All Compute Environments

```bash
curl -X GET $API_URL \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json"
```

#### Get a Specific Compute Environment

```bash
curl -X GET "$API_URL/{PK}" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json"
```

#### Create a New Compute Environment

```bash
curl -X POST $API_URL \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "PK": "env-123",
    "capacityReservationId": "cr-0123456789abcdef0",
    "instanceType": "p4d.24xlarge",
    "availabilityZone": "us-east-1a",
    "platform": "Linux/UNIX",
    "tenancy": "default",
    "startDate": "2025-01-01T00:00:00Z",
    "endDate": "2025-06-30T23:59:59Z",
    "instanceCount": 8,
    "approved": false
  }'
```

#### Update an Existing Compute Environment

```bash
curl -X PUT "$API_URL/{PK}" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceCount": 16,
    "endDate": "2025-12-31T23:59:59Z"
  }'
```

#### Approve a Compute Environment

```bash
curl -X PATCH "$API_URL/{PK}" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json"
```

#### Delete a Compute Environment

```bash
curl -X DELETE "$API_URL/{PK}" \
  -H "x-api-key: $API_KEY"
```

### Response Formats

Successful responses will return:

```json
{
  "statusCode": 200,
  "body": "..."  // JSON string containing result data
}
```

Error responses will return:

```json
{
  "statusCode": 400,  // Or other appropriate error code
  "body": "Error message"
}
```

---

## 🔒 Security Considerations

- The API is secured using API key authentication
- API keys are stored in AWS Secrets Manager
- Access to the API should be restricted to authorized personnel
- Consider implementing additional IAM policies to restrict access to the API Gateway

---

## 🛠️ Troubleshooting

Common issues:

1. **API Key Issues**: Ensure the API key is correctly retrieved from Secrets Manager and included in the `x-api-key` header
2. **Permission Issues**: Check IAM permissions for accessing DynamoDB, Secrets Manager, and SSM
3. **Deployment Failures**: Verify AWS credentials and region settings

---
