locals {
  resource_prefix = "bookimg-${lower(var.environment)}"
  s3_bucket_name  = local.resource_prefix
  repo_root       = "${path.module}/../.."
  deploy_dir     = "${local.repo_root}/.deploy/${var.package_name}"
}

resource "aws_lambda_function" "web_lambda" {
  filename         = data.archive_file.web_lambda.output_path
  source_code_hash = data.archive_file.web_lambda.output_base64sha256
  function_name    = var.function_name
  role             = var.execution_role_arn
  handler          = var.handler
  runtime          = "nodejs20.x"
  timeout          = 30

  tags = var.tags
}

data "archive_file" "web_lambda" {
  type        = "zip"
  source_dir  = local.deploy_dir
  output_path = "${path.module}/web_lambda.zip"

  depends_on  = [null_resource.build_web_lambda]
}

resource "null_resource" "build_web_lambda" {
  provisioner "local-exec" {
    command = <<-EOT
      set -euo pipefail
      echo "Building ${var.function_name}..."
      cd ${local.repo_root}
      pnpm --filter=${var.package_name} build
      echo "Deploying to ${local.deploy_dir}..."
      rm -rf ${local.deploy_dir}
      pnpm --filter=${var.package_name} deploy --prod ${local.deploy_dir}
      echo "${var.function_name} build complete"
    EOT
  }
}