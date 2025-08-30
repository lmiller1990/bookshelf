High-level flow (Bedrock-centric)
	1.	Ingest OCR text
→ Clean & segment probable title/author n-grams (simple heuristics + regex).
	2.	Bedrock LLM: “candidate extraction”
→ Prompt a Bedrock model (e.g., Claude 3.5 Sonnet on Bedrock) to emit 1-N normalized candidates with confidence + search queries.  ￼ ￼
	3.	Tool calls (web + book APIs)

	•	Web search: hit a search API (e.g., Brave Search API) with the LLM’s queries to find authoritative pages (publisher, author site, major catalog). Note: Bing Web Search API is retiring 11 Aug 2025; plan alternatives.  ￼ ￼
	•	Book metadata: query Google Books Volumes API and/or Open Library (search → work/edition) to retrieve canonical title, authors, ISBNs, publisher, year, cover.  ￼ ￼

	4.	Entity resolution & ranking (in your code or via the model)
→ Score candidates by exact/near-exact title/author match, cross-source agreement, presence of ISBN-13, and publisher page match. Resolve to a single canonical record (with alternates kept as fallbacks).
	5.	Bedrock LLM: “verification & stitching”
→ Give the model the fetched metadata and ask it to:

	•	confirm the top match,
	•	summarize discrepancies,
	•	produce a final JSON with links (publisher, Google Books, Open Library).

	6.	Respond
→ Return your final JSON to the client. Keep raw traces for audit.
	7.	(Optional) Guardrails & KB

	•	Use Bedrock Guardrails to keep outputs on policy and reduce prompt-injection from web snippets.  ￼
	•	If you maintain a user “read list,” store it in your DB and (optionally) index it in Bedrock Knowledge Bases for RAG-style cross-checking.  ￼ ￼

Architecture sketch (serverless)
	•	API Gateway → Lambda “orchestrator”
	•	Calls Bedrock (candidate extraction → verification)
	•	Calls tool Lambdas: web_search, google_books, open_library
	•	Writes telemetry to CloudWatch / traces to S3
	•	(Optional) Step Functions to fan-out searches and merge results
	•	DynamoDB (read list & caches), S3 (covers, traces)

Using Bedrock Agents vs rolling your own
	•	Agents: define “action groups” (tools) with OpenAPI/JSON schemas; the model plans when to call web_search/books_api and how to use results. Less glue code.  ￼
	•	Direct LLM (Converse-style): you drive the loop: prompt → decide tools → call APIs → feed results back → ask for final JSON. More control; still can apply Guardrails.  ￼

Example tool set (Agent or tool-calling)
	•	web_search(q: string) -> {results:[{title,url,snippet}...]} (Brave Search)  ￼
	•	google_books_search(q: string) -> {items:[volume]} (Volumes API)  ￼
	•	open_library_search(q: string) -> {docs:[work]} (Book Search API)  ￼

Output JSON (example)

```

{
  "input": "TRANSFORMER NICK LANE",
  "match": {
    "title": "Transformer: The Deep Chemistry of Life and Death",
    "authors": ["Nick Lane"],
    "publisher": "W. W. Norton",
    "publishedYear": 2022,
    "ids": {
      "googleBooksVolumeId": "abc123",
      "openLibraryWorkId": "OL123W",
      "isbn13": "9780393651703"
    },
    "links": {
      "publisher": "https://...",
      "googleBooks": "https://books.google.com/books?id=abc123",
      "openLibrary": "https://openlibrary.org/works/OL123W"
    },
    "confidence": 0.98,
    "alternates": [...]
  }
}
```

Prompt patterns (concise)
	•	Candidate extraction
	•	“Given this noisy OCR, emit JSON of plausible {title, authors[], queryStrings[]} without fabricating missing fields. Keep 1–5 candidates.”
	•	Verification & stitching
	•	“Here is the fetched metadata from web/books APIs. Select the best match, explain conflicts briefly, and output the Final JSON schema.”

Notes & choices
	•	Model: start with Claude 3.5 Sonnet on Bedrock (strong at extraction + tool use). Use Haiku for cheaper pre-passes.  ￼
	•	Search: avoid Bing Web Search API for green-field builds (retiring 11 Aug 2025). Brave Search API is simple and neutral; Google Programmable Search is another option if you need Google results.  ￼ ￼
	•	Book APIs: Prefer Google Books for coverage; use Open Library to cross-validate and to get open covers & work/edition graph.  ￼ ￼
	•	Safety: apply Bedrock Guardrails to both prompts and responses; strip/escape HTML and block tool-use if the model tries to call off-scope URLs.  ￼

This gives you a clean Bedrock-first pipeline with deterministic linking via public APIs, while keeping the LLM focused on extraction and reconciliation rather than “remembering” titles.
