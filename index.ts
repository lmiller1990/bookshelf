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
    process.exit(1);
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
