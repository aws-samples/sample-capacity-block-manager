const { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand, UpdateItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');

const ddb = new DynamoDBClient();
const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  const method = event.httpMethod;
  const body = event.body ? JSON.parse(event.body) : {};
  const pk = event.queryStringParameters?.PK || body.PK;

  try {
    switch (method) {
      case 'GET': {
        if (pk) {
          const res = await ddb.send(new GetItemCommand({
            TableName: TABLE_NAME,
            Key: { PK: { S: pk } },
          }));
          return res.Item
            ? response(200, unmarshall(res.Item))
            : response(404, { error: 'Not found' });
        } else {
          const res = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
          return response(200, res.Items.map(unmarshall));
        }
      }

      case 'POST': {
        if (!pk) return response(400, { error: 'PK required' });
        await ddb.send(new PutItemCommand({
          TableName: TABLE_NAME,
          Item: marshall(body),
        }));
        return response(201, { status: 'Created' });
      }

      case 'PUT': {
        if (!pk) return response(400, { error: 'PK required' });
        const updates = [];
        const exprAttrNames = {};
        const exprAttrValues = {};

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
        if (!pk) return response(400, { error: 'PK required' });
        await ddb.send(new DeleteItemCommand({
          TableName: TABLE_NAME,
          Key: { PK: { S: pk } },
        }));
        return response(200, { status: 'Deleted' });
      }

      case 'PATCH': {
        if (!pk) return response(400, { error: 'PK required' });
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
