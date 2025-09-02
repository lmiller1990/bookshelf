import { DetectDocumentTextCommand } from "@aws-sdk/client-textract";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import {
  textractClient,
  s3Client,
  sqsClient,
  getResultsBucket,
  getBedrockQueueUrl,
  type ProcessingMessage,
  type TextractMessage,
} from "@packages/shared";

interface SQSEvent {
  Records: Array<{
    body: string;
  }>;
}

export const handler = async (event: SQSEvent) => {
  console.log("Textract Processor triggered:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const message: ProcessingMessage = JSON.parse(record.body);
    const { bucket, key, jobId } = message;

    console.log(`Processing image: ${key} from bucket: ${bucket}`);

    try {
      // Call Textract
      const textractResponse = await textractClient.send(
        new DetectDocumentTextCommand({
          Document: {
            S3Object: {
              Bucket: bucket,
              Name: key,
            },
          },
        })
      );

      // Extract text from response
      const extractedText =
        textractResponse.Blocks?.filter((block) => block.BlockType === "LINE")
          .map((block) => block.Text)
          .join("\n") || "";

      console.log(`Extracted text length: ${extractedText.length} characters`);

      // Store raw text in results bucket
      const resultsBucket = getResultsBucket();
      await s3Client.send(
        new PutObjectCommand({
          Bucket: resultsBucket,
          Key: `${jobId}/extracted-text.txt`,
          Body: extractedText,
          ContentType: "text/plain",
        })
      );

      // Send to Bedrock queue
      const bedrockMessage: TextractMessage = {
        ...message,
        extractedText: extractedText,
        textractComplete: true,
      };

      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: getBedrockQueueUrl(),
          MessageBody: JSON.stringify(bedrockMessage),
        })
      );

      console.log(`Sent to Bedrock queue for job: ${jobId}`);
    } catch (error) {
      console.error(`Error processing ${key}:`, error);
      throw error;
    }
  }

  return { statusCode: 200, body: "Textract processing complete" };
};
