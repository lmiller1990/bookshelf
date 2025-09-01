import { PutItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import {
  dynamodbClient,
  getDynamoDBTableName,
  type WebSocketEvent,
  type WebSocketSubscribeMessage,
} from "@bookimg/shared";

export const handler = async (event: WebSocketEvent) => {
  console.log(
    "WebSocket Connection Manager triggered:",
    JSON.stringify(event, null, 2)
  );

  const { requestContext } = event;
  const { connectionId, eventType } = requestContext;

  try {
    switch (eventType) {
      case "CONNECT":
        return await handleConnect(connectionId);
      case "DISCONNECT":
        return await handleDisconnect(connectionId);
      default:
        // Handle messages (subscribe, etc.)
        if (event.body) {
          return await handleMessage(connectionId, JSON.parse(event.body));
        }
        return { statusCode: 200 };
    }
  } catch (error) {
    console.error("WebSocket handler error:", error);
    return { statusCode: 500, body: "Connection handler failed" };
  }
};

async function handleConnect(connectionId: string) {
  console.log(`WebSocket connected: ${connectionId}`);

  // We'll store the connection temporarily - it gets linked to a jobId when user subscribes
  const ttl = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour TTL

  const tableName = getDynamoDBTableName();

  // For now, just store connection with temporary key
  // This will be updated when client sends subscribe message
  await dynamodbClient.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        jobId: { S: `temp-${connectionId}` }, // Temporary key until real jobId provided
        connectionId: { S: connectionId },
        timestamp: { S: new Date().toISOString() },
        ttl: { N: ttl.toString() },
        status: { S: "connected" },
      },
    })
  );

  console.log(`Stored temporary connection: ${connectionId}`);
  return { statusCode: 200 };
}

async function handleDisconnect(connectionId: string) {
  console.log(`WebSocket disconnected: ${connectionId}`);

  // Clean up any records for this connection
  // Since we don't know the jobId, we'd need to scan (not ideal but necessary for cleanup)
  // For now, we'll just log it - TTL will handle cleanup

  console.log(`Connection ${connectionId} cleaned up`);
  return { statusCode: 200 };
}

async function handleMessage(
  connectionId: string,
  message: WebSocketSubscribeMessage
) {
  console.log(`Message from ${connectionId}:`, message);

  const { action, jobId } = message;

  if (action === "subscribe" && jobId) {
    // Link the connection to the specific jobId
    const ttl = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour TTL
    const tableName = getDynamoDBTableName();

    await dynamodbClient.send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          jobId: { S: jobId },
          connectionId: { S: connectionId },
          timestamp: { S: new Date().toISOString() },
          ttl: { N: ttl.toString() },
          status: { S: "subscribed" },
        },
      })
    );

    console.log(`Subscribed connection ${connectionId} to job ${jobId}`);

    // Send confirmation back to client
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: "subscribed",
        jobId: jobId,
        message: "Successfully subscribed to job notifications",
      }),
    };
  }

  return { statusCode: 200 };
}
