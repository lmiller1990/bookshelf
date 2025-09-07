# Domain and DNS Setup Guide

Complete guide for setting up a custom domain with your BookImg app using Terraform, Route 53, and third-party domain registrars like Namecheap.

## Overview

This guide shows how to transform your API Gateway URL from:
```
https://1fd9v08g3m.execute-api.ap-southeast-2.amazonaws.com/UAT
```

To a custom domain like:
```
https://uat.yourdomain.com  (UAT environment)
https://yourdomain.com      (Production environment)
```

## Architecture

### DNS Flow
```
Domain Registrar (Namecheap) → Route 53 Hosted Zone → API Gateway Custom Domain → Your Lambda Functions
```

### Certificate Management
- SSL/TLS certificates managed by AWS Certificate Manager (ACM)
- Automatic certificate validation via DNS
- Regional certificates for API Gateway v2

## Prerequisites

1. **Purchase Domain**: Buy your domain from Namecheap (or any registrar)
2. **AWS Access**: Ensure your `bookimg-deployer` profile has Route 53 permissions
3. **Terraform State**: Your existing Terraform setup is working

## Step-by-Step Implementation

### Phase 1: Domain Purchase and Planning

1. **Choose Your Domain Structure**
   ```
   yourdomain.com           # Production
   uat.yourdomain.com       # UAT environment  
   api.yourdomain.com       # API subdomain (alternative)
   ```

2. **Purchase Domain** at Namecheap
   - Buy the root domain (e.g., `bookimg.com`)
   - Don't configure DNS yet - we'll do this later

### Phase 2: Terraform Configuration

#### 2.1 Add DNS Variables

Add to your `terraform/main.tf`:

```hcl
variable "domain_name" {
  description = "Root domain name (e.g., bookimg.com)"
  type        = string
  default     = ""
}

variable "subdomain" {
  description = "Subdomain for this environment (e.g., uat)"
  type        = string
  default     = ""
}

locals {
  # Full domain for this environment
  full_domain = var.subdomain != "" ? "${var.subdomain}.${var.domain_name}" : var.domain_name
  use_custom_domain = var.domain_name != ""
}
```

#### 2.2 Create Route 53 Hosted Zone

Add to your `terraform/main.tf`:

```hcl
# Route 53 Hosted Zone (only if domain is specified)
resource "aws_route53_zone" "main" {
  count = local.use_custom_domain ? 1 : 0
  name  = var.domain_name

  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "DNS management"
  }
}
```

#### 2.3 SSL Certificate (us-east-1 for API Gateway)

Add provider for us-east-1 (required for API Gateway edge-optimized endpoints):

```hcl
# Provider for us-east-1 (required for CloudFront/API Gateway certificates)
provider "aws" {
  alias  = "virginia"
  region = "us-east-1"
  profile = "bookimg-deployer"
}

# SSL Certificate (must be in us-east-1 for API Gateway)
resource "aws_acm_certificate" "api_cert" {
  count    = local.use_custom_domain ? 1 : 0
  provider = aws.virginia

  domain_name       = local.full_domain
  validation_method = "DNS"

  subject_alternative_names = [
    "*.${var.domain_name}"  # Wildcard for all subdomains
  ]

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Environment = var.environment
    Project     = "BookImg"
    Purpose     = "API Gateway SSL"
  }
}

# Certificate validation records
resource "aws_route53_record" "api_cert_validation" {
  for_each = local.use_custom_domain ? {
    for dvo in aws_acm_certificate.api_cert[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.main[0].zone_id
}

# Certificate validation
resource "aws_acm_certificate_validation" "api_cert" {
  count                   = local.use_custom_domain ? 1 : 0
  provider                = aws.virginia
  certificate_arn         = aws_acm_certificate.api_cert[0].arn
  validation_record_fqdns = [for record in aws_route53_record.api_cert_validation : record.fqdn]

  timeouts {
    create = "5m"
  }
}
```

#### 2.4 API Gateway Custom Domain

Replace or modify your existing API Gateway configuration:

```hcl
# API Gateway Custom Domain
resource "aws_apigatewayv2_domain_name" "api_domain" {
  count       = local.use_custom_domain ? 1 : 0
  domain_name = local.full_domain

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.api_cert[0].certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  depends_on = [aws_acm_certificate_validation.api_cert]

  tags = {
    Environment = var.environment
    Project     = "BookImg"
  }
}

# API Mapping
resource "aws_apigatewayv2_api_mapping" "api_mapping" {
  count       = local.use_custom_domain ? 1 : 0
  api_id      = aws_apigatewayv2_api.web_api.id
  domain_name = aws_apigatewayv2_domain_name.api_domain[0].id
  stage       = aws_apigatewayv2_stage.web_stage.id
}

# Route 53 A record for the API
resource "aws_route53_record" "api" {
  count   = local.use_custom_domain ? 1 : 0
  zone_id = aws_route53_zone.main[0].zone_id
  name    = local.full_domain
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.api_domain[0].domain_name_configuration[0].target_domain_name
    zone_id               = aws_apigatewayv2_domain_name.api_domain[0].domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
```

#### 2.5 Update Outputs

Add new outputs to track DNS resources:

```hcl
# DNS-related outputs
output "hosted_zone_id" {
  value = local.use_custom_domain ? aws_route53_zone.main[0].zone_id : null
}

output "hosted_zone_name_servers" {
  value = local.use_custom_domain ? aws_route53_zone.main[0].name_servers : null
}

output "custom_domain_url" {
  value = local.use_custom_domain ? "https://${local.full_domain}" : null
}

output "certificate_arn" {
  value = local.use_custom_domain ? aws_acm_certificate_validation.api_cert[0].certificate_arn : null
}

output "domain_name" {
  value = local.use_custom_domain ? local.full_domain : null
}
```

### Phase 3: Deployment

#### 3.1 Deploy with Domain Configuration

Deploy your UAT environment with custom domain:

```bash
cd terraform

# Deploy with custom domain
terraform apply \
  -var="domain_name=yourdomain.com" \
  -var="subdomain=uat" \
  -var="environment=UAT"
```

#### 3.2 Get Route 53 Name Servers

After deployment, get the nameservers:

```bash
terraform output hosted_zone_name_servers
```

You'll see output like:
```
[
  "ns-1234.awsdns-12.org",
  "ns-5678.awsdns-34.net", 
  "ns-9012.awsdns-56.co.uk",
  "ns-3456.awsdns-78.com"
]
```

### Phase 4: Domain Registrar Configuration

#### 4.1 Configure Namecheap Nameservers

1. **Login to Namecheap**
   - Go to Domain List → Manage your domain

2. **Change Nameservers**
   - Select "Custom DNS" from the Nameservers dropdown
   - Enter all 4 nameservers from Terraform output:
     ```
     ns-1234.awsdns-12.org
     ns-5678.awsdns-34.net
     ns-9012.awsdns-56.co.uk
     ns-3456.awsdns-78.com
     ```

3. **Save Changes**
   - Click the green checkmark to save
   - DNS propagation takes 24-48 hours

#### 4.2 Verify DNS Propagation

Check DNS propagation status:

```bash
# Check nameservers
dig +short NS yourdomain.com

# Check A record (after propagation)
dig +short A uat.yourdomain.com

# Test SSL certificate
curl -I https://uat.yourdomain.com
```

## Environment-Specific Deployments

### UAT Environment
```bash
terraform apply \
  -var="domain_name=yourdomain.com" \
  -var="subdomain=uat" \
  -var="environment=UAT"

# Results in: https://uat.yourdomain.com
```

### Production Environment  
```bash
terraform apply \
  -var="domain_name=yourdomain.com" \
  -var="subdomain=" \
  -var="environment=PROD"

# Results in: https://yourdomain.com
```

## Best Practices

### Security
1. **Use Strong Security Policies**: TLS 1.2 minimum
2. **Certificate Lifecycle**: Auto-renewal with DNS validation
3. **IAM Permissions**: Least privilege for Route 53 access

### DNS Management
1. **Subdomain Strategy**: Use subdomains for environments
2. **TTL Values**: Short TTL (60s) for validation records
3. **Health Checks**: Consider Route 53 health checks for production

### Terraform Structure
1. **Conditional Resources**: Use `count` for optional domain resources
2. **Provider Aliases**: Separate provider for us-east-1
3. **Resource Dependencies**: Proper `depends_on` for certificate validation

### Monitoring
1. **CloudWatch Alarms**: Monitor certificate expiration
2. **Route 53 Metrics**: Track DNS query patterns
3. **API Gateway Logs**: Monitor custom domain usage

## Cost Considerations

- **Route 53 Hosted Zone**: ~$0.50/month per hosted zone
- **DNS Queries**: $0.40 per million queries
- **ACM Certificates**: Free for AWS services
- **API Gateway**: Same pricing as before

## Troubleshooting

### Common Issues

1. **Certificate Validation Timeout**
   ```bash
   # Check validation records exist
   dig +short TXT _validation.yourdomain.com
   ```

2. **DNS Not Resolving**
   ```bash
   # Check nameserver propagation
   dig +trace yourdomain.com
   ```

3. **SSL Certificate Issues**
   ```bash
   # Test certificate chain
   openssl s_client -connect uat.yourdomain.com:443 -servername uat.yourdomain.com
   ```

### Recovery Steps

1. **Import Existing Resources**
   ```bash
   # If hosted zone exists
   terraform import aws_route53_zone.main[0] Z1234567890ABC
   ```

2. **Certificate Issues**
   - Delete certificate validation records
   - Re-run terraform apply
   - Wait for DNS propagation

## Migration Strategy

### Phased Rollout

1. **Phase 1**: Deploy UAT environment with subdomain
2. **Phase 2**: Test thoroughly with custom domain  
3. **Phase 3**: Deploy production with root domain
4. **Phase 4**: Update all documentation and links

### Zero-Downtime Migration

1. Keep existing API Gateway URL active
2. Deploy custom domain in parallel
3. Test both endpoints
4. Gradually migrate traffic
5. Retire old endpoint after confirmation

## Maintenance

### Regular Tasks

1. **Monitor Certificate Expiration**: ACM handles renewal automatically
2. **DNS Health Checks**: Monitor resolution times
3. **Cost Optimization**: Review Route 53 query patterns
4. **Security Updates**: Keep security policies current

### Terraform Updates

1. **State Management**: Keep Terraform state secure
2. **Variable Management**: Use terraform.tfvars files
3. **Version Control**: Tag infrastructure changes
4. **Backup Strategy**: Regular state backups

## Next Steps

After successful domain setup:

1. **Update Documentation**: Update CLAUDE.md with new URLs
2. **SSL Monitoring**: Set up certificate expiration alerts
3. **Performance Testing**: Compare custom domain vs direct API Gateway
4. **CDN Integration**: Consider CloudFront for static assets
5. **Multiple Environments**: Replicate for staging, production

This setup provides a production-ready, scalable domain configuration that grows with your application needs.