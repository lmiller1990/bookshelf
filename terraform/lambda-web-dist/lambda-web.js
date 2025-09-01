const fastify = require("fastify")({ logger: true });
const awsLambdaFastify = require("@fastify/aws-lambda");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fastifyView = require("@fastify/view");

const s3Client = new S3Client({ region: "ap-southeast-2" });
const BUCKET_NAME = "bookimg-uat";

fastify.register(fastifyView, {
  root: "views",
});

// Home page with upload form
fastify.get("/", async (request, reply) => {
  reply.view("index.html");
});

// Generate pre-signed URL for S3 upload
fastify.get("/upload-url", async (request, reply) => {
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
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    // Return just the signed URL
    reply.type("text/plain").send(signedUrl);
  } catch (error) {
    console.error("Upload URL generation failed:", error);
    reply.code(500).send("Failed to generate upload URL");
  }
});

// Health check
fastify.get("/health", async (request, reply) => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

// Export the handler for AWS Lambda
module.exports.handler = awsLambdaFastify(fastify);
