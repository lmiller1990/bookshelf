#!/usr/bin/env node

import { S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';
import { readFileSync } from 'fs';
import path from 'path';

const BUCKET_NAME = 'bookimg-uat-book-detect';
const s3Client = new S3Client({ region: 'ap-southeast-2' });
const textractClient = new TextractClient({ region: 'ap-southeast-2' });

async function ensureBucketExists() {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
    console.log(`✅ Bucket ${BUCKET_NAME} exists`);
  } catch (error) {
    if (error.name === 'NotFound') {
      console.log(`📦 Creating bucket ${BUCKET_NAME}...`);
      await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
      console.log(`✅ Bucket ${BUCKET_NAME} created`);
    } else {
      throw error;
    }
  }
}

async function uploadImage(imagePath, sessionDir) {
  const imageBuffer = readFileSync(imagePath);
  const fileName = path.basename(imagePath);
  const s3Key = `${sessionDir}/${fileName}`;
  
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    Body: imageBuffer,
    ContentType: 'image/jpeg'
  }));
  
  console.log(`📤 Uploaded ${fileName} to s3://${BUCKET_NAME}/${s3Key}`);
  return s3Key;
}

async function extractText(s3Key) {
  const command = new DetectDocumentTextCommand({
    Document: {
      S3Object: {
        Bucket: BUCKET_NAME,
        Name: s3Key
      }
    }
  });
  
  console.log(`🔍 Running Textract on ${s3Key}...`);
  const response = await textractClient.send(command);
  
  const extractedText = response.Blocks
    ?.filter(block => block.BlockType === 'LINE')
    ?.map(block => block.Text)
    ?.join('\n') || '';
    
  console.log(`✅ Extracted ${response.Blocks?.length || 0} text blocks`);
  return extractedText;
}

async function saveResults(sessionDir, extractedText) {
  const resultsKey = `${sessionDir}/extracted-text.txt`;
  
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: resultsKey,
    Body: extractedText,
    ContentType: 'text/plain'
  }));
  
  console.log(`💾 Saved results to s3://${BUCKET_NAME}/${resultsKey}`);
}

async function main() {
  const imagePath = process.argv[2];
  
  if (!imagePath) {
    console.error('Usage: node index.js <image-path>');
    process.exit(1);
  }
  
  try {
    const imageName = path.basename(imagePath, path.extname(imagePath));
    const timestamp = Date.now();
    const sessionDir = `${imageName}-${timestamp}`;
    
    console.log(`🚀 Starting extraction for ${imagePath}`);
    console.log(`📁 Session: ${sessionDir}`);
    
    await ensureBucketExists();
    const s3Key = await uploadImage(imagePath, sessionDir);
    const extractedText = await extractText(s3Key);
    await saveResults(sessionDir, extractedText);
    
    console.log('\n📋 Extracted Text Preview:');
    console.log('---');
    console.log(extractedText.substring(0, 500) + (extractedText.length > 500 ? '...' : ''));
    console.log('---');
    console.log(`\n✅ Complete! Results saved in s3://${BUCKET_NAME}/${sessionDir}/`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();