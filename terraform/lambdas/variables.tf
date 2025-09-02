variable "environment" {
  type    = string
  default = "ap-southeast-2"
}

variable "function_name" {
  description = "The name of the Lambda function"
  type        = string
}

variable "package_name" {
  description = "The name of the package to build (e.g., 'lambda-web-dist', 'upload-handler')"
  type        = string
}

variable "handler" {
  description = "The Lambda function handler (e.g., 'index.handler', 'lambda-web.handler')"
  type        = string
}

variable "execution_role_arn" {
  description = "The ARN of the IAM role that the Lambda function will assume"
  type        = string
}

variable "timeout" {
  description = "The timeout for the Lambda function in seconds"
  type        = number
  default     = 30
}

variable "environment_variables" {
  description = "Environment variables for the Lambda function"
  type        = map(string)
  default     = {}
}

variable "tags" {
  type = map(string)
}
