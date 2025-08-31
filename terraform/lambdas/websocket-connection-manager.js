const { DynamoDBClient, PutItemCommand, DeleteItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamodb = new DynamoDBClient({ region: 'ap-southeast-2' });
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME;

exports.handler = async (event) => {
  console.log('WebSocket Connection Manager triggered:', JSON.stringify(event, null, 2));
  
  const { requestContext } = event;
  const { connectionId, eventType, routeKey } = requestContext;
  
  try {
    switch (eventType) {
      case 'CONNECT':
        return await handleConnect(connectionId);
      case 'DISCONNECT':
        return await handleDisconnect(connectionId);
      default:
        // Handle messages (subscribe, etc.)
        if (event.body) {
          return await handleMessage(connectionId, JSON.parse(event.body));
        }
        return { statusCode: 200 };
    }
  } catch (error) {
    console.error('WebSocket handler error:', error);
    return { statusCode: 500, body: 'Connection handler failed' };
  }
};

async function handleConnect(connectionId) {
  console.log(`WebSocket connected: ${connectionId}`);
  
  // We'll store the connection temporarily - it gets linked to a jobId when user subscribes
  const ttl = Math.floor(Date.now() / 1000) + (60 * 60); // 1 hour TTL
  
  // For now, just store connection with temporary key
  // This will be updated when client sends subscribe message
  await dynamodb.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: {
      jobId: { S: `temp-${connectionId}` }, // Temporary key until real jobId provided
      connectionId: { S: connectionId },
      timestamp: { S: new Date().toISOString() },
      ttl: { N: ttl.toString() },
      status: { S: 'connected' }
    }
  }));
  
  console.log(`Stored temporary connection: ${connectionId}`);
  return { statusCode: 200 };
}

async function handleDisconnect(connectionId) {
  console.log(`WebSocket disconnected: ${connectionId}`);
  
  // Clean up any records for this connection
  // Since we don't know the jobId, we'd need to scan (not ideal but necessary for cleanup)
  // For now, we'll just log it - TTL will handle cleanup
  
  console.log(`Connection ${connectionId} cleaned up`);
  return { statusCode: 200 };
}

async function handleMessage(connectionId, message) {
  console.log(`Message from ${connectionId}:`, message);
  
  const { action, jobId } = message;
  
  if (action === 'subscribe' && jobId) {
    // Link the connection to the specific jobId
    const ttl = Math.floor(Date.now() / 1000) + (60 * 60); // 1 hour TTL
    
    await dynamodb.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        jobId: { S: jobId },
        connectionId: { S: connectionId },
        timestamp: { S: new Date().toISOString() },
        ttl: { N: ttl.toString() },
        status: { S: 'subscribed' }
      }
    }));
    
    console.log(`Subscribed connection ${connectionId} to job ${jobId}`);
    
    // Send confirmation back to client
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: 'subscribed',
        jobId: jobId,
        message: 'Successfully subscribed to job notifications'
      })
    };
  }
  
  return { statusCode: 200 };
}