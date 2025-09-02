import type { S3Event } from "aws-lambda";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import {
  sqsClient,
  getTextractQueueUrl,
  type ProcessingMessage,
} from "@packages/shared";

export const handler = async (event: S3Event) => {
  console.log("Upload Handler triggered:", JSON.stringify(event, null, 2));

  // Extract S3 event details
  for (const record of event.Records) {
    if (record.eventName.startsWith("ObjectCreated")) {
      const bucket = record.s3.bucket.name;
      const key = record.s3.object.key;

      console.log(`New upload: ${key} in bucket ${bucket}`);

      // Send message to Textract queue
      const queueUrl = getTextractQueueUrl();

      // Extract jobId from S3 key path
      // Key format: "originalName-timestamp/originalName"
      const keyParts = key.split("/");
      const sessionDir = keyParts[0]; // e.g., "bookshelf-1693234567890"
      if (!sessionDir) {
        throw new Error(`Exepcted keyParts not to be null. Got ${keyParts}`);
      }
      const jobId = sessionDir; // Use the full session directory as jobId

      const message: ProcessingMessage = {
        bucket: bucket,
        key: key,
        jobId: jobId,
        timestamp: new Date().toISOString(),
      };

      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(message),
        }),
      );

      console.log(`Sent to Textract queue: ${JSON.stringify(message)}`);
    }
  }

  return { statusCode: 200, body: "Upload processed" };
};
