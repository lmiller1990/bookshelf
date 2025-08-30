# BookImg Terraform Deployment Guide

Complete guide to deploy the BookImg infrastructure from scratch using proper AWS security practices.

## Prerequisites

1. **AWS Root Account Access**: You need AWS root credentials configured
2. **Terraform**: Install Terraform CLI
3. **AWS CLI**: Install and configure AWS CLI

## Stage 1: Bootstrap (Create Terraform Deployer User)

### Step 1: Configure Root Credentials
```bash
# Configure AWS CLI with your root account credentials
aws configure --profile root
# Enter your root Access Key ID and Secret Access Key
# Region: ap-southeast-2
# Output format: json
```

### Step 2: Deploy Bootstrap Infrastructure
```bash
# Navigate to bootstrap directory
cd terraform/bootstrap

# Initialize Terraform
terraform init

# Review the plan (creates deployer user)
terraform plan

# Apply the bootstrap configuration
terraform apply

# Get the deployer credentials (save these securely!)
terraform output deployer_access_key_id
terraform output -raw deployer_secret_access_key
```

### Step 3: Configure Deployer Profile
```bash
# Configure a new AWS profile with the deployer credentials
aws configure --profile bookimg-deployer
# Enter the deployer Access Key ID and Secret Access Key from step 2
# Region: ap-southeast-2
# Output format: json
```

### Step 4: Verify Deployer Access
```bash
# Test the deployer profile
export AWS_PROFILE=bookimg-deployer
aws sts get-caller-identity
# Should show: arn:aws:iam::ACCOUNT:user/bookimg-terraform-deployer
```

## Stage 2: Main Infrastructure Deployment

### Step 5: Deploy Main Infrastructure
```bash
# Navigate back to main terraform directory
cd ../

# Initialize Terraform (uses bookimg-deployer profile)
terraform init

# Review the infrastructure plan
terraform plan

# Deploy the main infrastructure
terraform apply
```

### Step 6: Get Application User Credentials
```bash
# Get the application user credentials
terraform output user_name
terraform output access_key_id
terraform output -raw secret_access_key
terraform output s3_bucket_name
```

### Step 7: Configure Application Profile
```bash
# Configure profile for the application user
aws configure --profile bookimg-app
# Enter the application user Access Key ID and Secret Access Key from step 6
# Region: ap-southeast-2
# Output format: json
```

## Stage 3: Run the Application

### Step 8: Test the Application
```bash
# Set the application profile
export AWS_PROFILE=bookimg-app

# Verify application user identity
aws sts get-caller-identity
# Should show: arn:aws:iam::ACCOUNT:user/bookimg-uat-textract-user

# Run the application
node index.js path/to/your/image.jpg
```

## Infrastructure Overview

### What Gets Created

**Bootstrap (Stage 1)**:
- `bookimg-terraform-deployer` IAM user with full deployment permissions
- Access keys for the deployer user

**Main Infrastructure (Stage 2)**:
- `bookimg-uat-textract-user` IAM user (limited permissions)
- S3 bucket `bookimg-uat` for image storage
- IAM policy with minimal required permissions:
  - `textract:DetectDocumentText`
  - S3 operations on the bookimg bucket only
- Access keys for the application user

### Security Architecture

```
Root Account (bootstrap only)
    ↓ creates
Terraform Deployer User (infrastructure deployment)
    ↓ creates  
Application User (runtime only - minimal permissions)
```

## Cleanup (Optional)

To destroy all infrastructure:

```bash
# Destroy main infrastructure (use deployer profile)
export AWS_PROFILE=bookimg-deployer
cd terraform
terraform destroy

# Destroy bootstrap infrastructure (use root profile)  
export AWS_PROFILE=root
cd terraform/bootstrap
terraform destroy
```

## Troubleshooting

### Common Issues

1. **403 Forbidden**: Check that you're using the correct AWS profile
2. **Profile not found**: Ensure you've run the `aws configure` commands
3. **Bucket already exists**: S3 bucket names are globally unique, modify the bucket name in variables

### Verification Commands

```bash
# Check current AWS identity
aws sts get-caller-identity

# List all configured profiles
aws configure list-profiles

# Check which profile is active
echo $AWS_PROFILE

# List S3 buckets (should see bookimg-uat)
aws s3 ls
```

## Environment Variables

The application expects these profiles:
- `AWS_PROFILE=bookimg-app` (for running the Node.js application)
- `AWS_PROFILE=bookimg-deployer` (for Terraform infrastructure changes)
- `AWS_PROFILE=root` (only for initial bootstrap)

## Next Steps

After successful deployment:
1. Test image upload and text extraction
2. Implement LLM text processing pipeline
3. Add web search validation
4. Build purchase link discovery