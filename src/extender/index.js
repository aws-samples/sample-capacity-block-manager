const {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');
const {
  EC2Client,
  DescribeCapacityBlockExtensionOfferingsCommand,
  PurchaseCapacityBlockExtensionCommand,
} = require('@aws-sdk/client-ec2');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const ddb = new DynamoDBClient();
const ec2 = new EC2Client();
// Only initialize SNS client if APPROVAL_TOPIC_ARN is defined
const sns = process.env.APPROVAL_TOPIC_ARN ? new SNSClient() : null;

const TABLE_NAME = process.env.TABLE_NAME;
const APPROVAL_TOPIC_ARN = process.env.APPROVAL_TOPIC_ARN;
const APPROVAL_WORKFLOW_ENABLED = !!APPROVAL_TOPIC_ARN;

exports.handler = async () => {
  const now = new Date();

  let items = [];
  try {
    console.log(`[INFO] Scanning table ${TABLE_NAME}...`);
    const result = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
    items = result.Items.map(unmarshall);
    console.log(`[INFO] Retrieved ${items.length} items from table`);
  } catch (err) {
    console.error('[ERROR] Failed to scan table:', err);
    return;
  }

  for (const item of items) {
    console.log(`[INFO] Processing item: ${item.PK}`);
    try {
      if (!item.capacity_block_id || !item.end_time) {
        throw new Error('Missing capacity_block_id or end_time');
      }

      const endTime = new Date(item.end_time);
      const lookaheadTime = new Date(endTime);
      lookaheadTime.setDate(endTime.getDate() - item.extension_lookahead_days);

      console.log(`[DEBUG] Now: ${now.toISOString()}, End: ${endTime.toISOString()}, Lookahead: ${lookaheadTime.toISOString()}`);

      if (now < lookaheadTime) {
        console.log(`[INFO] No action required for ${item.PK}`);
        await updateStatus(item.PK, 'NO_ACTION_REQUIRED');
        continue;
      }

      if (item.require_approval) {
        if (!item.approval) {
          console.log(`[INFO] Approval required for ${item.PK}`);
          await updateStatus(item.PK, 'EXTENSION_APPROVAL_REQUIRED');
          
          if (APPROVAL_WORKFLOW_ENABLED) {
            console.log(`[INFO] Sending approval notification for ${item.PK}...`);
            await sendApprovalRequest(item);
          } else {
            console.log(`[INFO] Approval workflow disabled (no ADMIN_EMAIL set). Skipping notification for ${item.PK}`);
            // If approval workflow is disabled but item requires approval, we can either:
            // Option 1: Auto-approve (current implementation)
            console.log(`[INFO] Auto-approving ${item.PK} since approval workflow is disabled`);
            await ddb.send(new UpdateItemCommand({
              TableName: TABLE_NAME,
              Key: { PK: { S: item.PK } },
              UpdateExpression: 'SET #approval = :a',
              ExpressionAttributeNames: {
                '#approval': 'approval',
              },
              ExpressionAttributeValues: {
                ':a': { BOOL: true },
              },
            }));
            // Option 2: Skip this item until manually approved (uncomment below if preferred)
            // console.log(`[INFO] Skipping ${item.PK} until manually approved`);
            // continue;
          }
          continue;
        } else {
          console.log(`[INFO] Approval granted for ${item.PK}, proceeding with extension`);
        }
      }

      const hours = item.extend_by_days * 24;
      console.log(`[INFO] Attempting to extend ${item.capacity_block_id} by ${hours} hours`);

      const describeRes = await ec2.send(new DescribeCapacityBlockExtensionOfferingsCommand({
        CapacityReservationId: item.capacity_block_id,
        CapacityBlockExtensionDurationHours: hours,
      }));

      const offerings = describeRes.CapacityBlockExtensionOfferings;
      if (!offerings || offerings.length === 0) {
        throw new Error(`No extension offerings available for ${item.capacity_block_id}`);
      }

      const offeringId = offerings[0].CapacityBlockExtensionOfferingId;

      console.log(`[INFO] Purchasing extension with offering ID: ${offeringId}`);

      await ec2.send(new PurchaseCapacityBlockExtensionCommand({
        CapacityReservationId: item.capacity_block_id,
        CapacityBlockExtensionOfferingId: offeringId,
      }));

      const newEndTime = new Date(endTime);
      newEndTime.setDate(endTime.getDate() + item.extend_by_days);

      await ddb.send(new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: { PK: { S: item.PK } },
        UpdateExpression: 'SET #status = :s, end_time = :t, #approval = :a REMOVE #error',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#error': 'error',
          '#approval': 'approval',
        },
        ExpressionAttributeValues: {
          ':s': { S: 'EXTENDED' },
          ':t': { S: newEndTime.toISOString() },
          ':a': { BOOL: false },
        },
      }));

      console.log(`[SUCCESS] Extended ${item.PK} until ${newEndTime.toISOString()}`);
    } catch (err) {
      console.error(`[ERROR] Error processing ${item.PK}:`, err);
      await updateStatus(item.PK, 'ERROR', err.message);
    }
  }
};

async function updateStatus(pk, status, errorMessage = null) {
  const params = {
    TableName: TABLE_NAME,
    Key: { PK: { S: pk } },
    UpdateExpression: errorMessage
      ? 'SET #status = :s, #error = :e'
      : 'SET #status = :s REMOVE #error',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#error': 'error',
    },
    ExpressionAttributeValues: {
      ':s': { S: status },
    },
  };

  if (errorMessage) {
    params.ExpressionAttributeValues[':e'] = { S: errorMessage };
  }

  await ddb.send(new UpdateItemCommand(params));
}

async function sendApprovalRequest(item) {
  if (!APPROVAL_TOPIC_ARN || !sns) {
    console.warn('[WARN] APPROVAL_TOPIC_ARN is not defined or SNS client not initialized, skipping SNS publish');
    return;
  }

  const message = {
    Subject: `Approval Required: ${item.name || item.PK}`,
    Message: `Capacity block ${item.capacity_block_id} for ${item.name || item.PK} in ${item.region} requires approval for extension.`,
    TopicArn: APPROVAL_TOPIC_ARN,
  };

  try {
    await sns.send(new PublishCommand(message));
    console.log(`[INFO] Sent approval email for ${item.PK}`);
  } catch (err) {
    console.error(`[ERROR] Failed to send approval notification for ${item.PK}:`, err);
  }
}
