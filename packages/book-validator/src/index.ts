import { SQSEvent } from 'aws-lambda';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { PublishCommand } from '@aws-sdk/client-sns';
import { 
  s3Client, 
  snsClient, 
  getResultsBucket, 
  getSNSTopicArn,
  BedrockMessage,
  BookCandidate,
  ValidationResult,
  ValidatedBook,
  FinalResults 
} from '@bookimg/shared';

// Google Books API validation with API key
async function validateWithGoogleBooks(title: string, author: string): Promise<ValidationResult> {
  try {
    const query = encodeURIComponent(`"${title}" "${author}"`);
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    const url = apiKey
      ? `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1&key=${apiKey}`
      : `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`;

    const response = await fetch(url);
    const data = await response.json();

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
      const validatedBooks: ValidatedBook[] = [];

      // Validate each candidate
      for (const candidate of candidates) {
        console.log(`Validating: "${candidate.title}" by ${candidate.author}`);

        const validation = await validateWithGoogleBooks(
          candidate.title,
          candidate.author
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
        validatedCount: validatedBooks.filter((b) => b.status === "validated").length,
        books: validatedBooks,
      };

      console.log(
        `Validation complete: ${finalResults.validatedCount}/${
          finalResults.totalCandidates
        } books validated. Those are ${JSON.stringify(validatedBooks, null, 4)}`
      );

      // Store final results
      const resultsBucket = getResultsBucket();
      await s3Client.send(
        new PutObjectCommand({
          Bucket: resultsBucket,
          Key: `${jobId}/final-results.json`,
          Body: JSON.stringify(finalResults, null, 2),
          ContentType: "application/json",
        })
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
            2
          ),
        })
      );

      console.log(`Published completion notification for job: ${jobId}`);
    } catch (error) {
      console.error(`Error validating books for job ${jobId}:`, error);
      throw error;
    }
  }

  return { statusCode: 200, body: "Book validation complete" };
};