# Textract Testing Framework

I've added comprehensive testing functionality to compare different AWS Textract APIs and parameters for book spine text extraction.

## Available Test Methods

### 1. DetectDocumentText (LINE) 
- **Current default method** 
- Extracts text organized by lines
- Fast and cost-effective
- Good for basic text extraction

### 2. DetectDocumentText (WORD)
- Same API but extracts individual words instead of lines
- May provide different results for fragmented text
- Useful when line detection fails

### 3. AnalyzeDocument (QUERIES)
- **Most promising for our use case**
- Uses natural language queries to ask Textract specific questions:
  - "What is the book title?"
  - "Who is the author?"
  - "What books are shown?"
  - "List all book titles and authors"
  - "What text appears on the book spines?"
- Leverages Textract's understanding rather than just text extraction

### 4. AnalyzeDocument (LAYOUT)
- Extracts text with spatial understanding
- Sorts text by position (top-to-bottom, left-to-right)
- Better for complex layouts and positioning

## Usage

### Run all tests without ground truth:
```bash
node index.ts bookshelf.jpg --test
```

### Run tests with ground truth for accuracy measurement:
```bash
node index.ts bookshelf.jpg '[{"title":"From Bacteria to Bach and Back","authors":["Daniel C. Dennett"]},{"title":"The Genetic Lottery","authors":["Kathryn Paige Harden"]}]'
```

### Continue using original workflow:
```bash
node index.ts bookshelf.jpg
```

## Output

The testing framework provides:

1. **Console output** with immediate results and rankings
2. **S3 storage** of detailed results:
   - `test-results.json` - Full structured data
   - `test-summary.txt` - Human-readable report
3. **Accuracy scoring** when ground truth is provided
4. **Confidence measurements** from each Textract method

## Expected Benefits

- **QUERIES method** should perform best for our use case as it leverages Textract's natural language understanding
- **LAYOUT method** may help with positioning issues on book spines
- **Confidence scores** will help filter unreliable text
- **Ground truth comparison** provides objective accuracy measurement

## Next Steps

1. Test with your book spine images
2. Compare accuracy across different methods
3. Identify the best-performing approach
4. Update the main extraction pipeline with optimal settings