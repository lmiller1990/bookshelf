# BookImg - AWS Bedrock Processing & Matching Plan

## Goal
Process noisy OCR text (from AWS Textract) into validated book metadata with links, using AWS Bedrock and supporting APIs.

---

## High-Level Flow
1. **Input**: OCR text stored in S3 (e.g., `runs/{runId}/extracted.txt`).
2. **Step Functions Orchestration**:
   - **L1 Extraction (Bedrock)** → candidate titles/authors + search queries.
   - **Tool calls (Lambdas)** → web search + Google Books + Open Library.
   - **L2 Verification (Bedrock)** → reconcile candidates, score, produce final JSON.
   - **Link discovery (Lambda)** → build retailer links (Amazon, others).
3. **Persistence**:
   - DynamoDB: normalized books (keys: title+author, ISBN).
   - S3: raw artifacts (prompts, responses, traces).
4. **Observability**: CloudWatch/X-Ray logs and traces.
5. **Safety**: Optional Bedrock Guardrails to block prompt injection.

---

## Implementation Styles

### A) Bedrock Agents
- Define **Action Groups** via OpenAPI schemas:
  - `web_search(q: string)`
  - `books.google.search(q: string)`
  - `books.openlib.search(q: string)`
  - `links.build(ids: {...})`
- Agent decides which tools to call.
- Less glue code, but less deterministic.

### B) Manual Orchestration (Recommended First)
- Step Functions drives the loop.
- Bedrock handles:
  - Candidate extraction (L1).
  - Verification + stitching (L2).
- Lambdas handle API calls.
- More control and reproducibility.

---

## Data Contracts

### L1 Extraction (Bedrock → You)
```json
{
  "candidates": [
    {
      "title": "From Bacteria to Bach and Back",
      "authors": ["Daniel C. Dennett"],
      "queries": ["Dennett From Bacteria to Bach and Back book"],
      "confidence_heuristic": 0.72
    }
  ]
}
```

### Tool Results (APIs → Bedrock)
```json
{
  "candidate": {...},
  "web": [{ "url":"...", "title":"...", "snippet":"..." }],
  "googleBooks": [{ "title":"...", "authors":["..."], "isbn":"..." }],
  "openLibrary": [{ "workId":"OL...", "title":"...", "authors":["..."] }]
}
```

### Final Record (Bedrock → You)
```json
{
  "match": {
    "title": "From Bacteria to Bach and Back",
    "authors": ["Daniel C. Dennett"],
    "publisher": "W. W. Norton",
    "publishedYear": 2017,
    "ids": { "isbn13": "9780393355502", "googleBooksId": "XXXX", "openLibraryWorkId": "OLXXXXW" },
    "links": { "amazon": "https://...", "openLibrary": "https://..." },
    "confidence": 0.96,
    "alternates": [...]
  }
}
```

---

## Scoring Signals
- Title/author exact match (0.40)
- ISBN-13 present & consistent (0.25)
- Publisher-domain page match (0.20)
- Agreement across Google Books + Open Library (0.10)
- Year proximity (0.05)

---

## Terraform Infrastructure

**Core**
- `aws_s3_bucket.bookimg` (versioned, encrypted).
- `aws_dynamodb_table.books` (PK: normalized key, SK: ISBN).
- `aws_lambda_function.*`:
  - `extract_candidates`
  - `web_search`
  - `books_google`
  - `books_openlib`
  - `verify_and_stitch`
  - `build_links`
  - `persist_results`
- `aws_sfn_state_machine.bookimg_pipeline`
- `aws_secretsmanager_secret` (API keys).
- `aws_iam_role` least-privilege per Lambda.
- `aws_cloudwatch_log_group` per Lambda.
- `aws_bedrock_guardrail` (optional).

---

## Step Functions Outline
```json
{
  "StartAt": "ExtractCandidates",
  "States": {
    "ExtractCandidates": { "Type": "Task", "Resource": "arn:lambda:extract_candidates", "Next": "FanoutTools" },
    "FanoutTools": {
      "Type": "Parallel",
      "Branches": [
        { "StartAt": "WebSearch", "States": { "WebSearch": { "Type": "Task", "Resource": "arn:lambda:web_search", "End": true } } },
        { "StartAt": "GoogleBooks", "States": { "GoogleBooks": { "Type": "Task", "Resource": "arn:lambda:books_google", "End": true } } },
        { "StartAt": "OpenLibrary", "States": { "OpenLibrary": { "Type": "Task", "Resource": "arn:lambda:books_openlib", "End": true } } }
      ],
      "Next": "VerifyAndStitch"
    },
    "VerifyAndStitch": { "Type": "Task", "Resource": "arn:lambda:verify_and_stitch", "Next": "BuildLinks" },
    "BuildLinks": { "Type": "Task", "Resource": "arn:lambda:build_links", "Next": "PersistResults" },
    "PersistResults": { "Type": "Task", "Resource": "arn:lambda:persist_results", "End": true }
  }
}
```

---

## Prompts

### L1 Extraction
```
You extract book title/author candidates from noisy OCR.
Output JSON: {candidates:[{title,authors[],queries[],confidence_heuristic}]}
Rules: no invented data; 1–7 candidates; prefer multi-word titles and human names.
```

### L2 Verification
```
You are a validator. Given a candidate and API results, select the best match.
Return JSON: {match:{...}} with confidence. If uncertain, include alternates.
```

---

## Security
- IAM scoped to exact ARNs.
- No root creds; API keys in Secrets Manager.
- Sanitize web snippets before sending to Bedrock.
- Guardrails block unsafe tool calls and enforce JSON.

---

## Deliverables
- Terraform modules: `bedrock/`, `compute/`, `data/`, `orchestration/`, `security/`.
- Prompts: `prompts/l1_extract.md`, `prompts/l2_verify.md`.
- Schemas: `schemas/candidate.json`, `schemas/final.json`, `schemas/tools.openapi.yaml`.
- Documentation: `ARCHITECTURE.md`.

---
