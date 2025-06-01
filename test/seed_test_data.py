import boto3
from datetime import datetime, timezone

dynamodb = boto3.resource('dynamodb')
ec2 = boto3.client('ec2')

table_name = 'CapacityBlockManagerStack-CBJobTableD1DCF005-1DN87N8D98ATB'
table = dynamodb.Table(table_name)

# --- Clear table ---
print(f"Clearing existing items from {table_name}...")
scan = table.scan(ProjectionExpression='PK')
with table.batch_writer() as batch:
    for item in scan.get('Items', []):
        batch.delete_item(Key={'PK': item['PK']})
print("Table cleared.")

# --- Describe Capacity Reservations ---
def get_end_time(capacity_block_id):
    resp = ec2.describe_capacity_reservations(CapacityReservationIds=[capacity_block_id])
    if not resp['CapacityReservations']:
        raise Exception(f"Reservation {capacity_block_id} not found")
    return resp['CapacityReservations'][0]['EndDate']

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

for block in test_blocks:
    end_time = get_end_time(block['capacity_block_id'])
    diff_days = (end_time - now).days
    # set lookahead so we're inside it
    # lookahead_days = max(diff_days + 1, 0)

    entries.append({
        **block,
        'end_time': end_time.isoformat(),
        'extension_lookahead_days': 2,
        'status': 'PENDING',
    })

with table.batch_writer() as batch:
    for entry in entries:
        batch.put_item(Item=entry)

print("Test items inserted.")
