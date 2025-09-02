# Lambda Module

A reusable Terraform module for deploying AWS Lambda functions with automatic build and deployment pipeline.

## Overview

This module provides a standardized way to deploy Lambda functions with:
- Automatic building using pnpm workspaces
- Configurable timeouts and environment variables
- Consistent naming and tagging
- Integration with your existing IAM roles

## Usage

```hcl
module "my_lambda" {
  source = "./lambdas"
  
  function_name      = "${local.resource_prefix}-my-function"
  package_name       = "my-lambda-package"
  handler           = "index.handler"
  execution_role_arn = aws_iam_role.lambda_execution_role.arn
  environment       = var.environment
  timeout           = 120
  
  environment_variables = {
    DATABASE_URL = var.database_url
    API_KEY      = var.api_key
  }
  
  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "My Lambda function"
  }
}
```

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| function_name | The name of the Lambda function | `string` | n/a | yes |
| package_name | The name of the package to build (pnpm workspace name) | `string` | n/a | yes |
| handler | The Lambda function handler (e.g., 'index.handler') | `string` | n/a | yes |
| execution_role_arn | The ARN of the IAM role that the Lambda function will assume | `string` | n/a | yes |
| environment | Environment name (used in resource naming) | `string` | n/a | yes |
| tags | A map of tags to assign to the Lambda function | `map(string)` | n/a | yes |
| timeout | The timeout for the Lambda function in seconds | `number` | `30` | no |
| environment_variables | Environment variables for the Lambda function | `map(string)` | `{}` | no |

## Outputs

| Name | Description |
|------|-------------|
| function_name | The name of the Lambda function |
| function_arn | The ARN of the Lambda function |
| invoke_arn | The invoke ARN of the Lambda function |

## Build Process

The module automatically:

1. **Builds** the package using `pnpm --filter=${package_name} build`
2. **Deploys** production dependencies using `pnpm --filter=${package_name} deploy --prod`
3. **Packages** the deployment into a ZIP file
4. **Uploads** to Lambda with source code hash for change detection

## Requirements

### Project Structure
Your project must use pnpm workspaces with packages that support:
- `pnpm build` command
- `pnpm deploy --prod <target-dir>` command

### Example Package Structure
```
packages/
  my-lambda-package/
    src/
      index.ts          # Your Lambda code
    package.json        # Must have "build" and "deploy" scripts
    tsconfig.json       # TypeScript configuration
```

### Package.json Example
```json
{
  "name": "my-lambda-package",
  "scripts": {
    "build": "tsc",
    "deploy": "pnpm pack --pack-destination"
  },
  "dependencies": {
    "@aws-sdk/client-lambda": "^3.0.0"
  }
}
```

## Examples

### Basic Lambda
```hcl
module "simple_lambda" {
  source = "./lambdas"
  
  function_name      = "my-simple-function"
  package_name       = "simple-handler"
  handler           = "index.handler"
  execution_role_arn = aws_iam_role.lambda_role.arn
  environment       = "prod"
  
  tags = {
    Environment = "prod"
    Project     = "MyProject"
  }
}
```

### Lambda with Environment Variables and Custom Timeout
```hcl
module "api_lambda" {
  source = "./lambdas"
  
  function_name      = "api-handler"
  package_name       = "api-service"
  handler           = "app.handler"
  execution_role_arn = aws_iam_role.api_role.arn
  environment       = "prod"
  timeout           = 300  # 5 minutes
  
  environment_variables = {
    DATABASE_URL     = var.database_url
    REDIS_URL        = var.redis_url
    LOG_LEVEL        = "info"
    FEATURE_FLAGS    = jsonencode(var.feature_flags)
  }
  
  tags = {
    Environment = "prod"
    Project     = "MyProject"
    Service     = "API"
  }
}
```

### Using Module Outputs
```hcl
# Use the Lambda with API Gateway
resource "aws_apigatewayv2_integration" "lambda_integration" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = module.my_lambda.invoke_arn
}

# Grant permissions
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.my_lambda.function_name
  principal     = "apigateway.amazonaws.com"
}

# Use in SQS event source mapping
resource "aws_lambda_event_source_mapping" "queue_trigger" {
  event_source_arn = aws_sqs_queue.my_queue.arn
  function_name    = module.my_lambda.function_arn
  batch_size       = 10
}
```

## Runtime Configuration

The module is currently configured for:
- **Runtime**: `nodejs20.x`
- **Architecture**: Default (x86_64)
- **Memory**: 128 MB (default)

To customize these settings, modify the `aws_lambda_function` resource in `main.tf`.

## Troubleshooting

### Common Issues

**Build Failures**
- Ensure your package has `build` and `deploy` scripts in `package.json`
- Check that pnpm workspace is properly configured
- Verify package dependencies are correctly specified

**Permission Errors**
- Ensure the `execution_role_arn` has the necessary permissions
- Check that the IAM role trusts the Lambda service

**Deployment Failures**
- Verify the `handler` path matches your exported function
- Check package size limits (250MB unzipped)
- Ensure all dependencies are included in the deployment

### Debug Outputs
Check the Terraform plan output for build paths and package information.

## Contributing

When modifying this module:
1. Update this README if adding new variables or outputs
2. Test with multiple Lambda functions to ensure reusability
3. Follow Terraform best practices for module design