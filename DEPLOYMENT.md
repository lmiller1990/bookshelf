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
   - npm (for Lambda packaging)
   - pnpm (for main project development)

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
- Lambda functions with proper IAM roles
- API Gateway HTTP API with web interface
- SNS topic for notifications

### 3. Verify Deployment

```bash
# Check all resources are created
terraform output

# Test the web interface
curl https://$(terraform output -raw web_api_url)

# Should return HTML page with BookImg interface
```

## Lambda Function Deployment

### Understanding Lambda Packaging

AWS Lambda requires all dependencies to be packaged with your function code. The key challenge is ensuring all Node.js modules can be resolved in the Lambda runtime environment.

#### Why pnpm Doesn't Work for Lambda

pnpm uses a unique dependency management strategy that creates symlinked structures:

```
node_modules/
├── .pnpm/
│   ├── fastify@5.5.0/node_modules/
│   │   ├── fastify -> ../../../fastify@5.5.0/node_modules/fastify
│   │   └── avvio -> ../../../avvio@9.1.0/node_modules/avvio
│   ├── avvio@9.1.0/node_modules/
│   │   └── avvio/
│   └── ...
├── fastify -> .pnpm/fastify@5.5.0/node_modules/fastify
└── avvio -> .pnpm/avvio@9.1.0/node_modules/avvio  # Symlinks don't work in Lambda
```

**Problem**: Lambda runtime cannot resolve symlinked dependencies in the `.pnpm` directory structure.

#### npm Provides Flat Structure

npm creates a flattened dependency structure that Lambda can resolve:

```
node_modules/
├── fastify/
├── avvio/           # Direct access - Lambda compatible
├── @fastify/
│   └── aws-lambda/
└── ...
```

### Lambda Packaging Process

#### 1. Web Lambda Packaging

The web Lambda (Fastify + htmx interface) requires careful dependency management:

```bash
# Navigate to Terraform directory
cd terraform

# Create Lambda package directory
mkdir -p lambda-web-dist
cp lambda-web.js lambda-web-dist/

# Create package.json with required dependencies
cat > lambda-web-dist/package.json << 'EOF'
{
  "name": "lambda-web",
  "version": "1.0.0",
  "main": "lambda-web.js",
  "dependencies": {
    "fastify": "^5.5.0",
    "@fastify/aws-lambda": "^6.1.1",
    "@aws-sdk/client-s3": "^3.879.0",
    "@aws-sdk/s3-request-presigner": "^3.879.0"
  }
}
EOF

# Install dependencies with npm (not pnpm!)
cd lambda-web-dist
npm install --omit=dev

# Verify all modules are accessible
ls node_modules/       # Should show fastify, avvio, etc.
node -e "require('fastify')"  # Should not throw errors
```

#### 2. Other Lambda Functions

Processing Lambda functions (upload-handler, textract-processor, etc.) are single-file JavaScript modules with AWS SDK dependencies. These are simpler to package:

```bash
# These are automatically packaged by Terraform
# No manual dependency management needed
```

#### 3. Terraform Archive Configuration

Terraform handles Lambda deployment via `archive_file` data source:

```terraform
# Web Lambda (with dependencies)
data "archive_file" "web_lambda" {
  type        = "zip"
  source_dir  = "lambda-web-dist"  # Directory with npm node_modules
  output_path = "web_lambda.zip"
}

# Simple Lambda functions (single file)
data "archive_file" "upload_handler" {
  type        = "zip"
  source_file = "lambdas/upload-handler.js"  # Single JavaScript file
  output_path = "upload_handler.zip"
}
```

### Deployment Workflow

#### Full Deployment

```bash
# 1. Update Lambda code (if changed)
# Edit lambda-web.js, lambdas/upload-handler.js, etc.

# 2. Update web Lambda dependencies (if package.json changed)
cd terraform/lambda-web-dist
rm -rf node_modules package-lock.json
npm install --omit=dev
cd ..

# 3. Deploy via Terraform
AWS_PROFILE=bookimg-deployer terraform apply

# Terraform will:
# - Detect code changes via source_code_hash
# - Rebuild zip files automatically
# - Update Lambda functions
# - Maintain all other resources
```

#### Quick Lambda-only Update

```bash
# For development iterations, update just the Lambda functions
terraform apply -target=aws_lambda_function.web_lambda
terraform apply -target=aws_lambda_function.upload_handler
# etc.
```

## Deployment Verification

### 1. Infrastructure Health Check

```bash
# Check all AWS resources exist
terraform show | grep "resource\s*\"aws_"

# Verify S3 buckets
aws s3 ls | grep bookimg-uat

# Check Lambda functions
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `bookimg-uat`)]'

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

# Monitor processing via CloudWatch logs
aws logs tail /aws/lambda/bookimg-uat-upload-handler --follow &
aws logs tail /aws/lambda/bookimg-uat-textract-processor --follow &
aws logs tail /aws/lambda/bookimg-uat-bedrock-processor --follow &
aws logs tail /aws/lambda/bookimg-uat-book-validator --follow &

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

#### 2. Lambda Packaging Errors

**Symptom**: `Error: Cannot find module` in Lambda logs

**Diagnosis**:
```bash
# Check Lambda package contents
unzip -l terraform/web_lambda.zip | head -20

# Verify dependencies are included
unzip -l terraform/web_lambda.zip | grep node_modules

# Test module resolution locally
cd terraform/lambda-web-dist
node -e "require('fastify'); console.log('OK')"
```

**Solution**: Rebuild Lambda package with npm:
```bash
cd terraform/lambda-web-dist
rm -rf node_modules package-lock.json
npm install --omit=dev
cd .. && terraform apply
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
          
      - name: Package Lambda dependencies
        run: |
          cd terraform/lambda-web-dist
          npm ci --omit=dev
          
      - name: Deploy infrastructure
        run: |
          cd terraform
          terraform init
          terraform apply -auto-approve
          
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