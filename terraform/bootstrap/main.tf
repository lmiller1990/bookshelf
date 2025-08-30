terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Use root credentials (configured via aws configure)
provider "aws" {
  region = "ap-southeast-2"
}

# Create Terraform Deployer user
resource "aws_iam_user" "terraform_deployer" {
  name = "bookimg-terraform-deployer"
  path = "/"

  tags = {
    Project = "BookImg"
    Purpose = "Terraform Deployment"
  }
}

# Policy for the Terraform deployer (full IAM and service permissions)
resource "aws_iam_policy" "terraform_deployer_policy" {
  name        = "bookimg-terraform-deployer-policy"
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
          "textract:*"
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