import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { TextractClient } from '@aws-sdk/client-textract';
export declare const s3Client: S3Client;
export declare const sqsClient: SQSClient;
export declare const textractClient: TextractClient;
export declare const getEnvVar: (name: string) => string;
export declare const getResultsBucket: () => string;
export declare const getBedrockQueueUrl: () => string;
//# sourceMappingURL=aws-clients.d.ts.map