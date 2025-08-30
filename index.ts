#!/usr/bin/env node

import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  TextractClient,
  DetectDocumentTextCommand,
  AnalyzeDocumentCommand,
} from "@aws-sdk/client-textract";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { readFileSync } from "fs";
import path from "path";

const BUCKET_NAME = "bookimg-uat";
const s3Client = new S3Client({ region: "ap-southeast-2" });
const textractClient = new TextractClient({ region: "ap-southeast-2" });
const bedrockClient = new BedrockRuntimeClient({ region: "ap-southeast-2" });

async function ensureBucketExists() {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
    console.log(`✅ Bucket ${BUCKET_NAME} exists`);
  } catch (error) {
    if (error.name === "NotFound") {
      console.log(`📦 Creating bucket ${BUCKET_NAME}...`);
      await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
      console.log(`✅ Bucket ${BUCKET_NAME} created`);
    } else {
      throw error;
    }
  }
}

async function uploadImage(imagePath: string, sessionDir: string) {
  const imageBuffer = readFileSync(imagePath);
  const fileName = path.basename(imagePath);
  const s3Key = `${sessionDir}/${fileName}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: imageBuffer,
      ContentType: "image/jpeg",
    })
  );

  console.log(`Uploaded ${fileName} to s3://${BUCKET_NAME}/${s3Key}`);
  return s3Key;
}

async function extractText(s3Key: string) {
  const command = new DetectDocumentTextCommand({
    Document: {
      S3Object: {
        Bucket: BUCKET_NAME,
        Name: s3Key,
      },
    },
  });

  console.log(`🔍 Running Textract on ${s3Key}...`);
  const response = await textractClient.send(command);

  const extractedText =
    response.Blocks?.filter((block) => block.BlockType === "LINE")
      ?.map((block) => block.Text)
      ?.join("\n") || "";

  console.log(`✅ Extracted ${response.Blocks?.length || 0} text blocks`);
  return extractedText;
}

async function testDetectDocumentText(s3Key: string): Promise<TextractResult> {
  const command = new DetectDocumentTextCommand({
    Document: {
      S3Object: {
        Bucket: BUCKET_NAME,
        Name: s3Key,
      },
    },
  });

  const response = await textractClient.send(command);
  const blocks = response.Blocks || [];

  const extractedText = blocks
    .filter((block) => block.BlockType === "LINE")
    .map((block) => block.Text)
    .join("\n");

  const avgConfidence =
    blocks
      .filter((block) => block.BlockType === "LINE")
      .reduce((sum, block) => sum + (block.Confidence || 0), 0) /
    blocks.filter((b) => b.BlockType === "LINE").length;

  return {
    method: "DetectDocumentText (LINE)",
    extractedText,
    confidence: avgConfidence,
    blocks,
  };
}

interface BookCandidate {
  title: string;
  authors: string[];
  confidence: number;
}

interface CandidatesResponse {
  candidates: BookCandidate[];
}

interface GroundTruthBook {
  title: string;
  authors: string[];
}

interface TextractResult {
  method: string;
  extractedText: string;
  confidence?: number;
  blocks?: any[];
  queries?: any[];
}

interface ValidatedBook {
  original: BookCandidate;
  validated?: {
    title: string;
    authors: string[];
    isbn?: string;
    publisher?: string;
    publishYear?: number;
    openLibraryUrl?: string;
    coverUrl?: string;
    workId?: string;
  };
  confidence: number;
  validationSource: "open_library" | "none";
  matchReason?: string;
}

interface OpenLibrarySearchResult {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  publisher?: string[];
  cover_i?: number;
  ebook_access?: string;
}

interface OpenLibraryResponse {
  docs: OpenLibrarySearchResult[];
  numFound: number;
}

interface TestResult {
  method: string;
  textractResult: TextractResult;
  candidates: CandidatesResponse;
  accuracy: number | undefined;
}

async function extractCandidates(
  extractedText: string
): Promise<CandidatesResponse> {
  const prompt = `You are a book metadata extractor. Given noisy OCR text from book spines, extract book title/author candidates.

CRITICAL: You MUST respond with valid JSON in this exact format:
{
  "candidates": [
    {
      "title": "Full Book Title",
      "authors": ["Author Name", "Co-author Name"],
      "confidence": 0.9
    }
  ]
}

REQUIRED FIELDS:
- "title": string (never null or empty)
- "authors": array of strings (never null, use empty array [] if no authors found)
- "confidence": number between 0.0 and 1.0

RULES:
- Output ONLY the JSON object, no other text
- Don't invent data - only extract what's clearly present
- Author/title are usually close together, can be same or separate lines
- If uncertain about authors, use empty array [] not null
- Confidence: 0.9+ = very clear, 0.7+ = likely, 0.5+ = possible

OCR Text:
${extractedText}`;

  const command = new InvokeModelCommand({
    // modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
    modelId: "anthropic.claude-3-haiku-20240307-v1:0",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 2000,
      // temperature: 0.3, // Low temperature for consistent, deterministic responses
      // top_p: 0.3, // Focus on most probable tokens for structured output
      // top_k: 20, // Limit vocabulary to top 20 tokens for consistency
      system:
        "You are a precise book metadata extraction system. You MUST respond with valid JSON only. Never include explanatory text, markdown, or any content outside the JSON object.",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
    contentType: "application/json",
    accept: "application/json",
  });

  console.log(`🤖 Processing with Bedrock Claude 3 Haiku...`);
  const response = await bedrockClient.send(command);

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const candidatesText = responseBody.content[0].text;

  try {
    const candidates: CandidatesResponse = JSON.parse(candidatesText);
    console.log(`✅ Extracted ${candidates.candidates.length} book candidates`);
    return candidates;
  } catch (error) {
    console.warn("⚠️ Failed to parse JSON response, returning raw text");
    console.warn("Raw response:", candidatesText);
    return { candidates: [] };
  }
}

function calculateAccuracy(
  candidates: BookCandidate[],
  groundTruth: GroundTruthBook[]
): number {
  if (!groundTruth || groundTruth.length === 0) return 0;

  let matches = 0;
  const totalTruthBooks = groundTruth.length;

  for (const truth of groundTruth) {
    const matchingCandidate = candidates.find((candidate) => {
      const titleMatch =
        candidate.title.toLowerCase().includes(truth.title.toLowerCase()) ||
        truth.title.toLowerCase().includes(candidate.title.toLowerCase());

      const authorMatch = truth.authors.some((truthAuthor) =>
        candidate.authors.some(
          (candAuthor) =>
            candAuthor.toLowerCase().includes(truthAuthor.toLowerCase()) ||
            truthAuthor.toLowerCase().includes(candAuthor.toLowerCase())
        )
      );

      return titleMatch || authorMatch;
    });

    if (matchingCandidate) {
      matches++;
    }
  }

  return matches / totalTruthBooks;
}

function calculateStringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;

  // Simple word overlap scoring
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  const commonWords = words1.filter((word) => words2.includes(word)).length;
  const totalWords = Math.max(words1.length, words2.length);

  return commonWords / totalWords;
}

function matchAuthors(
  candidateAuthors: string[],
  libraryAuthors: string[]
): number {
  if (!candidateAuthors.length || !libraryAuthors.length) return 0;

  let bestMatch = 0;
  for (const candAuthor of candidateAuthors) {
    for (const libAuthor of libraryAuthors) {
      const similarity = calculateStringSimilarity(candAuthor, libAuthor);
      bestMatch = Math.max(bestMatch, similarity);
    }
  }
  return bestMatch;
}

async function searchOpenLibrary(
  title: string,
  authors: string[]
): Promise<OpenLibraryResponse> {
  const baseUrl = "https://openlibrary.org/search.json";
  const fields =
    "key,title,author_name,first_publish_year,isbn,publisher,cover_i,ebook_access";

  // Try combined search first
  let query = `title:"${title}"`;
  if (authors.length > 0) {
    query += ` author:"${authors[0]}"`;
  }

  const url = `${baseUrl}?q=${encodeURIComponent(
    query
  )}&fields=${fields}&limit=5`;

  console.log(`🔍 Searching Open Library: ${query}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data: OpenLibraryResponse = await response.json();
    console.log(`📚 Found ${data.numFound} results`);
    return data;
  } catch (error) {
    console.warn(`⚠️ Open Library search failed: ${error}`);
    return { docs: [], numFound: 0 };
  }
}

async function validateWithOpenLibrary(
  candidate: BookCandidate
): Promise<ValidatedBook> {
  console.log(
    `\n🔎 Validating: "${candidate.title}" by ${candidate.authors.join(", ")}`
  );

  const searchResults = await searchOpenLibrary(
    candidate.title,
    candidate.authors
  );

  if (searchResults.docs.length === 0) {
    return {
      original: candidate,
      confidence: candidate.confidence * 0.5, // Reduce confidence for unvalidated
      validationSource: "none",
      matchReason: "No matches found in Open Library",
    };
  }

  // Find best match
  let bestMatch: OpenLibrarySearchResult | null = null;
  let bestScore = 0;
  let matchReason = "";

  for (const result of searchResults.docs) {
    const titleSimilarity = calculateStringSimilarity(
      candidate.title,
      result.title
    );
    const authorSimilarity = matchAuthors(
      candidate.authors,
      result.author_name || []
    );

    // Weighted scoring: title is more important
    const score = titleSimilarity * 0.7 + authorSimilarity * 0.3;

    console.log(
      `  📖 "${result.title}" by ${(result.author_name || []).join(
        ", "
      )} - Score: ${score.toFixed(2)} (title: ${titleSimilarity.toFixed(
        2
      )}, author: ${authorSimilarity.toFixed(2)})`
    );

    if (score > bestScore) {
      bestScore = score;
      bestMatch = result;
      matchReason = `Title match: ${titleSimilarity.toFixed(
        2
      )}, Author match: ${authorSimilarity.toFixed(2)}`;
    }
  }

  if (!bestMatch || bestScore < 0.5) {
    return {
      original: candidate,
      confidence: candidate.confidence * 0.6,
      validationSource: "none",
      matchReason: `Best match score ${bestScore.toFixed(
        2
      )} below threshold 0.5`,
    };
  }

  // Build validated book
  const workId = bestMatch.key.replace("/works/", "");
  const validated = {
    title: bestMatch.title,
    authors: bestMatch.author_name || [],
    isbn: bestMatch.isbn?.[0],
    publisher: bestMatch.publisher?.[0],
    publishYear: bestMatch.first_publish_year,
    openLibraryUrl: `https://openlibrary.org${bestMatch.key}`,
    coverUrl: bestMatch.cover_i
      ? `https://covers.openlibrary.org/b/id/${bestMatch.cover_i}-M.jpg`
      : undefined,
    workId,
  };

  // Boost confidence based on validation quality
  const confidenceBoost = bestScore > 0.8 ? 1.2 : bestScore > 0.6 ? 1.1 : 1.0;
  const finalConfidence = Math.min(candidate.confidence * confidenceBoost, 1.0);

  console.log(
    `✅ Validated: "${validated.title}" by ${validated.authors.join(
      ", "
    )} (confidence: ${finalConfidence.toFixed(2)})`
  );

  return {
    original: candidate,
    validated,
    confidence: finalConfidence,
    validationSource: "open_library",
    matchReason,
  };
}

async function validateAllCandidates(
  candidates: BookCandidate[]
): Promise<ValidatedBook[]> {
  console.log(
    `\n🔍 Validating ${candidates.length} book candidates with Open Library...`
  );

  const validatedBooks: ValidatedBook[] = [];

  for (const candidate of candidates) {
    const validated = await validateWithOpenLibrary(candidate);
    validatedBooks.push(validated);

    // Be respectful to Open Library API
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const validatedCount = validatedBooks.filter(
    (b) => b.validationSource === "open_library"
  ).length;
  console.log(
    `📊 Validation complete: ${validatedCount}/${candidates.length} books validated`
  );

  return validatedBooks;
}

async function runTextractTests(
  s3Key: string,
  groundTruth?: GroundTruthBook[]
): Promise<TestResult[]> {
  console.log(`\n🧪 Running Textract tests on ${s3Key}...`);

  const testMethods = [() => testDetectDocumentText(s3Key)];

  const results: TestResult[] = [];

  for (const testMethod of testMethods) {
    try {
      console.log(`\n📋 Testing: ${testMethod.name}`);
      const textractResult = await testMethod();
      console.log(
        `✅ ${textractResult.method}: ${
          textractResult.extractedText.length
        } chars, confidence: ${textractResult.confidence?.toFixed(2) || "N/A"}`
      );

      // Process through Bedrock for comparison
      const candidates = await extractCandidates(textractResult.extractedText);
      console.log("Candidates", JSON.stringify(candidates.candidates, null, 2));

      const accuracy = groundTruth
        ? calculateAccuracy(candidates.candidates, groundTruth)
        : undefined;

      results.push({
        method: textractResult.method,
        textractResult,
        candidates,
        accuracy,
      });
    } catch (error) {
      console.error(`❌ ${testMethod.name} failed:`, error);
      results.push({
        method: `${testMethod.name} (FAILED)`,
        textractResult: {
          method: testMethod.name,
          extractedText: "",
          confidence: 0,
        },
        candidates: { candidates: [] },
        accuracy: 0,
      });
    }
  }

  return results;
}

function printTestResults(
  results: TestResult[],
  groundTruth?: GroundTruthBook[]
) {
  console.log(`\n📊 TEST RESULTS SUMMARY`);
  console.log(`==========================================`);

  if (groundTruth && groundTruth.length > 0) {
    console.log(`\n📚 GROUND TRUTH (${groundTruth.length} books):`);
    groundTruth.forEach((book, i) => {
      console.log(`${i + 1}. "${book.title}" by ${book.authors.join(", ")}`);
    });
    console.log(`\n🎯 ACCURACY RANKINGS:`);
    const sortedResults = [...results].sort(
      (a, b) => (b.accuracy || 0) - (a.accuracy || 0)
    );
    sortedResults.forEach((result, i) => {
      const accuracy =
        result.accuracy !== undefined
          ? `${(result.accuracy * 100).toFixed(1)}%`
          : "N/A";
      console.log(`${i + 1}. ${result.method}: ${accuracy}`);
    });
  }

  console.log(`\n🔍 DETAILED RESULTS:`);
  results.forEach((result, i) => {
    console.log(`\n--- ${i + 1}. ${result.method} ---`);
    console.log(
      `Confidence: ${result.textractResult.confidence?.toFixed(2) || "N/A"}`
    );
    console.log(
      `Extracted Text Length: ${result.textractResult.extractedText.length}`
    );
    console.log(`Candidates Found: ${result.candidates.candidates.length}`);

    if (result.accuracy !== undefined) {
      console.log(`Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
    }

    if (result.textractResult.queries) {
      console.log(`Query Results:`);
      result.textractResult.queries.forEach((q) => {
        console.log(`  Q: ${q.query}`);
        console.log(
          `  A: ${q.answer} (confidence: ${q.confidence?.toFixed(2)})`
        );
      });
    }

    console.log(`Candidates:`);
    result.candidates.candidates.forEach((candidate, j) => {
      const authors =
        candidate.authors && Array.isArray(candidate.authors)
          ? candidate.authors.join(", ")
          : "Unknown";
      console.log(
        `  ${j + 1}. "${candidate.title || "Unknown Title"}" by ${authors} (${
          candidate.confidence
        })`
      );
    });

    console.log(`Raw Text Preview:`);
    console.log(result.textractResult.extractedText);
  });
}

async function saveResults(
  sessionDir: string,
  extractedText: string,
  candidates: CandidatesResponse
) {
  const textKey = `${sessionDir}/extracted-text.txt`;
  const candidatesKey = `${sessionDir}/candidates.json`;

  await Promise.all([
    s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: textKey,
        Body: extractedText,
        ContentType: "text/plain",
      })
    ),
    s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: candidatesKey,
        Body: JSON.stringify(candidates, null, 2),
        ContentType: "application/json",
      })
    ),
  ]);

  console.log(`💾 Saved results to s3://${BUCKET_NAME}/${sessionDir}/`);
}

async function saveTestResults(
  sessionDir: string,
  testResults: TestResult[],
  groundTruth?: GroundTruthBook[]
) {
  const resultsKey = `${sessionDir}/test-results.json`;
  const summaryKey = `${sessionDir}/test-summary.txt`;

  const testData = {
    timestamp: new Date().toISOString(),
    groundTruth,
    results: testResults,
  };

  // Create summary report
  const summary = [
    `Textract Testing Report - ${new Date().toISOString()}`,
    `=====================================================`,
    ``,
    ...(groundTruth && groundTruth.length > 0
      ? [
          `Ground Truth (${groundTruth.length} books):`,
          ...groundTruth.map(
            (book, i) =>
              `${i + 1}. "${book.title}" by ${book.authors.join(", ")}`
          ),
          ``,
          `Accuracy Rankings:`,
          ...testResults
            .sort((a, b) => (b.accuracy || 0) - (a.accuracy || 0))
            .map((result, i) => {
              const accuracy =
                result.accuracy !== undefineikd
                  ? `${(result.accuracy * 100).toFixed(1)}%`
                  : "N/A";
              return `${i + 1}. ${result.method}: ${accuracy}`;
            }),
          ``,
        ]
      : []),
    `Detailed Results:`,
    ...testResults.flatMap((result, i) => [
      ``,
      `--- ${i + 1}. ${result.method} ---`,
      `Confidence: ${result.textractResult.confidence?.toFixed(2) || "N/A"}`,
      `Extracted Text Length: ${result.textractResult.extractedText.length}`,
      `Candidates Found: ${result.candidates.candidates.length}`,
      ...(result.accuracy !== undefined
        ? [`Accuracy: ${(result.accuracy * 100).toFixed(1)}%`]
        : []),
      `Candidates:`,
      ...result.candidates.candidates.map((candidate, j) => {
        const authors =
          candidate.authors && Array.isArray(candidate.authors)
            ? candidate.authors.join(", ")
            : "Unknown";
        return `  ${j + 1}. "${
          candidate.title || "Unknown Title"
        }" by ${authors} (${candidate.confidence})`;
      }),
      `Raw Text Preview:`,
      `  ${result.textractResult.extractedText.substring(0, 200)}${
        result.textractResult.extractedText.length > 200 ? "..." : ""
      }`,
    ]),
  ].join("\n");

  await Promise.all([
    s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: resultsKey,
        Body: JSON.stringify(testData, null, 2),
        ContentType: "application/json",
      })
    ),
    s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: summaryKey,
        Body: summary,
        ContentType: "text/plain",
      })
    ),
  ]);

  console.log(`💾 Test results saved to s3://${BUCKET_NAME}/${sessionDir}/`);
}

async function testValidation() {
  console.log("🧪 Testing Open Library validation with sample books...\n");

  const testCandidates: BookCandidate[] = [
    {
      title: "TRANSFORMER NICK LANE",
      authors: ["Nick Lane"],
      confidence: 0.9,
    },
    {
      title: "THE POSSIBILITY OF LIFE",
      authors: ["JAIME GREEN", "DUCKWORTH FALKOWSKI"],
      confidence: 0.8,
    },
    {
      title: "FOLLOW YOUR GUT",
      authors: ["Barr", "Crocetti", "Wild", "Stinson", "Hutchings", "SCRIBE"],
      confidence: 0.7,
    },
    {
      title: "THE BITCOIN STANDARD",
      authors: ["AMMOUS"],
      confidence: 0.9,
    },
    {
      title: "50 MATHEMATICAL IDEAS YOU REALLY NEED TO KNOW",
      authors: ["Tony Crilly"],
      confidence: 0.9,
    },
    {
      title: "FROM BACTERIA TO BACH AND BACK",
      authors: ["DANIEL C. DENNETT"],
      confidence: 0.9,
    },
    {
      title: "THE GENETIC LOTTERY",
      authors: ["HARDEN"],
      confidence: 0.9,
    },
    {
      title: "WHY DNA MATTERS FOR SOCIAL EQUALITY",
      authors: [],
      confidence: 0.6,
    },
    {
      title: "REBEL CELL",
      authors: ["KAT ARNEY"],
      confidence: 0.9,
    },
    {
      title: "UNWELL",
      authors: ["MIKE MCRAE"],
      confidence: 0.9,
    },
    {
      title: "HOW TO SPEND A TRILLION DOLLARS",
      authors: ["ROWAN HOOPER"],
      confidence: 0.9,
    },
  ];

  const validatedBooks = await validateAllCandidates(testCandidates);

  console.log("\n📋 VALIDATION RESULTS:");
  console.log("=====================");

  validatedBooks.forEach((book, i) => {
    console.log(
      `\n${i + 1}. Original: "${
        book.original.title
      }" by ${book.original.authors.join(", ")}`
    );
    console.log(
      `   Status: ${
        book.validationSource === "open_library"
          ? "✅ VALIDATED"
          : "❌ NOT FOUND"
      }`
    );
    console.log(
      `   Confidence: ${book.confidence.toFixed(
        2
      )} (was ${book.original.confidence.toFixed(2)})`
    );

    if (book.validated) {
      console.log(
        `   Validated: "${
          book.validated.title
        }" by ${book.validated.authors.join(", ")}`
      );
      if (book.validated.isbn) console.log(`   ISBN: ${book.validated.isbn}`);
      if (book.validated.publisher)
        console.log(`   Publisher: ${book.validated.publisher}`);
      if (book.validated.publishYear)
        console.log(`   Year: ${book.validated.publishYear}`);
      if (book.validated.openLibraryUrl)
        console.log(`   URL: ${book.validated.openLibraryUrl}`);
    }

    if (book.matchReason) {
      console.log(`   Match: ${book.matchReason}`);
    }
  });

  const validatedCount = validatedBooks.filter(
    (b) => b.validationSource === "open_library"
  ).length;
  console.log(
    `\n🎯 Summary: ${validatedCount}/${testCandidates.length} books successfully validated`
  );
}

async function main() {
  const imagePath = process.argv[2];
  const groundTruthArg = process.argv[3];

  if (!imagePath) {
    console.error("Usage: node index.ts <image-path> [ground-truth-json]");
    console.error("");
    console.error("Examples:");
    console.error("  node index.ts bookshelf.jpg");
    console.error(
      '  node index.ts bookshelf.jpg \'[{"title":"Book Title","authors":["Author Name"]}]\''
    );
    console.error(
      "  node index.ts bookshelf.jpg --test  # Run all Textract API tests"
    );
    console.error(
      "  node index.ts --validate-test      # Test Open Library validation only"
    );
    process.exit(1);
  }

  // Special case: test validation only
  if (imagePath === "--validate-test") {
    await testValidation();
    return;
  }

  try {
    const imageName = path.basename(imagePath, path.extname(imagePath));
    const timestamp = Date.now();
    const sessionDir = `${imageName}-${timestamp}`;

    console.log(`Starting extraction for ${imagePath}`);
    console.log(`Session: ${sessionDir}`);

    console.log("Ensuring bucket exists...");
    await ensureBucketExists();
    console.log("Uploading image...");
    const s3Key = await uploadImage(imagePath, sessionDir);

    // Parse ground truth if provided
    let groundTruth: GroundTruthBook[] | undefined;
    if (groundTruthArg && groundTruthArg !== "--test") {
      try {
        groundTruth = JSON.parse(groundTruthArg);
        console.log(`📚 Ground truth provided: ${groundTruth.length} books`);
      } catch (error) {
        console.warn(`⚠️ Could not parse ground truth JSON: ${error}`);
      }
    }

    if (groundTruthArg === "--test" || groundTruth) {
      // Run comprehensive tests
      const testResults = await runTextractTests(s3Key, groundTruth);
      printTestResults(testResults, groundTruth);
      await saveTestResults(sessionDir, testResults, groundTruth);

      console.log(
        `\n🎉 Testing complete! Results saved in s3://${BUCKET_NAME}/${sessionDir}/`
      );
      console.log(`📄 Download test-summary.txt for detailed report`);
    } else {
      // Run original workflow
      const extractedText = await extractText(s3Key);
      const candidates = await extractCandidates(extractedText);
      await saveResults(sessionDir, extractedText, candidates);

      console.log("\nExtracted Text Preview:");
      console.log("---");
      console.log(
        extractedText.substring(0, 300) +
          (extractedText.length > 300 ? "..." : "")
      );
      console.log("---");

      console.log("\nBook Candidates:");
      console.log("---");
      candidates.candidates.forEach((candidate, i) => {
        const authors =
          candidate.authors && Array.isArray(candidate.authors)
            ? candidate.authors.join(", ")
            : "Unknown";
        console.log(
          `${i + 1}. "${
            candidate.title || "Unknown Title"
          }" by ${authors} (confidence: ${candidate.confidence})`
        );
      });
      console.log("---");
      console.log(
        `Complete! Results saved in s3://${BUCKET_NAME}/${sessionDir}/`
      );
    }
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
