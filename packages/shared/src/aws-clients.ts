// Centralized AWS client configuration

import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { TextractClient } from '@aws-sdk/client-textract';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { SNSClient } from '@aws-sdk/client-sns';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';

const region = 'ap-southeast-2';

export const s3Client = new S3Client({ region });
export const sqsClient = new SQSClient({ region });
export const textractClient = new TextractClient({ region });
export const bedrockClient = new BedrockRuntimeClient({ region });
export const snsClient = new SNSClient({ region });
export const dynamodbClient = new DynamoDBClient({ region });

// API Gateway Management API client factory (needs endpoint at runtime)
export const createApiGatewayManagementClient = (endpoint: string) => 
  new ApiGatewayManagementApiClient({ region, endpoint });

// Environment variable helpers
export const getEnvVar = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
};

export const getResultsBucket = () => getEnvVar('RESULTS_BUCKET_NAME');
export const getBedrockQueueUrl = () => getEnvVar('BEDROCK_QUEUE_URL');
export const getValidationQueueUrl = () => getEnvVar('VALIDATION_QUEUE_URL');
export const getSNSTopicArn = () => getEnvVar('SNS_TOPIC_ARN');
export const getTextractQueueUrl = () => getEnvVar('TEXTRACT_QUEUE_URL');
export const getDynamoDBTableName = () => getEnvVar('DYNAMODB_TABLE_NAME');
export const getWebSocketEndpoint = () => getEnvVar('WEBSOCKET_API_ENDPOINT');