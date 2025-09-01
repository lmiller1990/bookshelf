// Centralized AWS client configuration
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { TextractClient } from '@aws-sdk/client-textract';
const region = 'ap-southeast-2';
export const s3Client = new S3Client({ region });
export const sqsClient = new SQSClient({ region });
export const textractClient = new TextractClient({ region });
// Environment variable helpers
export const getEnvVar = (name) => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Environment variable ${name} is required`);
    }
    return value;
};
export const getResultsBucket = () => getEnvVar('RESULTS_BUCKET_NAME');
export const getBedrockQueueUrl = () => getEnvVar('BEDROCK_QUEUE_URL');
//# sourceMappingURL=aws-clients.js.map