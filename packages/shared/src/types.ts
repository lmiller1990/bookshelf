// Common types used across Lambda functions

export interface ProcessingMessage {
  bucket: string;
  key: string;
  jobId: string;
  timestamp: string;
}

export interface TextractMessage extends ProcessingMessage {
  extractedText?: string;
  textractComplete?: boolean;
}

export interface BedrockMessage extends TextractMessage {
  candidates?: BookCandidate[];
  bedrockComplete?: boolean;
}

export interface BookCandidate {
  title: string;
  author: string;
  confidence: number;
}

export interface ValidationResult {
  validated: boolean;
  title?: string;
  authors?: string[];
  isbn?: string;
  publishedDate?: string;
  publisher?: string;
  thumbnail?: string;
  error?: string;
}

export interface ValidatedBook extends BookCandidate {
  validation: ValidationResult;
  status: 'validated' | 'unvalidated';
}

export interface FinalResults {
  jobId: string;
  timestamp: string;
  totalCandidates: number;
  validatedCount: number;
  books: ValidatedBook[];
}

// S3 Event types for upload handler
export interface S3ObjectInfo {
  key: string;
  size: number;
  eTag: string;
  sequencer: string;
}

export interface S3BucketInfo {
  name: string;
  ownerIdentity: {
    principalId: string;
  };
  arn: string;
}

export interface S3EventRecord {
  eventVersion: string;
  eventSource: string;
  eventTime: string;
  eventName: string;
  userIdentity: {
    principalId: string;
  };
  requestParameters: {
    sourceIPAddress: string;
  };
  responseElements: {
    'x-amz-request-id': string;
    'x-amz-id-2': string;
  };
  s3: {
    s3SchemaVersion: string;
    configurationId: string;
    bucket: S3BucketInfo;
    object: S3ObjectInfo;
  };
}