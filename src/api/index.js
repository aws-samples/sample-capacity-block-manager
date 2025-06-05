const { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand, UpdateItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');

const ddb = new DynamoDBClient();
const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  const method = event.httpMethod;
  const body = event.body ? JSON.parse(event.body) : {};
  
  // Get PK from path parameters if available, otherwise from body
  const pk = event.pathParameters?.PK || body.PK;

  try {
    // Handle collection-level operations (no PK in path)
    if (!event.pathParameters?.PK) {
      switch (method) {
        case 'GET': {
          // List all items
          const res = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
          return response(200, res.Items.map(unmarshall));
        }
        
        case 'POST': {
          // Create new item
          if (!body.PK) return response(400, { error: 'PK required in request body' });
          await ddb.send(new PutItemCommand({
            TableName: TABLE_NAME,
            Item: marshall(body),
          }));
          return response(201, { status: 'Created' });
        }
        
        default:
          return response(405, { error: 'Method not allowed on collection endpoint' });
      }
    }
    
    // Handle item-level operations (PK in path)
    switch (method) {
      case 'GET': {
        // Get specific item
        const res = await ddb.send(new GetItemCommand({
          TableName: TABLE_NAME,
          Key: { PK: { S: pk } },
        }));
        return res.Item
          ? response(200, unmarshall(res.Item))
          : response(404, { error: 'Not found' });
      }

      case 'PUT': {
        // Update item
        const updates = [];
        const exprAttrNames = {};
        const exprAttrValues = {};

        // Ensure body.PK matches path parameter if provided
        if (body.PK && body.PK !== pk) {
          return response(400, { error: 'PK in body must match PK in path' });
        }

        for (const [key, value] of Object.entries(body)) {
          if (key !== 'PK') {
            const attrKey = `#${key}`;
            const valKey = `:${key}`;
            updates.push(`${attrKey} = ${valKey}`);
            exprAttrNames[attrKey] = key;
            exprAttrValues[valKey] = marshall({ temp: value }).temp;
          }
        }

        await ddb.send(new UpdateItemCommand({
          TableName: TABLE_NAME,
          Key: { PK: { S: pk } },
          UpdateExpression: 'SET ' + updates.join(', '),
          ExpressionAttributeNames: exprAttrNames,
          ExpressionAttributeValues: exprAttrValues,
        }));

        return response(200, { status: 'Updated' });
      }

      case 'DELETE': {
        // Delete item
        await ddb.send(new DeleteItemCommand({
          TableName: TABLE_NAME,
          Key: { PK: { S: pk } },
        }));
        return response(200, { status: 'Deleted' });
      }

      case 'PATCH': {
        // Approve item
        await ddb.send(new UpdateItemCommand({
          TableName: TABLE_NAME,
          Key: { PK: { S: pk } },
          UpdateExpression: 'SET #approval = :false REMOVE #error',
          ExpressionAttributeNames: {
            '#approval': 'approval',
            '#error': 'error',
          },
          ExpressionAttributeValues: {
            ':false': { BOOL: true },
          },
        }));
        return response(200, { status: 'Approved' });
      }

      default:
        return response(405, { error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('Error:', err);
    return response(500, { error: err.message });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}
function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}
