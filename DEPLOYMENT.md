# BookImg Deployment Guide

## Overview

This document provides comprehensive deployment guidance for the BookImg AI book recognition pipeline, covering infrastructure deployment, Lambda function packaging, and troubleshooting.

## Prerequisites

### AWS Setup
1. **AWS CLI configured** with appropriate profiles:
   - `bookimg-deployer` - For Terraform deployments (administrator access)
   - `bookimg-app` - For application runtime (minimal permissions)

2. **Terraform installed** (version >= 1.0)

3. **Node.js and package managers**:
   - Node.js 20.x (matches Lambda runtime)
   - npm (for TypeScript monorepo and Lambda packaging)

### Modern TypeScript Monorepo Architecture
BookImg now uses a modern monorepo structure with:
- **TypeScript ESM modules** for all Lambda functions
- **Automatic build system** integrated with Terraform
- **Shared utilities** and types across all packages
- **99% bundle size reduction** (from ~5MB to ~2-5KB per Lambda)

### AWS Account Setup
Complete the AWS setup following `TERRAFORM.md` including:
- Bootstrap Terraform state bucket
- IAM users and roles configuration
- AWS profile configuration

## Infrastructure Deployment

### 1. Bootstrap Deployment (One-time setup)

```bash
cd terraform/bootstrap
AWS_PROFILE=bookimg-deployer terraform init
AWS_PROFILE=bookimg-deployer terraform plan
AWS_PROFILE=bookimg-deployer terraform apply
```

This creates:
- Terraform state S3 bucket with versioning and encryption
- Basic IAM setup for deployments

### 2. Main Infrastructure Deployment

```bash
cd terraform
AWS_PROFILE=bookimg-deployer terraform init
AWS_PROFILE=bookimg-deployer terraform plan
AWS_PROFILE=bookimg-deployer terraform apply
```

This creates:
- S3 buckets for uploads and results
- SQS queues with dead letter queues
- **5 TypeScript Lambda functions** (automatically built from source)
- API Gateway HTTP API with web interface
- WebSocket API for real-time notifications
- SNS topic for processing completion notifications
- DynamoDB table for WebSocket connections

### ✨ Automatic Build System
Terraform now automatically:
- **Detects TypeScript source changes** via file hashing
- **Builds Lambda functions** using esbuild when needed
- **Packages optimized bundles** (1.8-4.6KB each)
- **Deploys updated functions** with zero manual steps

### 3. Verify Deployment

```bash
# Check all resources are created
terraform output

# Test the web interface
curl https://$(terraform output -raw web_api_url)

# Should return HTML page with BookImg interface
```

## Modern Lambda Deployment Architecture

### TypeScript Monorepo Structure

BookImg now uses a modern monorepo with 5 TypeScript Lambda packages:

```
packages/
├── shared/                      # Common types and AWS clients
├── textract-processor/          # OCR text extraction (4.2KB bundle)
├── bedrock-processor/           # AI book parsing (4.3KB bundle)
├── book-validator/              # External API validation (4.6KB bundle)
├── upload-handler/              # S3 event processing (1.8KB bundle)
├── websocket-connection-manager/# WebSocket handling (3.5KB bundle)
└── sns-notification-handler/    # Real-time notifications (3.8KB bundle)
```

### Automatic Build System

Terraform automatically handles the entire build and deployment process:

```hcl
# 1. Monitor source files for changes
data "archive_file" "bedrock_processor_src" {
  source_dir = "../packages/bedrock-processor/src"
  output_path = "/tmp/bedrock_processor_src.zip"
}

# 2. Trigger build when source changes  
resource "null_resource" "build_bedrock_processor" {
  triggers = {
    src_hash = data.archive_file.bedrock_processor_src.output_base64sha256
  }
  
  provisioner "local-exec" {
    command = "cd ../packages/bedrock-processor && npm run build"
  }
}

# 3. Package optimized bundle
data "archive_file" "bedrock_processor" {
  source_dir = "../packages/bedrock-processor/dist"
  depends_on = [null_resource.build_bedrock_processor]
}
```

### Build Process Details

Each Lambda package uses **esbuild** for optimized bundling:

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --target=node18 --format=esm --outfile=dist/index.js --external:@aws-sdk/* --external:aws-lambda && echo '{\"type\":\"module\"}' > dist/package.json"
  }
}
```

**Key optimizations:**
- **Tree shaking**: Only code actually used is included
- **External AWS SDK**: AWS Lambda runtime provides SDK (~4MB excluded)
- **ESM modules**: Modern JavaScript for better performance
- **TypeScript compilation**: Full type safety with zero runtime overhead

### Deployment Workflow

#### Zero-Manual-Step Deployment

```bash
# 1. Edit any TypeScript source file
vim packages/bedrock-processor/src/index.ts

# 2. Deploy everything automatically
cd terraform
AWS_PROFILE=bookimg-deployer terraform apply

# Terraform automatically:
# ✅ Detects source file changes
# ✅ Runs TypeScript build for changed packages
# ✅ Creates optimized bundles (1.8-4.6KB each)
# ✅ Updates Lambda functions with new code
# ✅ Maintains all other infrastructure
```

#### Development Workflow

```bash
# Target specific Lambda for faster iteration
terraform apply -target=aws_lambda_function.bedrock_processor

# Or target just the build + deploy chain
terraform apply -target=null_resource.build_bedrock_processor -target=aws_lambda_function.bedrock_processor
```

### Bundle Size Comparison

| Lambda Function | Before (CommonJS) | After (TypeScript ESM) | Reduction |
|----------------|------------------|----------------------|-----------|
| textract-processor | ~5MB | 4.2KB | 99.9% |
| bedrock-processor | ~5MB | 4.3KB | 99.9% |
| book-validator | ~5MB | 4.6KB | 99.9% |
| upload-handler | ~5MB | 1.8KB | 99.96% |
| websocket-connection-manager | ~5MB | 3.5KB | 99.9% |
| sns-notification-handler | ~5MB | 3.8KB | 99.9% |

**Benefits:**
- ⚡ **Faster cold starts** (less code to load)
- 💰 **Lower costs** (reduced storage and compute)
- 🚀 **Better performance** (optimized bundles)
- 🛡️ **Type safety** (compile-time error detection)

### Development Workflow

#### Local Development Setup

```bash
# Install all dependencies (root and packages)
npm install

# Build shared utilities first (required by all Lambdas)
cd packages/shared && npm run build

# Build all Lambda packages
cd packages/textract-processor && npm run build
cd packages/bedrock-processor && npm run build
cd packages/book-validator && npm run build
cd packages/upload-handler && npm run build
cd packages/websocket-connection-manager && npm run build  
cd packages/sns-notification-handler && npm run build
```

#### Making Changes

```bash
# 1. Edit TypeScript source files
vim packages/bedrock-processor/src/index.ts

# 2. Update shared types if needed
vim packages/shared/src/types.ts
cd packages/shared && npm run build  # Rebuild shared

# 3. Test build locally
cd packages/bedrock-processor && npm run build

# 4. Deploy automatically via Terraform
cd terraform && terraform apply
# ✨ Terraform detects changes and rebuilds automatically
```

#### Adding New Dependencies

```bash
# Add to specific Lambda package
cd packages/bedrock-processor
npm install new-dependency

# Add to shared utilities
cd packages/shared  
npm install @aws-sdk/client-new-service
npm run build

# Update external dependencies in build script
vim packages/bedrock-processor/package.json
# Add --external:new-dependency to build command if it's runtime-provided
```

## Deployment Verification

### 1. Infrastructure Health Check

```bash
# Check all AWS resources exist
terraform show | grep "resource\s*\"aws_"

# Verify S3 buckets
aws s3 ls | grep bookimg-uat

# Check Lambda functions (should show 6 functions)
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `bookimg-uat`)].FunctionName'
# Expected: textract-processor, bedrock-processor, book-validator, 
#           upload-handler, websocket-connection-manager, sns-notification-handler

# Verify SQS queues
aws sqs list-queues --query 'QueueUrls[?contains(@, `bookimg-uat`)]'
```

### 2. Web Interface Testing

```bash
# Test web interface loads
WEB_URL=$(terraform output -raw web_api_url)
curl -s "$WEB_URL" | grep "BookImg - AI Book Recognition"

# Test health endpoint
curl -s "$WEB_URL/health"
# Expected: {"status":"ok","timestamp":"..."}
```

### 3. End-to-End Pipeline Test

```bash
# Upload test image to trigger pipeline
aws s3 cp your-test-image.jpg s3://bookimg-uat/test-$(date +%s).jpg

# Monitor complete processing pipeline via CloudWatch logs
aws logs tail /aws/lambda/bookimg-uat-upload-handler --follow &
aws logs tail /aws/lambda/bookimg-uat-textract-processor --follow &
aws logs tail /aws/lambda/bookimg-uat-bedrock-processor --follow &  
aws logs tail /aws/lambda/bookimg-uat-book-validator --follow &
aws logs tail /aws/lambda/bookimg-uat-sns-notification-handler --follow &

# Check for results in S3 after ~30-60 seconds
aws s3 ls s3://bookimg-uat-results/ --recursive
```

## Troubleshooting

### Common Deployment Issues

#### 1. Terraform State Lock

**Symptom**: `Error: Error locking state`

**Solution**:
```bash
# Force unlock (use carefully!)
terraform force-unlock LOCK_ID

# Or wait for lock to expire (typically 10-15 minutes)
```

#### 2. TypeScript Build Errors

**Symptom**: `Error: Build failed` or TypeScript compilation errors

**Diagnosis**:
```bash
# Test build locally
cd packages/bedrock-processor
npm run build

# Check for TypeScript errors
npx tsc --noEmit

# Verify shared package is built
cd packages/shared && npm run build
```

**Solution**: Fix TypeScript errors and rebuild:
```bash
# Rebuild shared utilities first
cd packages/shared && npm run build

# Then rebuild the specific Lambda
cd packages/bedrock-processor && npm run build

# Deploy with Terraform
cd terraform && terraform apply
```

#### 3. Lambda Runtime Errors

**Symptom**: `Error: Cannot find module` in Lambda logs with TypeScript packages

**Diagnosis**:
```bash
# Check Lambda package contents
unzip -l terraform/bedrock_processor.zip

# Verify ESM module structure
unzip -q terraform/bedrock_processor.zip -d /tmp/lambda-check
cat /tmp/lambda-check/package.json
cat /tmp/lambda-check/index.js | head -10
```

**Solution**: Verify build configuration and external dependencies:
```bash
# Ensure AWS SDK is marked as external
grep -r "external.*aws-sdk" packages/*/package.json

# Rebuild and redeploy
cd packages/bedrock-processor && npm run clean && npm run build
cd terraform && terraform apply
```

#### 3. API Gateway 404 Errors

**Symptom**: `{"message":"Not Found"}` when accessing web interface

**Diagnosis**:
```bash
# Check API Gateway configuration
aws apigatewayv2 get-api --api-id $(terraform output web_api_url | cut -d'/' -f3 | cut -d'.' -f1)

# Verify routes exist
aws apigatewayv2 get-routes --api-id API_ID

# Check stage deployment
aws apigatewayv2 get-stages --api-id API_ID
```

**Solution**: Ensure using correct URL with stage:
```bash
# Wrong: https://api-id.execute-api.region.amazonaws.com
# Correct: https://api-id.execute-api.region.amazonaws.com/UAT
echo $(terraform output -raw web_api_url)
```

#### 4. S3 Permissions Issues

**Symptom**: Lambda cannot read/write S3 objects

**Diagnosis**:
```bash
# Check Lambda execution role permissions
aws iam get-role-policy --role-name bookimg-uat-lambda-execution-role --policy-name lambda-service-policy

# Test S3 access manually
aws s3 ls s3://bookimg-uat/ --profile bookimg-app
```

**Solution**: Verify IAM policies in Terraform match required S3 operations.

### Performance Troubleshooting

#### 1. Lambda Cold Starts

**Symptom**: First requests to API Gateway take 5-10 seconds

**Solutions**:
- Increase Lambda memory allocation (more CPU allocated proportionally)
- Consider Lambda provisioned concurrency for consistent performance
- Optimize Lambda package size by removing unnecessary dependencies

#### 2. Processing Pipeline Backlog

**Symptom**: Images uploaded but not processed quickly

**Diagnosis**:
```bash
# Check SQS queue depths
aws sqs get-queue-attributes \
  --queue-url $(terraform output -raw textract_queue_url) \
  --attribute-names ApproximateNumberOfMessages

# Check dead letter queues
aws sqs get-queue-attributes \
  --queue-url $(terraform output -raw textract_queue_url)-dlq \
  --attribute-names ApproximateNumberOfMessages
```

**Solutions**:
- Increase Lambda timeout for processing stages
- Check CloudWatch logs for errors causing retries
- Increase Lambda memory for faster processing

## Environment Management

### Development vs Production

#### Environment Variables
Configure different environments via Terraform variables:

```bash
# Development deployment
terraform apply -var="environment=DEV"

# Production deployment  
terraform apply -var="environment=PROD"
```

This creates separate resources:
- `bookimg-dev-*` vs `bookimg-prod-*`
- Separate S3 buckets, queues, Lambda functions
- Independent API Gateway endpoints

#### Resource Isolation
Each environment has completely isolated:
- AWS resources (no sharing)
- Terraform state files
- IAM roles and permissions
- API endpoints

### Configuration Management

#### Terraform Variables
Key variables for environment customization:

```terraform
variable "environment" {
  description = "Environment name (DEV, UAT, PROD)"
  type        = string
  default     = "UAT"
}

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "ap-southeast-2"
}
```

#### Environment-Specific Configuration
Create environment-specific `.tfvars` files:

```bash
# environments/dev.tfvars
environment = "DEV"
lambda_timeout = 30
lambda_memory = 128

# environments/prod.tfvars  
environment = "PROD"
lambda_timeout = 300
lambda_memory = 512
```

Deploy with:
```bash
terraform apply -var-file=environments/prod.tfvars
```

## CI/CD Integration

### GitHub Actions Workflow Example

```yaml
name: Deploy BookImg
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v2
        
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-southeast-2
          
      - name: Setup monorepo dependencies
        run: |
          npm install
          
      - name: Build shared utilities
        run: |
          cd packages/shared
          npm run build
          
      - name: Deploy infrastructure (with automatic TypeScript builds)
        run: |
          cd terraform
          terraform init
          terraform apply -auto-approve
          # Terraform automatically builds all TypeScript packages as needed
          
      - name: Test deployment
        run: |
          WEB_URL=$(cd terraform && terraform output -raw web_api_url)
          curl -f "$WEB_URL/health"
```

## Monitoring and Maintenance

### CloudWatch Monitoring

#### Key Metrics to Monitor
- Lambda function duration and error rates
- SQS queue depth and message age
- API Gateway request counts and latency
- S3 storage usage and request patterns

#### Useful CloudWatch Queries
```bash
# Lambda errors in last 24 hours
aws logs filter-log-events \
  --log-group-name "/aws/lambda/bookimg-uat-web" \
  --start-time $(date -d '24 hours ago' +%s)000 \
  --filter-pattern "ERROR"

# API Gateway access patterns
aws logs filter-log-events \
  --log-group-name "/aws/apigateway/bookimg-uat-web-api" \
  --start-time $(date -d '1 hour ago' +%s)000
```

### Regular Maintenance

#### Monthly Tasks
- Review CloudWatch costs and optimize unused resources
- Check dead letter queues for failed messages
- Update Lambda runtime versions if AWS deprecates current version
- Review and rotate IAM access keys

#### Quarterly Tasks
- Update all dependencies in Lambda functions
- Review and optimize Lambda memory/timeout settings
- Analyze usage patterns and optimize infrastructure costs
- Update documentation with any configuration changes

## Cost Optimization

### AWS Cost Monitoring

#### Key Cost Drivers
1. **Lambda invocations and duration** (typically largest cost)
2. **S3 storage and requests** (grows over time)
3. **API Gateway requests** (scales with usage)
4. **CloudWatch logs storage** (can grow large)

#### Cost Optimization Strategies

```bash
# Set up S3 lifecycle policies to delete old uploads
aws s3api put-bucket-lifecycle-configuration \
  --bucket bookimg-uat \
  --lifecycle-configuration file://lifecycle-policy.json

# Monitor Lambda costs
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE
```

#### Resource Right-sizing
- **Lambda Memory**: Start with 128MB, increase only if needed for performance
- **Lambda Timeout**: Use minimum required (30s for web, 300s for processing)
- **SQS Retention**: Default 4 days sufficient for most use cases
- **CloudWatch Log Retention**: Set to 30 days for cost savings

This deployment guide provides comprehensive coverage of the deployment process, common issues, and ongoing maintenance practices for the BookImg pipeline.