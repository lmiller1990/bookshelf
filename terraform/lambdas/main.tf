locals {
  resource_prefix = "bookimg-${lower(var.environment)}"
  s3_bucket_name  = local.resource_prefix
  # absolute path to this module
  module_dir = abspath(path.module)
  deploy_dir = "${local.module_dir}/deploy/${var.package_name}"
  zip_path   = "${local.module_dir}/build/${var.package_name}.zip"
}

resource "null_resource" "build_web_lambda" {
  triggers = {
    package_name  = var.package_name
    function_name = var.function_name
    always_run    = timestamp()
  }

  provisioner "local-exec" {
    interpreter = ["/bin/bash", "-lc"]
    command     = <<-EOT
    set -euo pipefail
    MODULE_DIR="${local.module_dir}"
    DEPLOY_DIR="${local.deploy_dir}"
    PKG="${var.package_name}"
    FUNC="${var.function_name}"

    echo "Building ${var.function_name}..."
    cd "${local.module_dir}/.."
    pnpm --filter="${var.package_name}" build

    echo "Deploying to $DEPLOY_DIR..."
    mkdir -p "$DEPLOY_DIR"
    rm -rf "$DEPLOY_DIR"/*

    pnpm --filter="$PKG" deploy --prod "$DEPLOY_DIR"
    test "$(ls -A "$DEPLOY_DIR")"
    echo "$FUNC build complete"
  EOT
  }
}

data "archive_file" "web_lambda" {
  type       = "zip"
  source_dir = local.deploy_dir
  # write the zip OUTSIDE the source_dir to avoid self-inclusion and empties
  output_path = local.zip_path

  depends_on = [null_resource.build_web_lambda]
}

resource "aws_lambda_function" "web_lambda" {
  filename         = data.archive_file.web_lambda.output_path
  source_code_hash = data.archive_file.web_lambda.output_base64sha256
  function_name    = var.function_name
  role             = var.execution_role_arn
  handler          = var.handler
  runtime          = "nodejs20.x"
  timeout          = var.timeout

  dynamic "environment" {
    for_each = length(var.environment_variables) > 0 ? [1] : []
    content { variables = var.environment_variables }
  }

  tags = var.tags
}
