#!/bin/bash

# Deploy Frontend Script
# Reads Terraform outputs and deploys Vue app to S3 + CloudFront

set -e  # Exit on error

echo "🚀 Starting frontend deployment..."

# Check if we're in the right directory
if [ ! -f "terraform/main.tf" ]; then
    echo "❌ Error: Must run from project root directory (where terraform/ folder exists)"
    exit 1
fi

# Check if terraform outputs are available
echo "📋 Reading Terraform outputs..."
cd terraform

if ! terraform output frontend_bucket_name > /dev/null 2>&1; then
    echo "❌ Error: Terraform outputs not found. Run 'terraform apply' first."
    exit 1
fi

# Get infrastructure values from Terraform
FRONTEND_BUCKET=$(terraform output -raw frontend_bucket_name)
CLOUDFRONT_ID=$(terraform output -raw frontend_cloudfront_distribution_id)
CLOUDFRONT_URL=$(terraform output -raw frontend_cloudfront_url)

echo "📦 Target S3 bucket: $FRONTEND_BUCKET"
echo "🌐 CloudFront distribution: $CLOUDFRONT_ID"

cd ..

# Build the Vue app
echo "🔨 Building Vue frontend..."
cd packages/frontend

if [ ! -f "package.json" ]; then
    echo "❌ Error: Frontend package.json not found"
    exit 1
fi

# Install dependencies and build
npm install
npm run build

if [ ! -d "dist" ]; then
    echo "❌ Error: Build failed - dist directory not created"
    exit 1
fi

echo "✅ Build completed"

# Deploy to S3
echo "📤 Uploading to S3..."

# Upload all files except index.html with default caching
aws s3 sync dist/ s3://$FRONTEND_BUCKET --delete --profile bookimg-app --exclude "index.html"

# Upload index.html with no-cache headers
aws s3 cp dist/index.html s3://$FRONTEND_BUCKET/index.html --profile bookimg-app \
  --cache-control "no-cache, no-store, must-revalidate" \
  --metadata-directive REPLACE

if [ $? -eq 0 ]; then
    echo "✅ S3 upload completed"
else
    echo "❌ Error: S3 upload failed"
    exit 1
fi

# Invalidate CloudFront cache
echo "🔄 Invalidating CloudFront cache..."
INVALIDATION_ID=$(aws cloudfront create-invalidation --distribution-id $CLOUDFRONT_ID --paths '/*' --profile bookimg-app --query 'Invalidation.Id' --output text)

if [ $? -eq 0 ]; then
    echo "✅ CloudFront invalidation created: $INVALIDATION_ID"
    echo "🌐 Frontend will be available at: $CLOUDFRONT_URL"
    echo "⏰ Cache invalidation may take 5-10 minutes to complete"
else
    echo "❌ Error: CloudFront invalidation failed"
    exit 1
fi

echo ""
echo "🎉 Frontend deployment completed successfully!"
echo "🔗 URL: $CLOUDFRONT_URL"
echo ""
echo "Note: If this is the first deployment, it may take 10-15 minutes"
echo "for the CloudFront distribution to fully deploy."