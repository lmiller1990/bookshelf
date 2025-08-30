# BookImg AWS Infrastructure Setup

## Overview
This documents the complete AWS infrastructure setup for the BookImg project using Terraform for Infrastructure as Code.

## Step 1: Initial AWS Profile Setup

Created root account profile for bootstrapping:

```bash
aws configure --profile bookimg-new-account
AWS Access Key ID [None]: *****
AWS Secret Access Key [None]: *****
Default region name [None]: ap-southeast-2
Default output format [None]: json
```

## Step 2: Manual IAM User Creation (Initial)

Initial manual creation (later replaced by Terraform):

```bash
aws iam create-user --user-name bookimg-textract-user --profile bookimg-new-account
{
    "User": {
        "Path": "/",
        "UserName": "bookimg-textract-user",
        "UserId": "AIDAQ3KFK5KPAFC6X25WR",
        "Arn": "arn:aws:iam::058664348318:user/bookimg-textract-user",
        "CreateDate": "2025-08-30T03:36:06+00:00"
    }
}
```

## Step 3: Terraform Infrastructure Setup

### Environment-Namespaced Resources

All resources are namespaced with `bookimg-{environment}` pattern:
- **Environment**: UAT (default)
- **User**: `bookimg-uat-textract-user`
- **Policy**: `bookimg-uat-textract-policy`
- **S3 Bucket**: `bookimg-uat-book-detect`

### Terraform Configuration

Created `terraform/main.tf` with:
- IAM user creation and management
- Least-privilege IAM policy for Textract and S3
- Access key generation
- Environment variable support
- Resource tagging

### Terraform Execution

```bash
# Clean up manual user first
aws iam delete-user --user-name bookimg-textract-user --profile bookimg-new-account

# Set profile for Terraform operations
export AWS_PROFILE=bookimg-new-account

# Apply Terraform configuration
cd terraform
terraform init
terraform plan
terraform apply
```

### Terraform Outputs

```
Outputs:
access_key_id = "AKIAQ3KFK5KPJSFAPQ5F"
s3_bucket_name = "bookimg-uat-book-detect"
secret_access_key = <sensitive>
user_name = "bookimg-uat-textract-user"
```

## Step 4: Application Profile Configuration

Created dedicated application profile with limited permissions:

```bash
# Get secret key from Terraform
terraform output -raw secret_access_key

# Configure application profile
aws configure --profile bookimg-app
AWS Access Key ID [None]: AKIAQ3KFK5KPJSFAPQ5F
AWS Secret Access Key [None]: [from terraform output]
Default region name [None]: ap-southeast-2
Default output format [None]: json
```

## Final Architecture

### Security Model
- **Root credentials**: Only used for initial setup, can be deleted after Terraform setup
- **Application credentials**: Least-privilege IAM user with only required permissions
- **Infrastructure as Code**: All resources managed via Terraform

### IAM Permissions
The application user has minimal permissions:
- `textract:DetectDocumentText` on all resources
- S3 operations (`CreateBucket`, `GetObject`, `PutObject`, `HeadBucket`) only on the specific bucket

### Environment Management
- Resources can be deployed to different environments by changing the `environment` variable
- Default environment is `UAT`
- For production: `terraform apply -var="environment=PROD"`
