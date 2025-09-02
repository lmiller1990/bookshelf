import type { SQSEvent } from "aws-lambda";
import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import fs from "node:fs/promises";
import {
  bedrockClient,
  s3Client,
  sqsClient,
  getResultsBucket,
  getValidationQueueUrl,
  type BedrockMessage,
} from "@packages/shared";

const BEDROCK_PROMPT = `You are an expert at analyzing OCR text from book spines and extracting clean title/author information.

The input text comes from book spine OCR and may be fragmented, rotated, or contain partial words. Your task is to identify complete book titles and authors with high confidence.

Rules:
1. Aim to extract complete book titles and authors
2. Skip partial fragments, publisher names, or non-book text
3. Match fragments that clearly belong to the same book
4. Provide confidence scores (0.0 to 1.0)
5. Return valid JSON only

The input text can be messy. For example consider this data set

[
  "Harry",
  "POTTER AND THE",
  "Philosopher's Stone",
  "J. K.",
  "ROWLING",
  "Penguin",
  "THE GREAT GATSBY",
  "Fitzgerald",
  "SCOTT",
  "THE GREAT GATSBY",
  "George",
  "ORWELL 1984",
  "P",
  "Brontë",
  "JANE EYRE",
  "Charlotte",
  "pc",
  "at",
  "PRIDE AND",
  "PREJUDICE",
  "Jane",
  "Austen",
  "THE HOBBIT",
  "TOLKIEN",
  "FOLLOW THE RIVER",
  "James Alexander",
  "milk",
  "TO KILL A",
  "Mockingbird",
  "Harper",
  "LEE",
  "Penguin",
  "MOBY-DICK",
  "Melville",
  "Herman",
  "HOW TO",
  "READ",
  "A",
  "BOOK",
  "Mortimer Adler",
  "ROWAN",
  "HOOKER",
  "P",
  "WAR AND PEACE",
  "Tolstoy",
  "Leo"
]

It mixes:

-	Author + title on same line (George ORWELL 1984)
-	Author and title split (JANE EYRE / Charlotte)
-	Random publisher words (Penguin, milk)
-	Duplicates (THE GREAT GATSBY)
-	Noise tokens (pc, P, at)

Here is the input OCR text I want to you work on. Do you best to extract a matching author / title / and optional subtitle.

If you can't find a match, it is fine to leave a field blank (eg no title, or author). They will usually be close to each other in the data set.
{TEXT}

Return JSON in this exact format. Reply with JSON only.
{
  "candidates": Array<{
      "title": string | null
      "author": string | null
      "subtitle": string | null
      "confidence": 0-1
    }>
]
}`;

export const handler = async (event: SQSEvent) => {
  console.log("Bedrock Processor triggered:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const message: BedrockMessage = JSON.parse(record.body);
    const { jobId, extractedText } = message;

    if (!extractedText) {
      console.error(`No extractedText found for job: ${jobId}`);
      continue;
    }

    console.log(`Processing text for job: ${jobId}`);
    console.log(`Text preview: ${extractedText.substring(0, 200)}...`);

    try {
      // Prepare Bedrock request
      const prompt = BEDROCK_PROMPT.replace("{TEXT}", extractedText);

      const bedrockRequest = {
        modelId: "anthropic.claude-3-haiku-20240307-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      };

      // Call Bedrock
      const response = await bedrockClient.send(
        new InvokeModelCommand(bedrockRequest)
      );

      if (!response.body) {
        throw new Error("No response body from Bedrock");
      }

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      console.log("Bedrock response:", JSON.stringify(responseBody, null, 2));

      // Parse candidates from response
      let candidates = [];
      try {
        const content = responseBody.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          candidates = parsed.candidates || [];
        }
      } catch (parseError) {
        console.error("Error parsing Bedrock response:", parseError);
        candidates = [];
      }

      console.log(`Extracted ${candidates.length} book candidates`);

      // Store candidates in results bucket
      const resultsBucket = getResultsBucket();
      await s3Client.send(
        new PutObjectCommand({
          Bucket: resultsBucket,
          Key: `${jobId}/candidates.json`,
          Body: JSON.stringify({ candidates }, null, 2),
          ContentType: "application/json",
        })
      );

      // Send to validation queue
      const validationMessage: BedrockMessage = {
        ...message,
        candidates: candidates,
        bedrockComplete: true,
      };

      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: getValidationQueueUrl(),
          MessageBody: JSON.stringify(validationMessage),
        })
      );

      console.log(`Sent to validation queue for job: ${jobId}`);
    } catch (error) {
      console.error(`Error processing Bedrock for job ${jobId}:`, error);
      throw error;
    }
  }

  return { statusCode: 200, body: "Bedrock processing complete" };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const extractedText = `
    "pc",
    "at",
    "FOLLOW YOUR GUT",
    "Barr",
    "Crocetti",
    "Wild",
    "Stinson",
    "Hutchings",
    "SCRIBE",
    "milk",
    "The truth,",
    "the lies",
    "and the",
    "unbelievable",
    "story of",
    "the original",
    "superfood",
    "Matthew Evans",
    "AMMOUS",
    "THE BITCOIN STANDARD",
    "WILEY",
    "50",
    "mathematical ideas",
    "you really",
    "need to know",
    "Tony Crilly",
    "Quercus",
    "DANIEL C. DENNETT FROM BACTERIA TO BACH AND BACK",
    "THE GENETIC",
    "WHY DNA MATTERS",
    "HARDEN",
    "LOTTERY",
    "FOR SOCIAL EQUALITY",
    "Rebel Cell",
    "Cancer, Evolution and",
    "KAT",
    "the Science of Life",
    "ARNEY",
    "WON",
    "MIKE",
    "UNWELL",
    "UQP",
    "McRAE",
    "HOW TO",
    "SPEND",
    "A",
    "TRILLION",
    "DOLLARS",
    "ROWAN",
    "HOOPER",
    "P"
  `;

  try {
    // Prepare Bedrock request
    const prompt = BEDROCK_PROMPT.replace("{TEXT}", extractedText);

    const bedrockRequest = {
      modelId: "anthropic.claude-3-haiku-20240307-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    };

    // Call Bedrock
    const response = await bedrockClient.send(
      new InvokeModelCommand(bedrockRequest)
    );

    if (!response.body) {
      throw new Error("No response body from Bedrock");
    }

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    console.log("Bedrock response:", responseBody.content[0].text);

    await fs.writeFile("out.json", responseBody.content[0].text, "utf-8");
  } catch (e) {
    //
    //
  }
}
