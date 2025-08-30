# Backend configuration for storing bootstrap state in S3
# NOTE: This should be applied AFTER the initial bootstrap creates the S3 bucket
# 
# To enable this backend:
# 1. First run bootstrap without this file (comment out or rename)
# 2. After S3 bucket is created, uncomment/rename this file
# 3. Run `terraform init` to migrate state to S3

# terraform {
#   backend "s3" {
#     bucket         = "bookimg-uat-terraform-state"
#     key            = "bootstrap/terraform.tfstate"
#     region         = "ap-southeast-2"
#     profile        = "root"
#     encrypt        = true
#   }
# }