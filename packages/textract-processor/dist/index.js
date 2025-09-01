// src/index.ts
import { DetectDocumentTextCommand } from "@aws-sdk/client-textract";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { SendMessageCommand } from "@aws-sdk/client-sqs";

// ../shared/dist/aws-clients.js
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { TextractClient } from "@aws-sdk/client-textract";
var region = "ap-southeast-2";
var s3Client = new S3Client({ region });
var sqsClient = new SQSClient({ region });
var textractClient = new TextractClient({ region });
var getEnvVar = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
};
var getResultsBucket = () => getEnvVar("RESULTS_BUCKET_NAME");
var getBedrockQueueUrl = () => getEnvVar("BEDROCK_QUEUE_URL");

// src/index.ts
var handler = async (event) => {
  console.log("Textract Processor triggered:", JSON.stringify(event, null, 2));
  for (const record of event.Records) {
    const message = JSON.parse(record.body);
    const { bucket, key, jobId } = message;
    console.log(`Processing image: ${key} from bucket: ${bucket}`);
    try {
      const textractResponse = await textractClient.send(new DetectDocumentTextCommand({
        Document: {
          S3Object: {
            Bucket: bucket,
            Name: key
          }
        }
      }));
      const extractedText = textractResponse.Blocks?.filter((block) => block.BlockType === "LINE").map((block) => block.Text).join("\n") || "";
      console.log(`Extracted text length: ${extractedText.length} characters`);
      const resultsBucket = getResultsBucket();
      await s3Client.send(new PutObjectCommand({
        Bucket: resultsBucket,
        Key: `${jobId}/extracted-text.txt`,
        Body: extractedText,
        ContentType: "text/plain"
      }));
      const bedrockMessage = {
        ...message,
        extractedText,
        textractComplete: true
      };
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: getBedrockQueueUrl(),
        MessageBody: JSON.stringify(bedrockMessage)
      }));
      console.log(`Sent to Bedrock queue for job: ${jobId}`);
    } catch (error) {
      console.error(`Error processing ${key}:`, error);
      throw error;
    }
  }
  return { statusCode: 200, body: "Textract processing complete" };
};
export {
  handler
};
