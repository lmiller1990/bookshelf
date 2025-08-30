terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  
  backend "s3" {
    bucket         = "bookimg-uat-terraform-state"
    key            = "main/terraform.tfstate"
    region         = "ap-southeast-2"
    profile        = "bookimg-deployer"
    encrypt        = true
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
          "arn:aws:s3:::${local.s3_bucket_name}/*",
          "arn:aws:s3:::${local.resource_prefix}-results",
          "arn:aws:s3:::${local.resource_prefix}-results/*"
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

# S3 bucket for image uploads (keeping original resource name)
resource "aws_s3_bucket" "bookimg_bucket" {
  bucket = local.s3_bucket_name

  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Image uploads"
  }
}

# S3 bucket for processing results
resource "aws_s3_bucket" "bookimg_results" {
  bucket = "${local.resource_prefix}-results"

  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Processing results"
  }
}

# S3 bucket notifications for upload trigger
resource "aws_s3_bucket_notification" "upload_notification" {
  bucket = aws_s3_bucket.bookimg_bucket.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.upload_handler.arn
    events              = ["s3:ObjectCreated:*"]
  }

  depends_on = [aws_lambda_permission.s3_invoke_upload_handler]
}

# SQS Dead Letter Queues
resource "aws_sqs_queue" "textract_dlq" {
  name = "${local.resource_prefix}-textract-dlq"
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Textract DLQ"
  }
}

resource "aws_sqs_queue" "bedrock_dlq" {
  name = "${local.resource_prefix}-bedrock-dlq"
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Bedrock DLQ"
  }
}

resource "aws_sqs_queue" "validation_dlq" {
  name = "${local.resource_prefix}-validation-dlq"
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Validation DLQ"
  }
}

# SQS Main Queues
resource "aws_sqs_queue" "textract_queue" {
  name                       = "${local.resource_prefix}-textract-queue"
  visibility_timeout_seconds = 300  # 5 minutes for Textract processing
  
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.textract_dlq.arn
    maxReceiveCount     = 3
  })
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Textract processing queue"
  }
}

resource "aws_sqs_queue" "bedrock_queue" {
  name                       = "${local.resource_prefix}-bedrock-queue"
  visibility_timeout_seconds = 180  # 3 minutes for LLM processing
  
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.bedrock_dlq.arn
    maxReceiveCount     = 3
  })
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Bedrock LLM processing queue"
  }
}

resource "aws_sqs_queue" "validation_queue" {
  name                       = "${local.resource_prefix}-validation-queue"
  visibility_timeout_seconds = 120  # 2 minutes for API validation
  
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.validation_dlq.arn
    maxReceiveCount     = 3
  })
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Book validation queue"
  }
}

# SNS Topic for result notifications
resource "aws_sns_topic" "results_notifications" {
  name = "${local.resource_prefix}-results"
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Result notifications"
  }
}

# Lambda execution role
resource "aws_iam_role" "lambda_execution_role" {
  name = "${local.resource_prefix}-lambda-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Environment = var.environment
    Project     = "BookImg"
  }
}

# Lambda basic execution policy attachment (includes CloudWatch Logs)
resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.lambda_execution_role.name
}

# Additional CloudWatch Logs permissions
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
  role       = aws_iam_role.lambda_execution_role.name
}

# Lambda policy for accessing AWS services
resource "aws_iam_policy" "lambda_service_policy" {
  name        = "${local.resource_prefix}-lambda-service-policy"
  description = "Policy for Lambda functions to access AWS services"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = [
          "${aws_s3_bucket.bookimg_bucket.arn}/*",
          "${aws_s3_bucket.bookimg_results.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:SendMessage"
        ]
        Resource = [
          aws_sqs_queue.textract_queue.arn,
          aws_sqs_queue.bedrock_queue.arn,
          aws_sqs_queue.validation_queue.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "textract:DetectDocumentText"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = aws_sns_topic.results_notifications.arn
      }
    ]
  })

  tags = {
    Environment = var.environment
    Project     = "BookImg"
  }
}

# Attach service policy to Lambda execution role
resource "aws_iam_role_policy_attachment" "lambda_service_policy_attachment" {
  policy_arn = aws_iam_policy.lambda_service_policy.arn
  role       = aws_iam_role.lambda_execution_role.name
}

# Archive Lambda function source code
data "archive_file" "upload_handler" {
  type        = "zip"
  source_file = "lambdas/upload-handler.js"
  output_path = "upload_handler.zip"
}

data "archive_file" "textract_processor" {
  type        = "zip"
  source_file = "lambdas/textract-processor.js"
  output_path = "textract_processor.zip"
}

data "archive_file" "bedrock_processor" {
  type        = "zip"
  source_file = "lambdas/bedrock-processor.js"
  output_path = "bedrock_processor.zip"
}

data "archive_file" "book_validator" {
  type        = "zip"
  source_file = "lambdas/book-validator.js"
  output_path = "book_validator.zip"
}

# Lambda Functions
resource "aws_lambda_function" "upload_handler" {
  filename         = data.archive_file.upload_handler.output_path
  source_code_hash = data.archive_file.upload_handler.output_base64sha256
  function_name    = "${local.resource_prefix}-upload-handler"
  role            = aws_iam_role.lambda_execution_role.arn
  handler         = "upload-handler.handler"
  runtime         = "nodejs20.x"
  timeout         = 30

  environment {
    variables = {
      TEXTRACT_QUEUE_URL = aws_sqs_queue.textract_queue.url
    }
  }

  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Handle S3 uploads and initiate processing"
  }
}

resource "aws_lambda_function" "textract_processor" {
  filename         = data.archive_file.textract_processor.output_path
  source_code_hash = data.archive_file.textract_processor.output_base64sha256
  function_name    = "${local.resource_prefix}-textract-processor"
  role            = aws_iam_role.lambda_execution_role.arn
  handler         = "textract-processor.handler"
  runtime         = "nodejs20.x"
  timeout         = 300  # 5 minutes for Textract

  environment {
    variables = {
      RESULTS_BUCKET_NAME = aws_s3_bucket.bookimg_results.bucket
      BEDROCK_QUEUE_URL   = aws_sqs_queue.bedrock_queue.url
    }
  }

  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Process images with Textract OCR"
  }
}

resource "aws_lambda_function" "bedrock_processor" {
  filename         = data.archive_file.bedrock_processor.output_path
  source_code_hash = data.archive_file.bedrock_processor.output_base64sha256
  function_name    = "${local.resource_prefix}-bedrock-processor"
  role            = aws_iam_role.lambda_execution_role.arn
  handler         = "bedrock-processor.handler"
  runtime         = "nodejs20.x"
  timeout         = 180  # 3 minutes for LLM

  environment {
    variables = {
      RESULTS_BUCKET_NAME  = aws_s3_bucket.bookimg_results.bucket
      VALIDATION_QUEUE_URL = aws_sqs_queue.validation_queue.url
    }
  }

  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Process OCR text with Bedrock LLM"
  }
}

resource "aws_lambda_function" "book_validator" {
  filename         = data.archive_file.book_validator.output_path
  source_code_hash = data.archive_file.book_validator.output_base64sha256
  function_name    = "${local.resource_prefix}-book-validator"
  role            = aws_iam_role.lambda_execution_role.arn
  handler         = "book-validator.handler"
  runtime         = "nodejs20.x"
  timeout         = 120  # 2 minutes for API calls

  environment {
    variables = {
      RESULTS_BUCKET_NAME = aws_s3_bucket.bookimg_results.bucket
      SNS_TOPIC_ARN       = aws_sns_topic.results_notifications.arn
    }
  }

  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Validate books with external APIs"
  }
}

# Lambda permissions for S3 to invoke upload handler
resource "aws_lambda_permission" "s3_invoke_upload_handler" {
  statement_id  = "AllowExecutionFromS3Bucket"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.upload_handler.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.bookimg_bucket.arn
}

# Lambda event source mappings for SQS
resource "aws_lambda_event_source_mapping" "textract_queue_mapping" {
  event_source_arn = aws_sqs_queue.textract_queue.arn
  function_name    = aws_lambda_function.textract_processor.arn
  batch_size       = 1
}

resource "aws_lambda_event_source_mapping" "bedrock_queue_mapping" {
  event_source_arn = aws_sqs_queue.bedrock_queue.arn
  function_name    = aws_lambda_function.bedrock_processor.arn
  batch_size       = 1
}

resource "aws_lambda_event_source_mapping" "validation_queue_mapping" {
  event_source_arn = aws_sqs_queue.validation_queue.arn
  function_name    = aws_lambda_function.book_validator.arn
  batch_size       = 1
}

# Create access key for the user
resource "aws_iam_access_key" "bookimg_access_key" {
  user = aws_iam_user.bookimg_textract_user.name
}

# Outputs for easy access to credentials and resources
output "user_name" {
  value = aws_iam_user.bookimg_textract_user.name
}

output "uploads_bucket_name" {
  value = aws_s3_bucket.bookimg_bucket.bucket
}

output "results_bucket_name" {
  value = aws_s3_bucket.bookimg_results.bucket
}

output "textract_queue_url" {
  value = aws_sqs_queue.textract_queue.url
}

output "bedrock_queue_url" {
  value = aws_sqs_queue.bedrock_queue.url
}

output "validation_queue_url" {
  value = aws_sqs_queue.validation_queue.url
}

output "sns_topic_arn" {
  value = aws_sns_topic.results_notifications.arn
}

output "lambda_functions" {
  value = {
    upload_handler     = aws_lambda_function.upload_handler.function_name
    textract_processor = aws_lambda_function.textract_processor.function_name
    bedrock_processor  = aws_lambda_function.bedrock_processor.function_name
    book_validator     = aws_lambda_function.book_validator.function_name
  }
}

output "access_key_id" {
  value = aws_iam_access_key.bookimg_access_key.id
}

output "secret_access_key" {
  value     = aws_iam_access_key.bookimg_access_key.secret
  sensitive = true
}