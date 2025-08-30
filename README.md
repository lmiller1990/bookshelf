# BookImg - AI Book Recognition Pipeline

Extract book titles and authors from photos of bookshelves using AWS Textract, Bedrock, and multiple validation providers (Open Library, Google Books).

## Overview

BookImg processes bookshelf photos through a multi-stage pipeline:

1. **Text Extraction**: AWS Textract extracts text from book spine images
2. **Candidate Generation**: AWS Bedrock (Claude 3 Haiku) parses fragmented text into title/author pairs
3. **Validation**: Multiple providers (Open Library, Google Books) validate and enrich book metadata
4. **Results**: Clean title/author pairs with ISBN, publisher, publication year, and links

## Installation

```bash
# Install dependencies
npm install

# Ensure AWS credentials are configured (see AWS_SETUP.md)
```

### Environment Setup

Create a `.env` file for API keys (required for Google Books validation):

```bash
# .env file
GOOGLE_BOOKS_API_KEY=your_api_key_here
```

**Google Books API Setup:**
1. Get an API key from [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Enable the [Books API](https://console.cloud.google.com/apis/library/books.googleapis.com) for your project
3. Add the key to your `.env` file
4. Run commands with `node --env-file=.env index.ts ...`

**Note**: Open Library validation works without any API keys.

## Usage

### Extract Books from Image

```bash
# Basic extraction (AWS Textract + Bedrock only)
node index.ts extract bookshelf.jpg

# Extract with Open Library validation (no API key needed)
node index.ts extract bookshelf.jpg --validate openlibrary

# Extract with Google Books validation (requires .env file)
node --env-file=.env index.ts extract bookshelf.jpg --validate googlebooks
```

### Test Validation

```bash
# Test Open Library validation with sample books (default)
node index.ts validate

# Test specific providers
node index.ts validate --provider openlibrary
node --env-file=.env index.ts validate --provider googlebooks
```

### Run Comprehensive Tests

```bash
# Test different Textract APIs and accuracy
node index.ts test bookshelf.jpg

# Test with ground truth for accuracy measurement
node index.ts test bookshelf.jpg --ground-truth '[{"title":"Book Title","authors":["Author"]}]'
```

### Help

```bash
# Show all commands and options
node index.ts --help

# Show help for specific command
node index.ts extract --help
```

## Commands

### `extract <image-path>`
Extract book information from a bookshelf image.

**Options:**
- `-v, --validate <provider>` - Validate results with provider (`openlibrary`, `googlebooks`)

**Examples:**
```bash
node index.ts extract bookshelf.jpg
node index.ts extract bookshelf.jpg --validate openlibrary
node --env-file=.env index.ts extract bookshelf.jpg --validate googlebooks
```

### `validate`
Test book validation in isolation with sample data.

**Options:**
- `-p, --provider <provider>` - Validation provider to test (`openlibrary`, `googlebooks`, default: `openlibrary`)

**Examples:**
```bash
node index.ts validate
node index.ts validate --provider openlibrary
node --env-file=.env index.ts validate --provider googlebooks
```

### `test <image-path>`
Run comprehensive Textract API tests for accuracy comparison.

**Options:**
- `-g, --ground-truth <json>` - Ground truth JSON for accuracy testing

**Example:**
```bash
node index.ts test bookshelf.jpg --ground-truth '[{"title":"From Bacteria to Bach and Back","authors":["Daniel C. Dennett"]}]'
```

## Output

### Without Validation
```
📖 EXTRACTION RESULTS:
1. "From Bacteria to Bach and Back" by Daniel C. Dennett (0.90)
2. "The Genetic Lottery" by Kathryn Paige Harden (0.85)
```

### With Validation
```
📖 EXTRACTION RESULTS:
1. ✅ "From Bacteria to Bach and Back"
   Authors: Daniel C. Dennett
   Confidence: 1.00
   📚 Validated: "From Bacteria to Bach and Back"
   👥 Authors: Daniel C. Dennett
   📄 ISBN: 9780393355505
   🏢 Publisher: Norton & Company, Incorporated, W. W.
   📅 Year: 2017
   🔗 Open Library: https://openlibrary.org/works/OL20227514W
   🔗 Google Books: https://books.google.com/books?id=XuJoDQAAQBAJ

🎯 Summary: 2/3 books validated
```

### Files Saved to S3
- `extracted-text.txt` - Raw Textract OCR output
- `candidates.json` - Bedrock-generated book candidates
- `validated-books.json` - Validated books with metadata (when using `--validate`)

## Architecture

- **AWS Textract**: OCR text extraction from images
- **AWS Bedrock (Claude 3 Haiku)**: Parse OCR into structured book candidates
- **Validation Providers**:
  - **Open Library API**: Free, no API key required
  - **Google Books API**: Requires API key and Books API enabled
- **AWS S3**: Store images, results, and processing artifacts

## Validation Providers

### Open Library
- ✅ **Free**: No API key required
- ✅ **Good coverage**: Strong for academic and older books
- ✅ **Rich metadata**: ISBNs, publishers, publication years, cover images
- ⚠️ **Rate limited**: 1 request per second (built-in throttling)

### Google Books  
- ✅ **Excellent coverage**: Often finds books Open Library misses
- ✅ **Rich metadata**: ISBNs, publishers, publication years, cover images
- ✅ **Fast responses**: Higher rate limits than Open Library
- ⚠️ **Requires setup**: API key and Books API enablement needed
- 💰 **Usage limits**: Free tier has daily quotas

**Recommendation**: Use Open Library for basic needs, Google Books for better coverage.

## Configuration

- **AWS Region**: `ap-southeast-2` (hardcoded)
- **S3 Bucket**: `bookimg-uat`
- **Bedrock Model**: `anthropic.claude-3-haiku-20240307-v1:0`

## See Also

- [AWS Setup Instructions](./AWS_SETUP.md)
- [Textract Testing Results](./TEXTRACT_TESTING.md)
- [Project Architecture](./CLAUDE.md)
