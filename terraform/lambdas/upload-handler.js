const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const sqs = new SQSClient({ region: 'ap-southeast-2' });

exports.handler = async (event) => {
    console.log('Upload Handler triggered:', JSON.stringify(event, null, 2));
    
    // Extract S3 event details
    for (const record of event.Records) {
        if (record.eventName.startsWith('ObjectCreated')) {
            const bucket = record.s3.bucket.name;
            const key = record.s3.object.key;
            
            console.log(`New upload: ${key} in bucket ${bucket}`);
            
            // Send message to Textract queue
            const queueUrl = process.env.TEXTRACT_QUEUE_URL;
            
            const message = {
                bucket: bucket,
                key: key,
                jobId: `job-${Date.now()}`,
                timestamp: new Date().toISOString()
            };
            
            await sqs.send(new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify(message)
            }));
            
            console.log(`Sent to Textract queue: ${JSON.stringify(message)}`);
        }
    }
    
    return { statusCode: 200, body: 'Upload processed' };
};