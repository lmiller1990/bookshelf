# Monorepo Migration Guide

This document outlines the steps to migrate the remaining Lambda functions to our new TypeScript ESM monorepo structure.

## ✅ Completed
- [x] **textract-processor** - Fully migrated and deployed successfully

## 📋 Remaining Lambdas to Migrate

### High Priority (Core Pipeline)
1. **bedrock-processor** - LLM processing with Claude 3 Haiku
2. **book-validator** - Book validation with external APIs
3. **upload-handler** - S3 upload event processing

### Medium Priority (Infrastructure)
4. **websocket-connection-manager** - WebSocket connection handling
5. **sns-notification-handler** - SNS notification processing

### Lower Priority (Web Interface)
6. **web-interface** (currently `lambda-web-dist`) - Fastify web UI

## 🏗️ Migration Pattern (Per Lambda)

### Step 1: Create Package Structure
```bash
mkdir -p packages/[lambda-name]/src
```

### Step 2: Create package.json
```json
{
  "name": "@bookimg/[lambda-name]",
  "version": "1.0.0",
  "description": "AWS Lambda for [purpose]",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --target=node18 --format=esm --outfile=dist/index.js --external:@aws-sdk/* && echo '{\"type\":\"module\"}' > dist/package.json",
    "clean": "rm -rf dist",
    "package": "npm run build && cd dist && zip -r ../[lambda-name].zip ."
  },
  "dependencies": {
    "@bookimg/shared": "1.0.0",
    "@aws-sdk/client-[service]": "^3.879.0"
  },
  "devDependencies": {
    "esbuild": "^0.23.0",
    "typescript": "^5.9.2",
    "@types/node": "^24.3.0"
  }
}
```

### Step 3: Create tsconfig.json
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

### Step 4: Convert JS to TypeScript
1. Copy `terraform/lambdas/[lambda-name].js` to `packages/[lambda-name]/src/index.ts`
2. Convert CommonJS to ESM:
   - `const { ... } = require('...')` → `import { ... } from '...'`
   - `exports.handler = ` → `export const handler = `
3. Add TypeScript types for the Lambda event
4. Use shared utilities from `@bookimg/shared`

### Step 5: Update Terraform Configuration
In `terraform/main.tf`, update the archive data source:
```hcl
data "archive_file" "[lambda_name]" {
  type        = "zip"
  source_dir  = "../packages/[lambda-name]/dist"
  output_path = "[lambda_name].zip"
}
```

And update the Lambda handler:
```hcl
resource "aws_lambda_function" "[lambda_name]" {
  # ... other config
  handler = "index.handler"  # Changed from "[lambda-name].handler"
  # ... rest unchanged
}
```

### Step 6: Build and Deploy
```bash
cd packages/[lambda-name]
npm run build
cd ../../terraform
AWS_PROFILE=bookimg-deployer terraform apply -target=aws_lambda_function.[lambda_name] -auto-approve
```

### Step 7: Test the Migration
```bash
AWS_PROFILE=bookimg-deployer aws lambda invoke \
  --function-name bookimg-uat-[lambda-name] \
  --payload '[test-event-json]' \
  --region ap-southeast-2 \
  response.json
```

## 🔧 Build System Integration

### Root package.json Scripts (Add These)
```json
{
  "scripts": {
    "build:bedrock": "npm run build -w packages/bedrock-processor",
    "build:validator": "npm run build -w packages/book-validator",
    "build:upload": "npm run build -w packages/upload-handler",
    "build:websocket": "npm run build -w packages/websocket-connection-manager",
    "build:notifications": "npm run build -w packages/sns-notification-handler",
    "build:web": "npm run build -w packages/web-interface",
    
    "deploy:bedrock": "npm run build:bedrock && terraform apply -target=aws_lambda_function.bedrock_processor",
    "deploy:validator": "npm run build:validator && terraform apply -target=aws_lambda_function.book_validator",
    "deploy:upload": "npm run build:upload && terraform apply -target=aws_lambda_function.upload_handler",
    "deploy:websocket": "npm run build:websocket && terraform apply -target=aws_lambda_function.websocket_connection_manager",
    "deploy:notifications": "npm run build:notifications && terraform apply -target=aws_lambda_function.sns_notification_handler",
    "deploy:web": "npm run build:web && terraform apply -target=aws_lambda_function.web_lambda"
  }
}
```

## 🚀 Expected Benefits Per Lambda

- **Bundle Size**: ~90% reduction (from ~5MB to ~2-5KB per Lambda)
- **Cold Start**: Faster due to smaller bundle sizes
- **Type Safety**: Full TypeScript coverage with shared types
- **Developer Experience**: Consistent tooling and build process
- **Maintainability**: Shared utilities and centralized configuration

## 📝 Migration Order Recommendation

1. **bedrock-processor** (next priority - core pipeline)
2. **book-validator** (completes core pipeline)
3. **upload-handler** (triggers pipeline)
4. **websocket-connection-manager** (WebSocket features)
5. **sns-notification-handler** (notifications)
6. **web-interface** (UI - most complex due to dependencies) - do later, not right now

## 🔍 Lambda-Specific Considerations

### bedrock-processor
- Heavy AWS Bedrock usage
- JSON parsing/validation logic
- Add types for Bedrock request/response

### book-validator
- HTTP client for external APIs (Google Books, Open Library)  
- Consider using built-in `fetch`
- Rate limiting logic

### upload-handler
- Simple S3 event processing
- Easiest migration after textract-processor

### websocket-connection-manager
- DynamoDB operations
- API Gateway Management API
- WebSocket event types

### sns-notification-handler  
- SNS message parsing
- Complex notification formatting

### web-interface
- Fastify framework
- Multiple dependencies (view engine, etc.)
- May need to bundle dependencies or use layer
- Consider keeping as separate build process initially

## 🎯 Success Criteria

For each migrated Lambda:
- [ ] Builds successfully with `npm run build`
- [ ] Deploys successfully with Terraform
- [ ] Lambda invokes without runtime errors
- [ ] Maintains same functionality as original
- [ ] Bundle size significantly reduced
- [ ] TypeScript types compile without errors