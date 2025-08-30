# BookImg Production Architecture

## Overview

This document outlines the production architecture for BookImg - an AI-powered book recognition pipeline that extracts book titles and authors from bookshelf photos using AWS services and LLM processing.

## Architecture Flow

```mermaid
flowchart TD
    subgraph Browser["🌐 Browser"]
        A[Upload Image]
        Z[Display Results]
    end
    
    subgraph S3["📦 S3 Storage"]
        B[Image Bucket]
        Y[Results Bucket]
    end
    
    subgraph Lambda["⚡ Lambda Functions"]
        C[Upload Handler]
        E[Textract Processor]
        H[Bedrock LLM]
        K[Book Validator]
    end
    
    subgraph SQS["📬 SQS Queues"]
        D[Textract Queue]
        G[Bedrock Queue]
        J[Validation Queue]
    end
    
    subgraph AWS["☁️ AWS Services"]
        F[Textract OCR]
        I[Bedrock Claude]
        L[External APIs<br/>Google Books]
    end
    
    subgraph Messaging["📢 SNS/WebSocket"]
        M[SNS Topic]
        N[WebSocket Connection]
    end

    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H
    H --> I
    I --> J
    J --> K
    K --> L
    L --> Y
    Y --> M
    M --> N
    N --> Z

    style Browser fill:#e1f5fe
    style Messaging fill:#e8f5e8
    style AWS fill:#fff3e0
```

## Service Layers

### 🌐 Browser Layer
- **Upload Image**: Web frontend for bookshelf photo uploads
- **Display Results**: Real-time results display with book metadata and purchase links

### 📦 S3 Storage Layer
- **Image Bucket**: Stores uploaded bookshelf photos with presigned URL uploads
- **Results Bucket**: Stores processed results, intermediate data, and final JSON output

### ⚡ Lambda Functions Layer
Four event-driven Lambda functions handle the processing pipeline:

1. **Upload Handler Lambda**
   - Triggers on S3 upload events
   - Validates image format and size
   - Initiates processing pipeline
   - Returns job ID to frontend

2. **Textract Processor Lambda**
   - Consumes from Textract SQS queue
   - Calls AWS Textract DetectDocumentText
   - Extracts text from book spine images
   - Stores raw OCR results in S3

3. **Bedrock LLM Lambda**
   - Consumes from Bedrock SQS queue
   - Processes OCR text with Claude 3 Haiku
   - Generates structured book candidates (title/author pairs)
   - Applies confidence scoring and filtering

4. **Book Validator Lambda**
   - Consumes from Validation SQS queue
   - Validates candidates against Google Books API
   - Enriches with metadata, ISBNs, cover images
   - Generates purchase links for validated books

### 📬 SQS Queues Layer
Three SQS queues decouple processing stages:
- **Textract Queue**: Queues images for OCR processing
- **Bedrock Queue**: Queues extracted text for LLM processing  
- **Validation Queue**: Queues book candidates for validation

### ☁️ AWS Services Layer
- **Textract OCR**: Extracts text from bookshelf images
- **Bedrock Claude**: Processes fragmented OCR text into structured candidates
- **External APIs**: Google Books API for book validation and metadata enrichment

### 📢 SNS/WebSocket Layer
- **SNS Topic**: Publishes job completion notifications
- **WebSocket Connection**: Real-time updates to frontend showing processing progress

## Data Flow Pattern

1. **Upload Phase**: `Browser → S3 Upload → Upload Handler Lambda → Textract Queue`
2. **OCR Phase**: `Textract Queue → Textract Lambda → AWS Textract → Bedrock Queue` 
3. **LLM Phase**: `Bedrock Queue → Bedrock Lambda → AWS Bedrock → Validation Queue`
4. **Validation Phase**: `Validation Queue → Validation Lambda → Google Books API → Results S3`
5. **Notification Phase**: `Results S3 → SNS Topic → WebSocket → Frontend Display`

## Sample Data Transformation

### Input: Bookshelf Photo
Raw image uploaded via web frontend

### Textract Output (Fragmented Text)
```
DANIEL C. DENNETT FROM BACTERIA TO BACH AND BACK
HARDEN
THE GENETIC
WHY DNA MATTERS
LOTTERY
FOR SOCIAL EQUALITY
Rebel Cell
Cancer, Evolution and
KAT
the Science of Life
ARNEY
```

### Bedrock LLM Output (Structured Candidates)
```json
{
  "candidates": [
    {
      "title": "From Bacteria to Bach and Back",
      "author": "Daniel C. Dennett",
      "confidence": 0.95
    },
    {
      "title": "The Genetic Lottery: Why DNA Matters for Social Equality", 
      "author": "Kathryn Paige Harden",
      "confidence": 0.88
    },
    {
      "title": "Rebel Cell: Cancer, Evolution and the Science of Life",
      "author": "Kat Arney", 
      "confidence": 0.92
    }
  ]
}
```

### Final Output (Validated Results)
```json
{
  "books": [
    {
      "title": "From Bacteria to Bach and Back: The Evolution of Minds",
      "author": "Daniel C. Dennett",
      "isbn": "9780393242072",
      "publisher": "W. W. Norton & Company",
      "publishedDate": "2017-02-07",
      "coverImage": "https://books.google.com/books/content?id=...",
      "purchaseLinks": {
        "amazon": "https://amazon.com/dp/0393242072",
        "googleBooks": "https://books.google.com/books?id=..."
      },
      "confidence": 0.95,
      "validated": true
    }
  ]
}
```

## Architecture Benefits

### Scalability
- Each processing stage scales independently based on queue depth
- Lambda functions auto-scale from 0 to thousands of concurrent executions
- SQS queues handle traffic spikes and provide backpressure management

### Reliability  
- Event-driven architecture with automatic retries
- Dead Letter Queues (DLQ) for failed message handling
- Idempotent processing stages prevent duplicate work

### Cost Efficiency
- Pay-per-invocation pricing with no idle server costs
- Automatic scaling eliminates over-provisioning
- S3 storage costs scale with actual usage

### Monitoring & Observability
- CloudWatch logs and metrics for all Lambda functions
- X-Ray distributed tracing across the entire pipeline
- SNS notifications for error handling and alerting

## Implementation Phases

### Phase 1: Infrastructure Setup
- Create Terraform modules for Lambda functions, SQS queues, SNS topics
- Set up IAM roles and policies for each service
- Configure S3 buckets with proper lifecycle policies
- Deploy infrastructure using existing Terraform workflow

### Phase 2: Lambda Development
- Port existing CLI logic to 4 separate Lambda functions
- Add SQS event handlers and message processing logic
- Implement structured logging and error handling
- Create retry logic and DLQ processing

### Phase 3: Frontend Integration
- Build web frontend with React/Next.js
- Implement presigned S3 upload endpoints
- Create WebSocket connection for real-time updates
- Add job status tracking and progress indicators

### Phase 4: Monitoring & Testing
- Set up CloudWatch dashboards and alarms
- Configure X-Ray service maps for performance monitoring
- Create end-to-end testing framework with sample images
- Load testing and performance optimization

## Security Considerations

- Presigned S3 URLs with expiration times
- IAM roles with least privilege access
- API Gateway with rate limiting and authentication
- VPC configuration for Lambda functions (if required)
- Encryption at rest for S3 buckets and SQS queues

## Deployment Strategy

- Environment-based deployments (dev/staging/prod)
- Blue-green deployments for zero-downtime updates
- Terraform state management with remote backends
- Automated CI/CD pipeline with GitHub Actions

## Implementation Status

### ✅ Completed Infrastructure
- **Terraform Infrastructure**: Complete deployment with bootstrap and main configurations
- **S3 Buckets**: `bookimg-uat` (uploads) and `bookimg-uat-results` (processing results)
- **SQS Queues**: 3 processing queues with dead letter queues for error handling
- **Lambda Functions**: 4 deployed functions with proper IAM roles and environment variables
- **SNS Topic**: Result notifications configured
- **IAM Security**: Deployer user with administrative access, application users with minimal permissions

### ✅ Lambda Function Implementation
All Lambda functions deployed with automatic source code packaging:

1. **Upload Handler** (`upload-handler.js`)
   - Triggers on S3 `ObjectCreated` events
   - Generates unique job IDs
   - Sends processing messages to Textract Queue

2. **Textract Processor** (`textract-processor.js`)
   - Processes images with AWS Textract OCR
   - Stores raw text in results bucket
   - Forwards to Bedrock Queue

3. **Bedrock LLM Processor** (`bedrock-processor.js`)
   - Uses Claude 3 Haiku for text parsing
   - Generates structured book candidates with confidence scores
   - Stores candidates JSON and forwards to Validation Queue

4. **Book Validator** (`book-validator.js`)
   - Validates candidates against Google Books API
   - Enriches with metadata (ISBN, publisher, cover images)
   - Stores final results and publishes SNS notification

### 🔧 Terraform Automation Features
- **Automatic Lambda Packaging**: Uses `archive_file` data source for zero-touch deployments
- **Source Code Change Detection**: Lambda functions update automatically when code changes
- **Environment Variables**: All queue URLs and bucket names injected automatically
- **Dependency Management**: Proper resource dependencies ensure correct deployment order

## Testing the Pipeline

### Prerequisites
1. **AWS CLI configured** with `bookimg-app` profile for application access
2. **Terraform deployed** infrastructure (both bootstrap and main)
3. **Test image** of bookshelf spines ready

### Testing Steps

1. **Deploy/Update Infrastructure**:
   ```bash
   cd terraform
   AWS_PROFILE=bookimg-deployer terraform apply
   ```

2. **Upload Test Image** (triggers the pipeline):
   ```bash
   AWS_PROFILE=bookimg-app aws s3 cp your-bookshelf-image.jpg s3://bookimg-uat/
   ```

3. **Monitor Processing** via CloudWatch Logs:
   - `/aws/lambda/bookimg-uat-upload-handler`
   - `/aws/lambda/bookimg-uat-textract-processor`
   - `/aws/lambda/bookimg-uat-bedrock-processor`
   - `/aws/lambda/bookimg-uat-book-validator`

4. **Check Results**:
   ```bash
   # List processing results
   aws s3 ls s3://bookimg-uat-results/ --recursive
   
   # Download final results
   aws s3 cp s3://bookimg-uat-results/job-TIMESTAMP/final-results.json ./
   ```

5. **Monitor SQS Queues** (should process quickly and return to 0):
   - `bookimg-uat-textract-queue`
   - `bookimg-uat-bedrock-queue`
   - `bookimg-uat-validation-queue`

### Expected Results Structure
```json
{
  "jobId": "job-1693424567890",
  "timestamp": "2024-08-30T23:15:67.890Z",
  "totalCandidates": 3,
  "validatedCount": 2,
  "books": [
    {
      "title": "From Bacteria to Bach and Back",
      "author": "Daniel C. Dennett",
      "confidence": 0.95,
      "status": "validated",
      "validation": {
        "validated": true,
        "isbn": "9780393242072",
        "publisher": "W. W. Norton & Company",
        "publishedDate": "2017-02-07",
        "thumbnail": "https://books.google.com/books/content?id=..."
      }
    }
  ]
}
```

## Monitoring & Debugging

### CloudWatch Logs
Each Lambda function creates its own log group:
```bash
# View recent logs
aws logs tail /aws/lambda/bookimg-uat-upload-handler --follow

# List all BookImg log groups
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/bookimg-uat"
```

### SQS Queue Monitoring
```bash
# Check queue depths
aws sqs get-queue-attributes --queue-url $(terraform output -raw textract_queue_url) --attribute-names ApproximateNumberOfMessages

# Check dead letter queues
aws sqs get-queue-attributes --queue-url QUEUE_URL --attribute-names ApproximateNumberOfMessages
```

### SNS Notifications
Results are published to SNS topic. Subscribe via email/SMS for notifications:
```bash
aws sns subscribe --topic-arn $(terraform output -raw sns_topic_arn) --protocol email --notification-endpoint your-email@example.com
```

## Troubleshooting

### Common Issues
1. **No Lambda Trigger**: Ensure upload to `bookimg-uat` not `bookimg-uat-results`
2. **Permission Errors**: Check Lambda execution role has required AWS service permissions
3. **Queue Backlog**: Check dead letter queues for failed messages
4. **Bedrock Errors**: Verify Bedrock Claude access in your AWS region
5. **Google Books Validation**: API may rate limit; consider adding API key

### Error Recovery
- **Failed Messages**: Check dead letter queues and replay if needed
- **Stuck Queues**: Purge queues and re-upload test image
- **Lambda Timeouts**: Check CloudWatch logs for timeout issues

## Next Steps

### 🔄 Pending Development
- **Web Frontend**: React/Next.js interface for image uploads and results display
- **Real-time Updates**: WebSocket integration for live processing status
- **API Gateway**: REST API endpoints for frontend integration
- **Enhanced Error Handling**: Retry logic and graceful failure modes

### 🔄 Production Hardening
- **Google Books API Key**: Add API key for higher rate limits
- **Purchase Link Integration**: Amazon affiliate and Bookshop.org APIs
- **Performance Optimization**: Lambda memory tuning and cold start reduction
- **Cost Optimization**: S3 lifecycle policies and reserved Lambda capacity