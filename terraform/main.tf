terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "environment" {
  description = "Environment name (e.g., UAT, PROD)"
  type        = string
  default     = "UAT"
}

locals {
  resource_prefix = "bookimg-${lower(var.environment)}"
  s3_bucket_name  = local.resource_prefix
}

# Use deployer credentials (configured via aws configure --profile bookimg-deployer)
provider "aws" {
  profile = "bookimg-deployer"
  region  = "ap-southeast-2"
}

# Create IAM user
resource "aws_iam_user" "bookimg_textract_user" {
  name = "${local.resource_prefix}-textract-user"
  path = "/"

  tags = {
    Environment = var.environment
    Project     = "BookImg"
  }
}

# IAM policy for Textract and S3 access
resource "aws_iam_policy" "bookimg_textract_policy" {
  name        = "${local.resource_prefix}-textract-policy"
  path        = "/"
  description = "Policy for BookImg Textract operations (${var.environment})"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "textract:DetectDocumentText",
          "bedrock:InvokeModel"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:GetObject",
          "s3:PutObject",
          "s3:HeadBucket",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::${local.s3_bucket_name}",
          "arn:aws:s3:::${local.s3_bucket_name}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListAllMyBuckets"
        ]
        Resource = "*"
      }
    ]
  })

  tags = {
    Environment = var.environment
    Project     = "BookImg"
  }
}

# Attach policy to the user
resource "aws_iam_user_policy_attachment" "bookimg_policy_attachment" {
  user       = aws_iam_user.bookimg_textract_user.name
  policy_arn = aws_iam_policy.bookimg_textract_policy.arn
}

# Create S3 bucket
resource "aws_s3_bucket" "bookimg_bucket" {
  bucket = local.s3_bucket_name

  tags = {
    Environment = var.environment
    Project     = "BookImg"
  }
}

# Create access key for the user
resource "aws_iam_access_key" "bookimg_access_key" {
  user = aws_iam_user.bookimg_textract_user.name
}

# Outputs for easy access to credentials and resources
output "user_name" {
  value = aws_iam_user.bookimg_textract_user.name
}

output "s3_bucket_name" {
  value = local.s3_bucket_name
}

output "access_key_id" {
  value = aws_iam_access_key.bookimg_access_key.id
}

output "secret_access_key" {
  value     = aws_iam_access_key.bookimg_access_key.secret
  sensitive = true
}