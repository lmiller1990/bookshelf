import type { SQSEvent } from "aws-lambda";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { PublishCommand } from "@aws-sdk/client-sns";
import {
  s3Client,
  snsClient,
  getResultsBucket,
  getSNSTopicArn,
  type BedrockMessage,
  type BookCandidate,
  type ValidationResult,
  type ValidatedBook,
  type FinalResults,
  type ProcessingStageMessage,
} from "@packages/shared";

// Google Books API validation with API key
async function validateWithGoogleBooks(
  title: string,
  author: string,
): Promise<ValidationResult> {
  try {
    const query = encodeURIComponent(`${title}+${author}`);
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    const url = apiKey
      ? `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1&key=${apiKey}`
      : `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`;

    const response = await fetch(url);
    console.log(url);
    const data = (await response.json()) as any; // TODO type

    if (data.items && data.items.length > 0) {
      const book = data.items[0].volumeInfo;
      return {
        validated: true,
        title: book.title,
        authors: book.authors,
        isbn: book.industryIdentifiers?.[0]?.identifier,
        publishedDate: book.publishedDate,
        publisher: book.publisher,
        thumbnail: book.imageLinks?.thumbnail,
      };
    }

    return { validated: false };
  } catch (error) {
    console.error("Google Books validation error:", error);
    return { validated: false, error: (error as Error).message };
  }
}

export const handler = async (event: SQSEvent) => {
  console.log("Book Validator triggered:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const message: BedrockMessage = JSON.parse(record.body);
    const { jobId, candidates } = message;

    if (!candidates || candidates.length === 0) {
      console.error(`No candidates found for job: ${jobId}`);
      continue;
    }

    console.log(`Validating ${candidates.length} candidates for job: ${jobId}`);

    try {
      // Send start notification
      const startMessage: ProcessingStageMessage = {
        jobId,
        stage: "validation",
        status: "started",
        timestamp: new Date().toISOString(),
        details: {
          candidatesCount: candidates.length,
        },
      };

      await snsClient.send(
        new PublishCommand({
          TopicArn: getSNSTopicArn(),
          Subject: `Validation Processing Started - Job ${jobId}`,
          Message: JSON.stringify(startMessage),
        }),
      );

      console.log(`Published validation start notification for job: ${jobId}`);

      const validatedBooks: ValidatedBook[] = [];

      // Validate each candidate
      for (const candidate of candidates) {
        console.log(`Validating: "${candidate.title}" by ${candidate.author}`);

        const validation = await validateWithGoogleBooks(
          candidate.title,
          candidate.author,
        );

        if (validation.validated) {
          validatedBooks.push({
            ...candidate,
            validation: validation,
            status: "validated",
          });
        } else {
          validatedBooks.push({
            ...candidate,
            validation: validation,
            status: "unvalidated",
          });
        }
      }

      const finalResults: FinalResults = {
        jobId: jobId,
        timestamp: new Date().toISOString(),
        totalCandidates: candidates.length,
        validatedCount: validatedBooks.filter((b) => b.status === "validated")
          .length,
        books: validatedBooks,
      };

      console.log(
        `Validation complete: ${finalResults.validatedCount}/${
          finalResults.totalCandidates
        } books validated. Those are ${JSON.stringify(validatedBooks, null, 4)}`,
      );

      // Store final results
      const resultsBucket = getResultsBucket();
      await s3Client.send(
        new PutObjectCommand({
          Bucket: resultsBucket,
          Key: `${jobId}/final-results.json`,
          Body: JSON.stringify(finalResults, null, 2),
          ContentType: "application/json",
        }),
      );

      // Publish completion notification
      await snsClient.send(
        new PublishCommand({
          TopicArn: getSNSTopicArn(),
          Subject: `BookImg Processing Complete - Job ${jobId}`,
          Message: JSON.stringify(
            {
              jobId: jobId,
              status: "complete",
              validatedBooks: finalResults.validatedCount,
              totalCandidates: finalResults.totalCandidates,
              books: validatedBooks,
              resultsLocation: `s3://${resultsBucket}/${jobId}/final-results.json`,
            },
            null,
            2,
          ),
        }),
      );

      console.log(`Published completion notification for job: ${jobId}`);
    } catch (error) {
      console.error(`Error validating books for job ${jobId}:`, error);
      throw error;
    }
  }

  return { statusCode: 200, body: "Book validation complete" };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const candidates = [
    {
      title: "TRANSFORMER",
      author: "NICK LANE",
      subtitle: null,
      confidence: 0.9,
    },
    {
      title: "Numbers Don't Lie",
      author: "Vaclav Smil",
      subtitle: null,
      confidence: 0.8,
    },
    {
      title: "THE POSSIBILITY OF LIFE",
      author: "JAIME DUCKWORTH FALKOWSKI",
      subtitle: null,
      confidence: 0.9,
    },
    {
      title: "LIFE'S ENGINES",
      author: null,
      subtitle: null,
      confidence: 0.7,
    },
    {
      title: "FOLLOW YOUR GUT",
      author: "Barr Crocetti Wild Stinson Hutchings",
      subtitle: null,
      confidence: 0.8,
    },
    {
      title:
        "The truth, the lies and the unbelievable story of the original superfood",
      author: "Matthew Evans",
      subtitle: null,
      confidence: 0.9,
    },
    {
      title: "THE BITCOIN STANDARD",
      author: "AMMOUS",
      subtitle: null,
      confidence: 0.9,
    },
    {
      title: "50 mathematical ideas you really need to know",
      author: "Tony Crilly",
      subtitle: null,
      confidence: 0.8,
    },
    {
      title: "FROM BACTERIA TO BACH AND BACK",
      author: "DANIEL C. DENNETT",
      subtitle: null,
      confidence: 0.9,
    },
    {
      title: "THE GENETIC LOTTERY FOR SOCIAL EQUALITY",
      author: "HARDEN",
      subtitle: null,
      confidence: 0.8,
    },
    {
      title: "Rebel Cell",
      author: "ARNEY",
      subtitle: "Cancer, Evolution and the Science of Life",
      confidence: 0.9,
    },
    {
      title: "UNWELL",
      author: "MIKE McRAE",
      subtitle: null,
      confidence: 0.8,
    },
    {
      title: "HOW TO SPEND A TRILLION DOLLARS",
      author: "ROWAN HOOPER",
      subtitle: null,
      confidence: 0.9,
    },
  ];

  for (const can of candidates) {
    const res = await validateWithGoogleBooks(can.title, can.author ?? "");
    console.log(res);
  }
}
