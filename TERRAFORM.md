# BookImg Terraform Deployment Guide

Complete guide to deploy the BookImg infrastructure from scratch using proper AWS security practices.

## Prerequisites

1. **AWS Root Account Access**: You need AWS root credentials configured
2. **Terraform**: Install Terraform CLI
3. **AWS CLI**: Install and configure AWS CLI

## Remote State Storage

This setup uses S3 for Terraform state storage to keep sensitive data out of git:
- **Bootstrap state**: `bookimg-{env}-terraform-state` bucket, key `bootstrap/terraform.tfstate`  
- **Main infrastructure state**: Same bucket, key `main/terraform.tfstate`
- **Security**: State files are encrypted and versioned in S3

## Stage 1: Bootstrap (Create S3 State Bucket + Deployer User)

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

# Initialize Terraform (local state initially)
AWS_PROFILE=root terraform init

# Review the plan (creates S3 state bucket + deployer user)
AWS_PROFILE=root terraform plan

# Apply the bootstrap configuration
AWS_PROFILE=root terraform apply

# Get the deployer credentials (save these securely!)
AWS_PROFILE=root terraform output deployer_access_key_id
AWS_PROFILE=root terraform output -raw deployer_secret_access_key
AWS_PROFILE=root terraform output terraform_state_bucket
```

### Step 3: Migrate Bootstrap State to S3 (Optional)
```bash
# (Optional) Move bootstrap state to S3 for consistency
cd terraform/bootstrap

# Edit backend.tf - uncomment the terraform backend block
# Then initialize with the backend
AWS_PROFILE=root terraform init

# Terraform will ask if you want to copy existing state to S3
# Answer 'yes' to migrate
```

### Step 4: Configure Deployer Profile
```bash
# Configure a new AWS profile with the deployer credentials
aws configure --profile bookimg-deployer
# Enter the deployer Access Key ID and Secret Access Key from step 2
# Region: ap-southeast-2
# Output format: json
```

### Step 5: Verify Deployer Access
```bash
# Test the deployer profile
AWS_PROFILE=bookimg-deployer aws sts get-caller-identity
# Should show: arn:aws:iam::ACCOUNT:user/bookimg-uat-terraform-deployer
```

## Stage 2: Main Infrastructure Deployment

### Step 6: Deploy Main Infrastructure
```bash
# Navigate back to main terraform directory
cd ../

# Initialize Terraform (uses S3 backend automatically)
AWS_PROFILE=bookimg-deployer terraform init

# Review the infrastructure plan
AWS_PROFILE=bookimg-deployer terraform plan

# Deploy the main infrastructure
AWS_PROFILE=bookimg-deployer terraform apply
```

### Step 7: Get Application User Credentials
```bash
# Get the application user credentials
AWS_PROFILE=bookimg-deployer terraform output user_name
AWS_PROFILE=bookimg-deployer terraform output access_key_id
AWS_PROFILE=bookimg-deployer terraform output -raw secret_access_key
AWS_PROFILE=bookimg-deployer terraform output s3_bucket_name
```

### Step 8: Configure Application Profile
```bash
# Configure profile for the application user
aws configure --profile bookimg-app
# Enter the application user Access Key ID and Secret Access Key from step 7
# Region: ap-southeast-2
# Output format: json
```

## Stage 3: Run the Application

### Step 9: Test the Application
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
- S3 bucket `bookimg-{env}-terraform-state` for storing Terraform state
- `bookimg-{env}-terraform-deployer` IAM user with full deployment permissions
- Access keys for the deployer user

**Main Infrastructure (Stage 2)**:
- `bookimg-{env}-textract-user` IAM user (limited permissions)
- S3 bucket `bookimg-{env}` for image storage
- IAM policy with minimal required permissions:
  - `textract:DetectDocumentText`
  - `bedrock:InvokeModel`
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

## Handy Commands

### Quick Development Commands
```bash
# Check current infrastructure status
cd terraform && AWS_PROFILE=bookimg-deployer terraform plan

# Update main infrastructure  
cd terraform && AWS_PROFILE=bookimg-deployer terraform apply

# Check bootstrap status
cd terraform/bootstrap && AWS_PROFILE=root terraform plan

# View current state (main)
cd terraform && AWS_PROFILE=bookimg-deployer terraform show

# View current state (bootstrap)
cd terraform/bootstrap && AWS_PROFILE=root terraform show

# List all resources in main infrastructure
cd terraform && AWS_PROFILE=bookimg-deployer terraform state list

# Get outputs from main infrastructure
cd terraform && AWS_PROFILE=bookimg-deployer terraform output

# Get outputs from bootstrap
cd terraform/bootstrap && AWS_PROFILE=root terraform output
```

### State Management
```bash
# View remote state configuration
cd terraform && AWS_PROFILE=bookimg-deployer terraform show -json | jq '.values.root_module.resources[] | select(.type == "aws_s3_bucket")'

# Force refresh state from AWS
cd terraform && AWS_PROFILE=bookimg-deployer terraform refresh

# Import existing resource (example)
cd terraform && AWS_PROFILE=bookimg-deployer terraform import aws_s3_bucket.example bucket-name
```

## Cleanup (Optional)

To destroy all infrastructure:

```bash
# Destroy main infrastructure (use deployer profile)
cd terraform && AWS_PROFILE=bookimg-deployer terraform destroy

# Destroy bootstrap infrastructure (use root profile)  
cd terraform/bootstrap && AWS_PROFILE=root terraform destroy
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