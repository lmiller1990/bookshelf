import fastify from "fastify";
import awsLambdaFastify from "@fastify/aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FastifyRequest, FastifyReply } from "fastify";

const app = fastify({ logger: true });
const s3Client = new S3Client({ region: "ap-southeast-2" });
const BUCKET_NAME = "bookimg-uat";

interface UploadUrlQuery {
  filename?: string;
  contentType?: string;
}

// Configure CORS for cross-origin requests from Vue app
app.register(import("@fastify/cors"), {
  origin: true, // Allow all origins in development
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

// Generate pre-signed URL for S3 upload
app.get(
  "/upload-url",
  async (
    request: FastifyRequest<{ Querystring: UploadUrlQuery }>,
    reply: FastifyReply,
  ) => {
    console.log(`Request to upload-url`);
    try {
      // Get filename and content type from query parameters or default values
      const filename = request.query.filename || `upload-${Date.now()}.jpg`;
      const contentType = request.query.contentType || "image/jpeg";

      // Generate unique filename
      const timestamp = Date.now();
      const originalName = filename;
      const sessionDir = `${originalName.split(".")[0]}-${timestamp}`;
      const s3Key = `${sessionDir}/${originalName}`;

      // Generate pre-signed URL
      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        ContentType: contentType,
      });

      console.log(`Generating pre-signed url for ${s3Key}`);
      const signedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 300,
      });

      // Return just the signed URL
      reply.type("text/plain").send(signedUrl);
    } catch (error) {
      console.error("Upload URL generation failed:", error);
      reply.code(500).send("Failed to generate upload URL");
    }
  },
);

app.get("/health", async (request: FastifyRequest, reply: FastifyReply) => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

// Export the handler for AWS Lambda
export const handler = awsLambdaFastify(app);
