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

## Progress So Far

✅ **AWS Infrastructure Setup**
- Terraform-managed infrastructure with environment namespacing
- IAM user with least-privilege permissions (`bookimg-uat-textract-user`)
- Secure credential management with dedicated application profile
- Complete documentation in `AWS_SETUP.md`

✅ **Basic CLI Application** (`index.js`)
- AWS Textract integration
- S3 bucket management 
- Session-based file organization (`{image-name}-{timestamp}/`)
- CLI interface for image processing

## Next Steps

🔄 **Infrastructure Improvements**
1. **Update Terraform**: Create top-level S3 bucket `bookimg-{env}` instead of hardcoded bucket name
2. **Dynamic Directory Management**: Each image run creates its own directory in the main bucket

🔄 **Future: LLM Processing Pipeline**
- **Step 1**: Text cleanup and candidate generation → `step1_text_cleanup.md`  
- **Step 2**: Web search validation and scoring → `step2_web_validation.md`

## How to Run

### Prerequisites
1. **AWS Setup** (see setup instructions below)
2. **Dependencies**: `pnpm install` (already done)

### Usage
```bash
node index.js path/to/bookshelf-image.jpg
```

### AWS Setup Instructions

**IMPORTANT**: Don't use root AWS credentials! Create a dedicated IAM user:

1. **Create IAM User**:
   - Name: `bookimg-textract-user`
   - Access type: Programmatic access only

2. **Attach Minimal Permissions**:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "textract:DetectDocumentText"
         ],
         "Resource": "*"
       },
       {
         "Effect": "Allow",
         "Action": [
           "s3:CreateBucket",
           "s3:GetObject",
           "s3:PutObject",
           "s3:HeadBucket"
         ],
         "Resource": [
           "arn:aws:s3:::book-detect",
           "arn:aws:s3:::book-detect/*"
         ]
       }
     ]
   }
   ```

3. **Configure Credentials**:
   ```bash
   aws configure
   # Enter Access Key ID and Secret Access Key from IAM user
   # Region: us-east-1
   # Output format: json
   ```

### What It Does
1. Creates/verifies `book-detect` S3 bucket
2. Uploads image to `{image-name}-{timestamp}/` directory
3. Runs AWS Textract to extract text
4. Saves results as `extracted-text.txt` in same directory
5. Shows preview of extracted text

## Architecture Notes

- Use AWS Bedrock for LLM processing (text cleanup, candidate generation)
- Leverage web search APIs for validation
- Prioritize "hands off" AWS-native workflow where possible

## Resources

- [AWS Bedrock FAQs](https://aws.amazon.com/bedrock/faqs/)
- [AWS Textract Documentation](https://docs.aws.amazon.com/textract/latest/dg/what-is.html)
