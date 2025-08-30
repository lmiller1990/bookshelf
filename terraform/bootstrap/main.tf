terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "environment" {
  description = "Environment name (e.g., uat, prod)"
  type        = string
  default     = "uat"
}

locals {
  resource_prefix        = "bookimg-${lower(var.environment)}"
  terraform_state_bucket = "${local.resource_prefix}-terraform-state"
}

# Use root credentials (configured via aws configure)
provider "aws" {
  region = "ap-southeast-2"
}

# S3 bucket for storing Terraform state
resource "aws_s3_bucket" "terraform_state" {
  bucket = local.terraform_state_bucket

  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Terraform State Storage"
  }
}

# Enable versioning on the state bucket
resource "aws_s3_bucket_versioning" "terraform_state_versioning" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Enable server-side encryption on the state bucket
resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state_encryption" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Block public access to the state bucket
resource "aws_s3_bucket_public_access_block" "terraform_state_pab" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Create Terraform Deployer user
resource "aws_iam_user" "terraform_deployer" {
  name = "${local.resource_prefix}-terraform-deployer"
  path = "/"

  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Terraform Deployment"
  }
}

# Policy for the Terraform deployer (full IAM and service permissions)
resource "aws_iam_policy" "terraform_deployer_policy" {
  name        = "${local.resource_prefix}-terraform-deployer-policy"
  path        = "/"
  description = "Full permissions for BookImg Terraform deployment"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "iam:*",
          "s3:*",
          "textract:*",
          "bedrock:*"
        ]
        Resource = "*"
      }
    ]
  })
}

# Attach policy to deployer user
resource "aws_iam_user_policy_attachment" "terraform_deployer_attachment" {
  user       = aws_iam_user.terraform_deployer.name
  policy_arn = aws_iam_policy.terraform_deployer_policy.arn
}

# Create access key for deployer user
resource "aws_iam_access_key" "terraform_deployer_key" {
  user = aws_iam_user.terraform_deployer.name
}

# Outputs
output "terraform_state_bucket" {
  value       = aws_s3_bucket.terraform_state.id
  description = "S3 bucket for storing Terraform state"
}

output "deployer_user_name" {
  value = aws_iam_user.terraform_deployer.name
}

output "deployer_access_key_id" {
  value = aws_iam_access_key.terraform_deployer_key.id
}

output "deployer_secret_access_key" {
  value     = aws_iam_access_key.terraform_deployer_key.secret
  sensitive = true
}