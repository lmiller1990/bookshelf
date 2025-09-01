import { GetItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { 
  dynamodbClient,
  createApiGatewayManagementClient,
  getDynamoDBTableName,
  getWebSocketEndpoint,
  SNSEvent,
  ProcessingCompleteMessage
} from '@bookimg/shared';

export const handler = async (event: SNSEvent) => {
  console.log('SNS Notification Handler triggered:', JSON.stringify(event, null, 2));
  
  for (const record of event.Records) {
    try {
      // Parse SNS message
      const snsMessage: ProcessingCompleteMessage = JSON.parse(record.Sns.Message);
      const { jobId, status, books, validatedBooks, totalCandidates } = snsMessage;
      
      console.log(`Processing notification for job: ${jobId}`);
      
      // Look up WebSocket connection by jobId
      const tableName = getDynamoDBTableName();
      const connectionResult = await dynamodbClient.send(new GetItemCommand({
        TableName: tableName,
        Key: {
          jobId: { S: jobId }
        }
      }));
      
      if (!connectionResult.Item) {
        console.log(`No WebSocket connection found for job: ${jobId}`);
        continue;
      }
      
      const connectionId = connectionResult.Item.connectionId.S!;
      console.log(`Found connection ${connectionId} for job ${jobId}`);
      
      // Create API Gateway Management client with the WebSocket endpoint
      const websocketEndpoint = getWebSocketEndpoint();
      const apiGatewayManagement = createApiGatewayManagementClient(websocketEndpoint);
      
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
        await dynamodbClient.send(new DeleteItemCommand({
          TableName: tableName,
          Key: {
            jobId: { S: jobId }
          }
        }));
        
        console.log(`🧹 Cleaned up connection record for job ${jobId}`);
        
      } catch (wsError: any) {
        console.error(`❌ Failed to send WebSocket message to ${connectionId}:`, wsError);
        
        // If connection is gone, clean up the record
        if (wsError.name === 'GoneException') {
          await dynamodbClient.send(new DeleteItemCommand({
            TableName: tableName,
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