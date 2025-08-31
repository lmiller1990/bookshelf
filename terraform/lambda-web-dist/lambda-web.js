const fastify = require("fastify")({ logger: true });
const awsLambdaFastify = require("@fastify/aws-lambda");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3Client = new S3Client({ region: "ap-southeast-2" });
const BUCKET_NAME = "bookimg-uat";


// Home page with upload form
fastify.get("/", async (request, reply) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <title>BookImg - AI Book Recognition</title>
    <script src="https://unpkg.com/htmx.org@1.9.10"></script>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .upload-area { border: 2px dashed #ccc; padding: 40px; text-align: center; margin: 20px 0; }
        .upload-area.dragover { border-color: #007bff; background-color: #f8f9fa; }
        button { background: #007bff; color: white; border: none; padding: 10px 20px; cursor: pointer; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        .status { margin: 20px 0; padding: 10px; border-radius: 4px; }
        .status.success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
        .status.error { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
        .status.info { background: #cce7ff; border: 1px solid #99d6ff; color: #004085; }
    </style>
</head>
<body>
    <h1>📚 BookImg - AI Book Recognition</h1>
    <p>Upload a photo of your bookshelf to extract book titles and authors using AI.</p>
    
    <div class="upload-area" id="uploadArea">
        <form hx-post="upload-url" hx-target="#status" hx-encoding="multipart/form-data">
            <input type="file" name="image" accept="image/*" required id="fileInput">
            <br><br>
            <button type="submit" id="uploadBtn">Upload Image</button>
        </form>
    </div>
    
    <div id="status"></div>
    
    <script>
        // Drag and drop functionality
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                fileInput.files = files;
            }
        });
    </script>
</body>
</html>`;

  reply.type("text/html").send(html);
});

// Generate pre-signed URL for S3 upload
fastify.post("/upload-url", async (request, reply) => {
  console.log(`Request to upload-url`);
  try {
    // Get filename and content type from query parameters or default values
    const filename = request.query.filename || `upload-${Date.now()}.jpg`;
    const contentType = request.query.contentType || 'image/jpeg';

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

    // Return htmx response that uploads to S3
    const uploadScript = `
      <div class="status info">Uploading to AWS S3...</div>
      <script>
        const fileInput = document.querySelector('#fileInput');
        const file = fileInput.files[0];
        if (!file) {
          document.getElementById('status').innerHTML = 
            '<div class="status error">❌ No file selected</div>';
          return;
        }
        
        fetch('${signedUrl}', {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type
          }
        })
        .then(response => {
          if (response.ok) {
            document.getElementById('status').innerHTML = 
              '<div class="status success">✅ Upload successful! Processing started...<br>Session: ${sessionDir}</div>';
          } else {
            document.getElementById('status').innerHTML = 
              '<div class="status error">❌ Upload failed</div>';
          }
        })
        .catch(error => {
          document.getElementById('status').innerHTML = 
            '<div class="status error">❌ Upload error: ' + error.message + '</div>';
        });
      </script>`;

    reply.type("text/html").send(uploadScript);
  } catch (error) {
    console.error("Upload URL generation failed:", error);
    reply
      .code(500)
      .send('<div class="status error">Failed to generate upload URL</div>');
  }
});

// Health check
fastify.get("/health", async (request, reply) => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

// Export the handler for AWS Lambda
module.exports.handler = awsLambdaFastify(fastify);
