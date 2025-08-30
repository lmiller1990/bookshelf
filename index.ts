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

interface BookCandidate {
  title: string;
  authors: string[];
  confidence: number;
}

interface CandidatesResponse {
  candidates: BookCandidate[];
}

async function extractCandidates(
  extractedText: string
): Promise<CandidatesResponse> {
  const prompt = `You are a book metadata extractor. Given noisy OCR text from book spines, extract book title/author candidates.

Rules:
- Output valid JSON only: {"candidates": [{"title": "...", "authors": ["..."], "confidence": 0.0-1.0}]}
- Extract 1-5 most confident candidates
- Prefer complete titles (2+ words) and recognizable author names
- Don't invent data - only extract what's clearly present
- Confidence: 0.9+ = very clear, 0.7+ = likely, 0.5+ = possible

OCR Text:
${extractedText}`;

  const command = new InvokeModelCommand({
    // modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
    modelId: "anthropic.claude-3-haiku-20240307-v1:0",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 2000,
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
    return { candidates: [] };
  }
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

async function main() {
  const imagePath = process.argv[2];

  if (!imagePath) {
    console.error("Usage: node index.js <image-path>");
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
      console.log(
        `${i + 1}. "${candidate.title}" by ${candidate.authors.join(
          ", "
        )} (confidence: ${candidate.confidence})`
      );
    });
    console.log("---");
    console.log(
      `Complete! Results saved in s3://${BUCKET_NAME}/${sessionDir}/`
    );
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
