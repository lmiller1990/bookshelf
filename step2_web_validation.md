# Step 2: Web Search Validation

## Task
Validate candidate title/author pairings from Step 1 using web search and score their accuracy.

## Process Flow

### 2.1 Search Query Construction
For each candidate from Step 1:
- Primary query: `"[Title]" "[Author]" book`
- Fallback queries if no results:
  - `"[Title]" [Author]` (without quotes on author)
  - `[Title] [Author] book` (no quotes)

### 2.2 Search Execution
- Use web search API (Google, Bing, or AWS Kendra)
- Collect top 10 results
- Extract: title, URL, snippet text

### 2.3 Validation Scoring
Score each candidate (0.0-1.0) based on:

**High Confidence Indicators (0.8-1.0):**
- Exact title + author match in result titles
- Results from book retailers (Amazon, Barnes & Noble)
- Results from book databases (Goodreads, WorldCat)
- Publisher information matches

**Medium Confidence Indicators (0.4-0.7):**
- Partial title/author matches
- Results from library catalogs
- Academic/review sites mentioning the book
- Author name appears with different but similar titles

**Low Confidence Indicators (0.1-0.3):**
- Only author name matches
- Generic book-related results
- Very few total results

### 2.4 Output Format
```json
{
  "validated_books": [
    {
      "title": "From Bacteria to Bach and Back",
      "author": "Daniel C. Dennett",
      "confidence_score": 0.95,
      "search_results_count": 8,
      "validation_sources": ["amazon.com", "goodreads.com", "publisher_site"],
      "original_fragments": ["DANIEL C. DENNETT", "FROM BACTERIA TO BACH AND BACK"]
    }
  ]
}
```

### 2.5 Threshold Filtering
- Only return candidates with confidence > 0.6
- Flag potential duplicates (same book, different fragment interpretations)
- Rank results by confidence score