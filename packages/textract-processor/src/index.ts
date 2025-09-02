import { DetectDocumentTextCommand } from "@aws-sdk/client-textract";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import {
  textractClient,
  s3Client,
  sqsClient,
  getResultsBucket,
  getBedrockQueueUrl,
  type TextractMessage,
} from "@packages/shared";
import { z } from "zod";
import fs from "node:fs/promises";

// Common types used across Lambda functions

// Zod schemas for runtime validation
export const ProcessingMessageSchema = z.object({
  bucket: z.string().min(1, "Bucket name is required"),
  key: z.string().min(1, "Key is required"),
  jobId: z.string().min(1, "Job ID is required"),
  timestamp: z.string().datetime("Invalid timestamp format"),
});

// Type inference from Zod schema
export type ProcessingMessageFromSchema = z.infer<
  typeof ProcessingMessageSchema
>;

interface SQSEvent {
  Records: Array<{
    body: string;
  }>;
}

export const handler = async (event: SQSEvent) => {
  console.log("Textract Processor triggered:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(record.body);
    } catch (error) {
      console.error("Failed to parse SQS message body as JSON:", error);
      throw new Error("Invalid JSON in SQS message body");
    }

    const validationResult = ProcessingMessageSchema.safeParse(parsedBody);

    if (!validationResult.success) {
      console.error("Invalid SQS message format:", {
        errors: validationResult.error.message,
        receivedData: parsedBody,
      });
      throw new Error(
        `Invalid SQS message format: ${validationResult.error.message}`
      );
    }

    const message = validationResult.data;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(process.argv);
  const bucket = "bookimg-uat";
  const key = "IMG_9797.jpg";

  const buf = await fs.readFile("../../images/IMG_9797.jpg");
  const textractResponse = await textractClient.send(
    new DetectDocumentTextCommand({
      Document: {
        Bytes: buf,
        // S3Object: {
        //   Bucket: bucket,
        //   Name: key,
        // },
      },
    })
  );

  await fs.writeFile(
    "out.json",
    JSON.stringify(
      textractResponse.Blocks?.filter((x) => x.BlockType === "LINE").map(
        (x) => x.Text
      ),
      null,
      4
    ),
    "utf-8"
  );
  console.log(textractResponse.Blocks);
  console.log(textractResponse.Blocks?.length);
}
