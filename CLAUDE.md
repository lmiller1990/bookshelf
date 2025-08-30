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

✅ **Working CLI Application** (`index.js`)
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

## Next Steps

🔄 **LLM Processing Pipeline** (Current Priority)
- Integrate AWS Bedrock for text cleanup and candidate generation
- Transform fragmented Textract output into clean book title/author pairs
- Handle edge cases like multi-line titles and author name variations

Some notes and planning in ![](./bookimg_bedrock_plan.md)

## How to Run

### Prerequisites
1. **AWS Setup** (see setup instructions below)
2. **Dependencies**: `pnpm install` (already done)

### Usage
```bash
node index.js path/to/bookshelf-image.jpg
```

### AWS Setup Instructions

See [AWS_SEUTUP](./AWS_SETUP.md)

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
