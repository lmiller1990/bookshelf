terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
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

variable "google_books_api_key" {
  description = "Google Books API key for book validation"
  type        = string
  default     = ""
  sensitive   = true
}

locals {
  resource_prefix = "bookimg-${lower(var.environment)}"
  s3_bucket_name  = local.resource_prefix
  repo_root       = "${path.module}/.."
}

# Data sources
data "aws_region" "current" {}

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

# S3 bucket CORS configuration
resource "aws_s3_bucket_cors_configuration" "bookimg_bucket_cors" {
  bucket = aws_s3_bucket.bookimg_bucket.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "DELETE", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
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
    lambda_function_arn = module.upload_handler.function_arn
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

# DynamoDB table for WebSocket connections
resource "aws_dynamodb_table" "websocket_connections" {
  name           = "${local.resource_prefix}-websocket-connections"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "jobId"
  
  attribute {
    name = "jobId"
    type = "S"
  }
  
  # TTL to auto-cleanup old connections (1 hour)
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "WebSocket connection tracking"
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
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.bookimg_bucket.arn,
          aws_s3_bucket.bookimg_results.arn
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
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          aws_dynamodb_table.websocket_connections.arn,
          "${aws_dynamodb_table.websocket_connections.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "execute-api:ManageConnections"
        ]
        Resource = "${aws_apigatewayv2_api.websocket_api.execution_arn}/*/*"
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

# Web Lambda using reusable module
module "web_lambda" {
  source = "./lambdas"
  
  function_name      = "${local.resource_prefix}-web"
  package_name       = "lambda-web-dist"
  handler           = "src/index.handler"
  execution_role_arn = aws_iam_role.lambda_execution_role.arn
  environment       = var.environment
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Web interface for uploads"
  }
}

# Lambda Functions
module "upload_handler" {
  source = "./lambdas"
  
  function_name      = "${local.resource_prefix}-upload-handler"
  package_name       = "upload-handler"
  handler           = "src/index.handler"
  execution_role_arn = aws_iam_role.lambda_execution_role.arn
  environment       = var.environment
  timeout           = 30
  
  environment_variables = {
    TEXTRACT_QUEUE_URL = aws_sqs_queue.textract_queue.url
  }
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Handle S3 uploads and initiate processing"
  }
}

module "textract_processor" {
  source = "./lambdas"
  
  function_name      = "${local.resource_prefix}-textract-processor"
  package_name       = "textract-processor"
  handler           = "src/index.handler"
  execution_role_arn = aws_iam_role.lambda_execution_role.arn
  environment       = var.environment
  timeout           = 300  # 5 minutes for Textract
  
  environment_variables = {
    RESULTS_BUCKET_NAME = aws_s3_bucket.bookimg_results.bucket
    BEDROCK_QUEUE_URL   = aws_sqs_queue.bedrock_queue.url
  }
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Process images with Textract OCR"
  }
}

module "bedrock_processor" {
  source = "./lambdas"
  
  function_name      = "${local.resource_prefix}-bedrock-processor"
  package_name       = "bedrock-processor"
  handler           = "src/index.handler"
  execution_role_arn = aws_iam_role.lambda_execution_role.arn
  environment       = var.environment
  timeout           = 180  # 3 minutes for LLM
  
  environment_variables = {
    RESULTS_BUCKET_NAME  = aws_s3_bucket.bookimg_results.bucket
    VALIDATION_QUEUE_URL = aws_sqs_queue.validation_queue.url
  }
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Process OCR text with Bedrock LLM"
  }
}

module "book_validator" {
  source = "./lambdas"
  
  function_name      = "${local.resource_prefix}-book-validator"
  package_name       = "book-validator"
  handler           = "src/index.handler"
  execution_role_arn = aws_iam_role.lambda_execution_role.arn
  environment       = var.environment
  timeout           = 120  # 2 minutes for API calls
  
  environment_variables = {
    RESULTS_BUCKET_NAME    = aws_s3_bucket.bookimg_results.bucket
    SNS_TOPIC_ARN          = aws_sns_topic.results_notifications.arn
    GOOGLE_BOOKS_API_KEY   = var.google_books_api_key
  }
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "Validate books with external APIs"
  }
}


module "websocket_connection_manager" {
  source = "./lambdas"
  
  function_name      = "${local.resource_prefix}-websocket-connection-manager"
  package_name       = "websocket-connection-manager"
  handler           = "src/index.handler"
  execution_role_arn = aws_iam_role.lambda_execution_role.arn
  environment       = var.environment
  timeout           = 30
  
  environment_variables = {
    DYNAMODB_TABLE_NAME = aws_dynamodb_table.websocket_connections.name
  }
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "WebSocket connection management"
  }
}

module "sns_notification_handler" {
  source = "./lambdas"
  
  function_name      = "${local.resource_prefix}-sns-notification-handler"
  package_name       = "sns-notification-handler"
  handler           = "src/index.handler"
  execution_role_arn = aws_iam_role.lambda_execution_role.arn
  environment       = var.environment
  timeout           = 30
  
  environment_variables = {
    DYNAMODB_TABLE_NAME = aws_dynamodb_table.websocket_connections.name
    WEBSOCKET_API_ENDPOINT = "https://${aws_apigatewayv2_api.websocket_api.id}.execute-api.${data.aws_region.current.name}.amazonaws.com/${aws_apigatewayv2_stage.websocket_stage.name}"
  }
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "SNS to WebSocket notification handler"
  }
}

# Lambda permissions for S3 to invoke upload handler
resource "aws_lambda_permission" "s3_invoke_upload_handler" {
  statement_id  = "AllowExecutionFromS3Bucket"
  action        = "lambda:InvokeFunction"
  function_name = module.upload_handler.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.bookimg_bucket.arn
}

# Lambda event source mappings for SQS
resource "aws_lambda_event_source_mapping" "textract_queue_mapping" {
  event_source_arn = aws_sqs_queue.textract_queue.arn
  function_name    = module.textract_processor.function_arn
  batch_size       = 1
}

resource "aws_lambda_event_source_mapping" "bedrock_queue_mapping" {
  event_source_arn = aws_sqs_queue.bedrock_queue.arn
  function_name    = module.bedrock_processor.function_arn
  batch_size       = 1
}

resource "aws_lambda_event_source_mapping" "validation_queue_mapping" {
  event_source_arn = aws_sqs_queue.validation_queue.arn
  function_name    = module.book_validator.function_arn
  batch_size       = 1
}

# WebSocket Lambda permissions
resource "aws_lambda_permission" "websocket_connect_permission" {
  statement_id  = "AllowExecutionFromWebSocketConnect"
  action        = "lambda:InvokeFunction"
  function_name = module.websocket_connection_manager.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.websocket_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "websocket_disconnect_permission" {
  statement_id  = "AllowExecutionFromWebSocketDisconnect"
  action        = "lambda:InvokeFunction"
  function_name = module.websocket_connection_manager.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.websocket_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "websocket_default_permission" {
  statement_id  = "AllowExecutionFromWebSocketDefault"
  action        = "lambda:InvokeFunction"
  function_name = module.websocket_connection_manager.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.websocket_api.execution_arn}/*/*"
}

# SNS subscription for notification handler
resource "aws_sns_topic_subscription" "sns_notification_handler" {
  topic_arn = aws_sns_topic.results_notifications.arn
  protocol  = "lambda"
  endpoint  = module.sns_notification_handler.function_arn
}

resource "aws_lambda_permission" "sns_invoke_notification_handler" {
  statement_id  = "AllowExecutionFromSNS"
  action        = "lambda:InvokeFunction"
  function_name = module.sns_notification_handler.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.results_notifications.arn
}

# API Gateway for web interface
resource "aws_apigatewayv2_api" "web_api" {
  name          = "${local.resource_prefix}-web-api"
  protocol_type = "HTTP"
  description   = "BookImg Web Interface API"
  
  cors_configuration {
    allow_credentials = false
    allow_headers     = ["*"]
    allow_methods     = ["GET", "POST", "OPTIONS"]
    allow_origins     = ["*"]
    max_age          = 300
  }

  tags = {
    Environment = var.environment
    Project     = "BookImg"
  }
}

resource "aws_apigatewayv2_integration" "web_lambda_integration" {
  api_id           = aws_apigatewayv2_api.web_api.id
  integration_type = "AWS_PROXY"
  integration_uri  = module.web_lambda.invoke_arn
}

resource "aws_apigatewayv2_route" "web_route_catch_all" {
  api_id    = aws_apigatewayv2_api.web_api.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.web_lambda_integration.id}"
}

resource "aws_apigatewayv2_route" "web_route_root" {
  api_id    = aws_apigatewayv2_api.web_api.id
  route_key = "ANY /"
  target    = "integrations/${aws_apigatewayv2_integration.web_lambda_integration.id}"
}

resource "aws_apigatewayv2_stage" "web_stage" {
  api_id      = aws_apigatewayv2_api.web_api.id
  name        = var.environment
  auto_deploy = true

  tags = {
    Environment = var.environment
    Project     = "BookImg"
  }
}

resource "aws_lambda_permission" "api_gateway_invoke_web_lambda" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.web_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.web_api.execution_arn}/*/*"
}

# WebSocket API Gateway
resource "aws_apigatewayv2_api" "websocket_api" {
  name          = "${local.resource_prefix}-websocket-api"
  protocol_type = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
  description   = "BookImg WebSocket API for real-time notifications"

  tags = {
    Environment = var.environment
    Project     = "BookImg"
  }
}

# WebSocket API routes
resource "aws_apigatewayv2_route" "websocket_connect" {
  api_id    = aws_apigatewayv2_api.websocket_api.id
  route_key = "$connect"
  target    = "integrations/${aws_apigatewayv2_integration.websocket_connect_integration.id}"
}

resource "aws_apigatewayv2_route" "websocket_disconnect" {
  api_id    = aws_apigatewayv2_api.websocket_api.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.websocket_disconnect_integration.id}"
}

resource "aws_apigatewayv2_route" "websocket_default" {
  api_id    = aws_apigatewayv2_api.websocket_api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.websocket_default_integration.id}"
}

# WebSocket integrations
resource "aws_apigatewayv2_integration" "websocket_connect_integration" {
  api_id           = aws_apigatewayv2_api.websocket_api.id
  integration_type = "AWS_PROXY"
  integration_uri  = module.websocket_connection_manager.invoke_arn
}

resource "aws_apigatewayv2_integration" "websocket_disconnect_integration" {
  api_id           = aws_apigatewayv2_api.websocket_api.id
  integration_type = "AWS_PROXY"
  integration_uri  = module.websocket_connection_manager.invoke_arn
}

resource "aws_apigatewayv2_integration" "websocket_default_integration" {
  api_id           = aws_apigatewayv2_api.websocket_api.id
  integration_type = "AWS_PROXY"
  integration_uri  = module.websocket_connection_manager.invoke_arn
}

# WebSocket stage
resource "aws_apigatewayv2_stage" "websocket_stage" {
  api_id      = aws_apigatewayv2_api.websocket_api.id
  name        = var.environment
  auto_deploy = true

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
    upload_handler               = module.upload_handler.function_name
    textract_processor          = module.textract_processor.function_name
    bedrock_processor           = module.bedrock_processor.function_name
    book_validator              = module.book_validator.function_name
    web_lambda                  = module.web_lambda.function_name
    websocket_connection_manager = module.websocket_connection_manager.function_name
    sns_notification_handler    = module.sns_notification_handler.function_name
  }
}

output "web_api_url" {
  value = aws_apigatewayv2_stage.web_stage.invoke_url
}

output "websocket_api_url" {
  value = "wss://${aws_apigatewayv2_api.websocket_api.id}.execute-api.${data.aws_region.current.name}.amazonaws.com/${aws_apigatewayv2_stage.websocket_stage.name}"
}

output "dynamodb_connections_table" {
  value = aws_dynamodb_table.websocket_connections.name
}

output "access_key_id" {
  value = aws_iam_access_key.bookimg_access_key.id
}

output "secret_access_key" {
  value     = aws_iam_access_key.bookimg_access_key.secret
  sensitive = true
}

