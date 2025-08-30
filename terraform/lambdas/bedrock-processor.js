const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const bedrock = new BedrockRuntimeClient({ region: 'ap-southeast-2' });
const s3 = new S3Client({ region: 'ap-southeast-2' });
const sqs = new SQSClient({ region: 'ap-southeast-2' });

const BEDROCK_PROMPT = `You are an expert at analyzing OCR text from book spines and extracting clean title/author information.

The input text comes from book spine OCR and may be fragmented, rotated, or contain partial words. Your task is to identify complete book titles and authors with high confidence.

Rules:
1. Only extract complete, recognizable book titles and authors
2. Skip partial fragments, publisher names, or non-book text
3. Match fragments that clearly belong to the same book
4. Provide confidence scores (0.0 to 1.0)
5. Return valid JSON only

Input OCR text:
{TEXT}

Return JSON in this exact format:
{
  "candidates": [
    {
      "title": "Complete Book Title",
      "author": "Author Name", 
      "confidence": 0.95
    }
  ]
}`;

exports.handler = async (event) => {
    console.log('Bedrock Processor triggered:', JSON.stringify(event, null, 2));
    
    for (const record of event.Records) {
        const message = JSON.parse(record.body);
        const { jobId, extractedText } = message;
        
        console.log(`Processing text for job: ${jobId}`);
        console.log(`Text preview: ${extractedText.substring(0, 200)}...`);
        
        try {
            // Prepare Bedrock request
            const prompt = BEDROCK_PROMPT.replace('{TEXT}', extractedText);
            
            const bedrockRequest = {
                modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify({
                    anthropic_version: 'bedrock-2023-05-31',
                    max_tokens: 1000,
                    messages: [
                        {
                            role: 'user',
                            content: prompt
                        }
                    ]
                })
            };
            
            // Call Bedrock
            const response = await bedrock.send(new InvokeModelCommand(bedrockRequest));
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));
            
            console.log('Bedrock response:', JSON.stringify(responseBody, null, 2));
            
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
                console.error('Error parsing Bedrock response:', parseError);
                candidates = [];
            }
            
            console.log(`Extracted ${candidates.length} book candidates`);
            
            // Store candidates in results bucket
            const resultsBucket = process.env.RESULTS_BUCKET_NAME;
            await s3.send(new PutObjectCommand({
                Bucket: resultsBucket,
                Key: `${jobId}/candidates.json`,
                Body: JSON.stringify({ candidates }, null, 2),
                ContentType: 'application/json'
            }));
            
            // Send to validation queue
            const validationMessage = {
                ...message,
                candidates: candidates,
                bedrockComplete: true
            };
            
            await sqs.send(new SendMessageCommand({
                QueueUrl: process.env.VALIDATION_QUEUE_URL,
                MessageBody: JSON.stringify(validationMessage)
            }));
            
            console.log(`Sent to validation queue for job: ${jobId}`);
            
        } catch (error) {
            console.error(`Error processing Bedrock for job ${jobId}:`, error);
            throw error;
        }
    }
    
    return { statusCode: 200, body: 'Bedrock processing complete' };
};