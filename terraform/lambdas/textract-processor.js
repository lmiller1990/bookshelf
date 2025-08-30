const { TextractClient, DetectDocumentTextCommand } = require('@aws-sdk/client-textract');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const textract = new TextractClient({ region: 'ap-southeast-2' });
const s3 = new S3Client({ region: 'ap-southeast-2' });
const sqs = new SQSClient({ region: 'ap-southeast-2' });

exports.handler = async (event) => {
    console.log('Textract Processor triggered:', JSON.stringify(event, null, 2));
    
    for (const record of event.Records) {
        const message = JSON.parse(record.body);
        const { bucket, key, jobId } = message;
        
        console.log(`Processing image: ${key} from bucket: ${bucket}`);
        
        try {
            // Call Textract
            const textractResponse = await textract.send(new DetectDocumentTextCommand({
                Document: {
                    S3Object: {
                        Bucket: bucket,
                        Name: key
                    }
                }
            }));
            
            // Extract text from response
            const extractedText = textractResponse.Blocks
                ?.filter(block => block.BlockType === 'LINE')
                .map(block => block.Text)
                .join('\n') || '';
            
            console.log(`Extracted text length: ${extractedText.length} characters`);
            
            // Store raw text in results bucket
            const resultsBucket = process.env.RESULTS_BUCKET_NAME;
            await s3.send(new PutObjectCommand({
                Bucket: resultsBucket,
                Key: `${jobId}/extracted-text.txt`,
                Body: extractedText,
                ContentType: 'text/plain'
            }));
            
            // Send to Bedrock queue
            const bedrockMessage = {
                ...message,
                extractedText: extractedText,
                textractComplete: true
            };
            
            await sqs.send(new SendMessageCommand({
                QueueUrl: process.env.BEDROCK_QUEUE_URL,
                MessageBody: JSON.stringify(bedrockMessage)
            }));
            
            console.log(`Sent to Bedrock queue for job: ${jobId}`);
            
        } catch (error) {
            console.error(`Error processing ${key}:`, error);
            throw error;
        }
    }
    
    return { statusCode: 200, body: 'Textract processing complete' };
};