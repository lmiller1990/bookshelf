output "function_name" {
  description = "The name of the Lambda function"
  value       = aws_lambda_function.web_lambda.function_name
}

output "function_arn" {
  description = "The ARN of the Lambda function"
  value       = aws_lambda_function.web_lambda.arn
}

output "invoke_arn" {
  description = "The invoke ARN of the Lambda function"
  value       = aws_lambda_function.web_lambda.invoke_arn
}