# Capacity Block Manager (CBM)

This project automates management of AWS Capacity Block compute environments using a CDK-deployed API and Lambda function. It supports extension logic, approval workflows, and secure API-key-based access.

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

3. Use the API key and URL in requests (see `test/seed_compute_envs_via_api.py` for reference).

---

## 🧪 Test Script Example

See [`test/seed_compute_envs_via_api.py`](./test/seed_compute_envs_via_api.py):

- Fetches the API key and URL from SSM
- Looks up active Capacity Block reservations
- Posts entries to the API using `POST`
- Can be used to test both approval and non-approval workflows

> **Note:** Be sure to set the correct AWS credentials/profile with access to SSM, Secrets Manager, and EC2 DescribeCapacityReservations.

---

## ✅ API Operations

All requests must include the `x-api-key` header.

Supported methods on the root (`/`):

| Method  | Description                        |
|---------|------------------------------------|
| `GET`   | List all compute environments      |
| `GET ?PK=...` | Get one environment by PK    |
| `POST`  | Create a new compute environment   |
| `PUT`   | Update an existing environment     |
| `DELETE`| Delete by PK                       |
| `PATCH` | Approve an environment (`approval=true`) |

---
