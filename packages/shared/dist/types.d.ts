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
//# sourceMappingURL=types.d.ts.map