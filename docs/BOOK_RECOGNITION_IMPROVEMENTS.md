# Book Recognition Improvements

## Current Issues with Book Validation

### Google Books API Limitations

The current system uses Google Books API for book validation, but faces significant challenges:

**1. Exact Match Requirements**
- API requires precise title/author matching
- Minor typos in author names prevent successful matches
- OCR-extracted text often contains spelling errors or formatting issues
- Even when title is correct, author name variations cause failures

**2. Rigid Search Parameters**
- Current implementation uses `intitle:"exact title"` and `inauthor:"exact author"`
- No fuzzy matching or tolerance for common OCR errors
- Fails when book spine abbreviates author names (e.g., "J.K. Rowling" vs "Rowling")

**3. Limited Result Quality**
- Takes first result without confidence scoring
- No validation that the match is actually correct
- Missing similarity comparison between query and results

## Proposed Solutions

### 1. Google Custom Search API Integration

**Advantages:**
- More flexible search that handles typos and variations
- Returns web pages with book information (Amazon, Goodreads, etc.)
- Better fuzzy matching compared to Books API

**Implementation:**
```javascript
// Replace Google Books API calls with Custom Search
const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=book+"${title}"+"${author}"`;
```

**Next Step:** Extract book metadata from search result pages

### 2. Multi-Source Validation Pipeline

**Current State:** 
- Single provider validation (Google Books or Open Library)
- Located in `packages/book-validator/src/index.ts:19-55` (Google Books validation)
- Sequential validation with 500ms delays between requests

**Proposed Enhancement:**
```javascript
async function validateBook(candidate) {
  const providers = [
    () => validateWithOpenLibrary(candidate),
    () => validateWithGoogleBooks(candidate), 
    () => validateWithGoogleSearch(candidate), // NEW
    () => validateWithISBNDB(candidate),       // NEW
  ];
  
  // Try each provider, return best match
  for (const provider of providers) {
    const result = await provider();
    if (result.score > 0.8) return result;
  }
}
```

### 3. Intelligent Metadata Extraction from Web Results

**For Google Custom Search Results:**

**Option A: Structured Data Parsing**
```javascript
function extractFromStructuredData(html) {
  // Parse JSON-LD structured data
  const scripts = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/gs);
  for (const script of scripts) {
    const data = JSON.parse(script);
    if (data['@type'] === 'Book') {
      return {
        title: data.name,
        authors: data.author?.name,
        isbn: data.isbn,
        publisher: data.publisher?.name
      };
    }
  }
}
```

**Option B: LLM-Based Extraction** (Recommended)
```javascript
async function extractBookFromSearchResult(searchResultText) {
  const prompt = `Extract book metadata from this web search result. Return JSON:
${searchResultText}

Format: {"title": "", "author": "", "isbn": "", "publisher": ""}`;

  const response = await bedrockClient.send(new InvokeModelCommand({
    modelId: "anthropic.claude-3-haiku-20240307-v1:0", // Already in use
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  }));
  
  return JSON.parse(response.content[0].text);
}
```

**Option C: Site-Specific Parsing**
```javascript
function extractBookMetadata(url, html) {
  if (url.includes('amazon.com')) {
    return parseAmazonProduct(html);
  } else if (url.includes('goodreads.com')) {
    return parseGoodreadsBook(html);
  } else if (url.includes('google.com/books')) {
    return parseGoogleBooksPage(html);
  }
  // Fallback to LLM extraction
  return extractWithLLM(html);
}
```

### 4. Enhanced Scoring and Confidence System

**Current Scoring Issues:**
- Simple string similarity in `index.ts:312-326` using basic word overlap
- No confidence weighting for different match types
- Located in `calculateStringSimilarity()` and `matchAuthors()` functions

**Proposed Improvements:**
```javascript
function calculateMatchScore(query, result) {
  // Weighted scoring system
  const titleScore = fuzzyStringMatch(query.title, result.title);
  const authorScore = bestAuthorMatch(query.authors, result.authors);
  
  // Additional signals
  const isbnMatch = query.isbn === result.isbn ? 1.0 : 0;
  const publisherMatch = fuzzyStringMatch(query.publisher, result.publisher);
  
  // Weighted combination
  const score = (
    titleScore * 0.5 +           // Title most important
    authorScore * 0.3 +          // Author second
    isbnMatch * 0.15 +           // ISBN high confidence when available
    publisherMatch * 0.05        // Publisher minor signal
  );
  
  return {
    score,
    confidence: getConfidenceLevel(score, query, result),
    breakdown: { titleScore, authorScore, isbnMatch, publisherMatch }
  };
}

function getConfidenceLevel(score, query, result) {
  if (score > 0.9 && result.isbn) return 'very_high';
  if (score > 0.8) return 'high';
  if (score > 0.6) return 'medium';
  return 'low';
}
```

### 5. Preprocessing and Fuzzy Matching

**Current OCR Text Processing:**
- Basic Bedrock Claude 3 Haiku extraction in `index.ts:208-276`
- No preprocessing of author names or titles before validation

**Proposed Preprocessing:**
```javascript
function preprocessForMatching(text) {
  return text
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '')     // Remove articles
    .replace(/[^\w\s]/g, ' ')           // Remove punctuation
    .replace(/\s+/g, ' ')               // Normalize whitespace
    .trim();
}

function normalizeAuthorName(author) {
  // Handle common author name variations
  const name = author.replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, '');
  
  // Swap "Last, First" to "First Last"
  if (name.includes(',')) {
    const [last, first] = name.split(',').map(s => s.trim());
    return `${first} ${last}`;
  }
  
  return name;
}
```

## Implementation Strategy

### Phase 1: Enhanced Search (Quick Win)
1. Add Google Custom Search API integration alongside existing Google Books
2. Implement basic web result parsing with LLM extraction
3. Update scoring system to rank multiple results

### Phase 2: Multi-Provider Pipeline
1. Add additional validation providers (ISBNdb, WorldCat)
2. Implement cascade validation with confidence thresholds
3. Add provider agreement scoring

### Phase 3: Advanced Matching
1. Implement fuzzy string matching with Levenshtein distance
2. Add preprocessing and normalization functions
3. Create comprehensive confidence scoring system

## Integration Points

**Current Architecture Integration:**
- Modify `packages/book-validator/src/index.ts:validateWithGoogleBooks()` function
- Extend existing AWS Bedrock integration for LLM-based extraction
- Maintain current SQS-based async processing pipeline
- Preserve existing confidence scoring in final results

**Testing Requirements:**
- Update validation test suite in `index.ts:testValidation()` function
- Test with existing sample candidates (lines 906-962)
- Ensure backward compatibility with current CLI and web interface

## Expected Improvements

1. **Higher Match Rate:** Fuzzy matching and multiple providers should increase successful book identifications from ~60% to ~85%
2. **Better Accuracy:** Enhanced scoring reduces false positives
3. **Robustness:** Multiple fallback options handle API failures and edge cases
4. **Rich Metadata:** Web scraping provides additional book information (covers, reviews, purchase links)

## Next Steps

1. **Implement Google Custom Search integration** as immediate improvement
2. **Add LLM-based metadata extraction** from search results  
3. **Enhance confidence scoring system** with weighted signals
4. **Test with existing bookshelf images** to measure improvement

The hybrid approach of structured data parsing → LLM extraction → site-specific parsing provides the best balance of accuracy, reliability, and maintainability while leveraging the existing AWS Bedrock infrastructure.