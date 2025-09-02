import fastify from "fastify";
import awsLambdaFastify from "@fastify/aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = fastify({ logger: true });
const s3Client = new S3Client({ region: "ap-southeast-2" });
const BUCKET_NAME = "bookimg-uat";
// Cache the HTML content
let indexHtml = null;
async function getIndexHtml() {
    if (!indexHtml) {
        const htmlPath = join(__dirname, "..", "views", "index.html");
        indexHtml = await readFile(htmlPath, "utf-8");
    }
    return indexHtml;
}
// Home page with upload form
app.get("/", async (request, reply) => {
    const html = await getIndexHtml();
    reply.type("text/html").send(html);
});
// Generate pre-signed URL for S3 upload
app.get("/upload-url", async (request, reply) => {
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
    }
    catch (error) {
        console.error("Upload URL generation failed:", error);
        reply.code(500).send("Failed to generate upload URL");
    }
});
// Health check
app.get("/health", async (request, reply) => {
    return { status: "ok", timestamp: new Date().toISOString() };
});
// Export the handler for AWS Lambda
export const handler = awsLambdaFastify(app);
//# sourceMappingURL=lambda-web.js.map