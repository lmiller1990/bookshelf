# BookImg - AI Book Recognition Pipeline

Extract book titles and authors from photos of bookshelves using AWS services and LLM agents.

## Overview
1. **Text Extraction**: Use AWS Textract to extract text from book spine images
2. **Text Processing**: Parse fragmented text into title/author candidates using AWS Bedrock LLM
3. **Validation**: Verify candidates via web search and confidence scoring
4. **Link Discovery**: Find purchase links (Amazon, other retailers) for validated books

## Example Workflow
**Input**: Photo of bookshelf
**Textract Output**: Fragmented text (see example below)
**Final Output**: Clean title/author pairs with purchase links

### Sample Textract Output
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

### Expected Final Output
```
From Bacteria to Bach and Back — Daniel C. Dennett [Amazon Link]
The Genetic Lottery: Why DNA Matters for Social Equality — Kathryn Paige Harden [Amazon Link]
Rebel Cell: Cancer, Evolution and the Science of Life — Kat Arney [Amazon Link]
```

## Story so far

✅ **Complete AWS Infrastructure** 
- Two-stage Terraform deployment (bootstrap → main infrastructure)
- Proper security architecture: Root → Deployer User → Application User
- S3 bucket `bookimg-uat` for file storage
- IAM user `bookimg-uat-textract-user` with minimal required permissions
- Complete deployment documentation in `TERRAFORM.md`

✅ **Working CLI Application** (`index.ts`)
- Fast AWS Textract integration (1-2 second extraction)
- S3 bucket management with session-based organization (`{image-name}-{timestamp}/`)
- Automatic bucket creation and file upload
- Text extraction with preview output
- Full end-to-end workflow from image to extracted text

✅ **Production-Ready Infrastructure**
- Proper credential management across multiple AWS profiles
- Environment-based bucket naming (`bookimg-{env}`)
- Tested permissions and S3 operations
- Complete troubleshooting documentation

✅ **Working LLM Processing Pipeline** 
- AWS Bedrock integration with Claude 3 Haiku
- Structured candidate extraction from Textract OCR output
- JSON output with confidence scoring for book title/author pairs
- End-to-end workflow: Image → Textract → Bedrock → Structured candidates
- Results saved to S3 as both raw text and parsed JSON

✅ **OCR Working Well**
- Comprehensive testing framework for different Textract APIs and parameters
- DetectDocumentText performing reliably for book spine text extraction
- Enhanced Bedrock prompt with support for subtitles and better extraction rules
- Ground truth comparison system for accuracy measurement
- Detailed testing output with confidence scores and accuracy rankings
- Testing documentation in `TEXTRACT_TESTING.md`

✅ **Multiple Book Validation Providers**
- Integrated Google Books API for comprehensive book validation (9/11 books validated)
- Maintained Open Library API as free alternative (7/11 books validated) 
- Implemented smart matching algorithms with title/author similarity scoring
- Rich metadata enrichment: ISBNs, publishers, publication years, cover images
- Provider comparison and recommendation system
- Full CLI support with `--validate openlibrary` and `--validate googlebooks`
- Environment configuration system with `.env` file support
- Complete validation testing framework with sample book datasets

✅ **Lambdas & API Infrastructure**
- Complete Lambda functions for each pipeline stage:
  - Image upload & processing Lambda
  - Textract extraction Lambda  
  - Bedrock candidate generation Lambda
  - Book validation Lambda (with provider selection)
- REST API with API Gateway for web interface
- Async processing with SQS/SNS for long-running tasks
- Web Lambda with Fastify for upload form and pre-signed URLs

✅ **Real-Time Notification System**
- WebSocket API Gateway for persistent connections
- DynamoDB table for connection tracking (jobId → connectionId mapping)
- Connection manager Lambda (handles connect/disconnect/subscribe events)
- SNS notification handler Lambda (receives completion notifications)
- Complete async flow: Upload → Processing → SNS → WebSocket → Frontend
- Documentation in `ASYNC_NOTIFICATION.md`

## Next Steps

- **Update upload handler** to extract jobId from S3 key path
- **Update frontend** with WebSocket connection and jobId generation
- **Deploy infrastructure** and test end-to-end real-time notifications
- **Add processing status updates** (textract complete, bedrock complete, etc.)

# Nice to have

🔄 **Web Frontend Development**

- Build responsive web interface for bookshelf photo uploads
- Real-time processing status updates and progress indicators
- Interactive results display with book covers, metadata, and links
- Mobile-responsive design for smartphone camera integration

# Useful Docs

- [AWS_SETUP](./AWS_SETUP.md)
- [DEPLOYMENT](./DEPLOYMENT.md) 
- [TERRAFORM](./TERRAFORM.md)
- [ASYNC_NOTIFICATION](./ASYNC_NOTIFICATION.md) - Real-time notification architecture
