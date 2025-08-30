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

## Implementation Details

- **Step 1**: Text cleanup and candidate generation → `step1_text_cleanup.md`  
- **Step 2**: Web search validation and scoring → `step2_web_validation.md`

## Next Steps

1. **Implement AWS Textract API integration**
   - Set up AWS credentials and SDK
   - Create image upload and text extraction service
   - Handle Textract response parsing

## Architecture Notes

- Use AWS Bedrock for LLM processing (text cleanup, candidate generation)
- Leverage web search APIs for validation
- Prioritize "hands off" AWS-native workflow where possible

## Resources

- [AWS Bedrock FAQs](https://aws.amazon.com/bedrock/faqs/)
- [AWS Textract Documentation](https://docs.aws.amazon.com/textract/latest/dg/what-is.html)
