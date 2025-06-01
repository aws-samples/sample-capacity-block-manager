import boto3
import requests
from datetime import datetime, timezone
import json

# === CONFIG ===
STACK_NAME = 'CapacityBlockManagerStack'
SECRET_PARAM = f'/cbm/{STACK_NAME}/apiSecretName'
API_URL_PARAM = f'/cbm/{STACK_NAME}/apiUrl'

# === INIT AWS CLIENTS ===
ssm = boto3.client('ssm')
secretsmanager = boto3.client('secretsmanager')
ec2 = boto3.client('ec2')

# === Resolve secret name and api url from parameter store ===
def get_ssm_param(name):
    return ssm.get_parameter(Name=name, WithDecryption=False)['Parameter']['Value']

secret_name = get_ssm_param(SECRET_PARAM)
api_url = get_ssm_param(API_URL_PARAM)

# === Retrieve API key from Secrets Manager ===
def get_api_key(secret_name):
    response = secretsmanager.get_secret_value(SecretId=secret_name)
    return json.loads(response['SecretString'])['api_key']

api_key = get_api_key(secret_name)
headers = {
    'x-api-key': api_key,
    'Content-Type': 'application/json'
}

# === Describe Capacity Reservations ===
def get_end_time(capacity_block_id):
    resp = ec2.describe_capacity_reservations(CapacityReservationIds=[capacity_block_id])
    if not resp['CapacityReservations']:
        raise Exception(f"Reservation {capacity_block_id} not found")
    return resp['CapacityReservations'][0]['EndDate']

# === Test Data ===
test_blocks = [
    {
        'PK': 'test-no-approval',
        'name': 'NoApprovalJob',
        'region': 'us-east-1',
        'instance_type': 'p4d.24xlarge',
        'capacity_block_id': 'cr-030c80508f2cbf949',
        'extend_by_days': 1,
        'require_approval': False,
    },
    {
        'PK': 'test-requires-approval',
        'name': 'RequiresApprovalJob',
        'region': 'us-east-1',
        'instance_type': 'p4de.24xlarge',
        'capacity_block_id': 'cr-0ee54c612851fa358',
        'extend_by_days': 1,
        'require_approval': True,
        'approval': False,
    }
]

now = datetime.now(timezone.utc)
entries = []

# === Create Entries ===
for block in test_blocks:
    end_time = get_end_time(block['capacity_block_id'])
    entries.append({
        **block,
        'end_time': end_time.isoformat(),
        'extension_lookahead_days': 2,
        'status': 'PENDING',
    })

# === Send POST requests to API ===
for entry in entries:
    print(f"[INFO] Creating compute environment: {entry['PK']}")
    res = requests.post(api_url, json=entry, headers=headers)
    if res.ok:
        print(f"[OK] {entry['PK']} created.")
    else:
        print(f"[ERROR] {entry['PK']} failed: {res.status_code} {res.text}")
