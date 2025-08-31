const { DynamoDBClient, GetItemCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamodb = new DynamoDBClient({ region: 'ap-southeast-2' });
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_API_ENDPOINT;

exports.handler = async (event) => {
  console.log('SNS Notification Handler triggered:', JSON.stringify(event, null, 2));
  
  for (const record of event.Records) {
    try {
      // Parse SNS message
      const snsMessage = JSON.parse(record.Sns.Message);
      const { jobId, status, books, validatedBooks, totalCandidates } = snsMessage;
      
      console.log(`Processing notification for job: ${jobId}`);
      
      // Look up WebSocket connection by jobId
      const connectionResult = await dynamodb.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: {
          jobId: { S: jobId }
        }
      }));
      
      if (!connectionResult.Item) {
        console.log(`No WebSocket connection found for job: ${jobId}`);
        continue;
      }
      
      const connectionId = connectionResult.Item.connectionId.S;
      console.log(`Found connection ${connectionId} for job ${jobId}`);
      
      // Create API Gateway Management client with the WebSocket endpoint
      const apiGatewayManagement = new ApiGatewayManagementApiClient({
        region: 'ap-southeast-2',
        endpoint: WEBSOCKET_ENDPOINT
      });
      
      // Prepare notification message for frontend
      const notificationMessage = {
        type: 'processingComplete',
        jobId: jobId,
        status: status,
        timestamp: new Date().toISOString(),
        results: {
          totalCandidates: totalCandidates || 0,
          validatedBooks: validatedBooks || 0,
          books: books || []
        }
      };
      
      // Send notification via WebSocket
      try {
        await apiGatewayManagement.send(new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: JSON.stringify(notificationMessage)
        }));
        
        console.log(`✅ Sent notification to connection ${connectionId} for job ${jobId}`);
        
        // Clean up the connection record (job is complete)
        await dynamodb.send(new DeleteItemCommand({
          TableName: TABLE_NAME,
          Key: {
            jobId: { S: jobId }
          }
        }));
        
        console.log(`🧹 Cleaned up connection record for job ${jobId}`);
        
      } catch (wsError) {
        console.error(`❌ Failed to send WebSocket message to ${connectionId}:`, wsError);
        
        // If connection is gone, clean up the record
        if (wsError.name === 'GoneException') {
          await dynamodb.send(new DeleteItemCommand({
            TableName: TABLE_NAME,
            Key: {
              jobId: { S: jobId }
            }
          }));
          console.log(`🧹 Cleaned up stale connection record for job ${jobId}`);
        }
      }
      
    } catch (error) {
      console.error('Error processing SNS record:', error);
      console.error('SNS record:', record);
    }
  }
  
  return { statusCode: 200, body: 'SNS notifications processed' };
};