/**
 * Best-effort AWS ARN parser. ARN formats:
 *   arn:partition:service:region:account-id:resource
 *   arn:partition:service:region:account-id:resource-type/resource-id
 *   arn:partition:service:region:account-id:resource-type:resource-id
 *
 * Some IAM resources omit the region segment but the parser tolerates that
 * because we still split on `:` and handle missing fields as empty strings.
 */
export interface ParsedArn {
  partition: string;
  service: string;
  region: string;
  accountId: string;
  resource: string;
  resourceType: string | null;
  resourceId: string;
}

const EMPTY_PARSED: ParsedArn = {
  partition: '',
  service: '',
  region: '',
  accountId: '',
  resource: '',
  resourceType: null,
  resourceId: '',
};

export function parseAwsArn(arn: string | null | undefined): ParsedArn | null {
  if (!arn || typeof arn !== 'string') return null;
  if (!arn.startsWith('arn:')) return null;

  const segments = arn.split(':');
  if (segments.length < 6) return null;

  const [, partition, service, region, accountId, ...resourceParts] = segments;
  const resource = resourceParts.join(':');

  let resourceType: string | null = null;
  let resourceId = resource;

  // Prefer slash-separated type/id (common: role/MyRole, policy/MyPolicy).
  const slashIdx = resource.indexOf('/');
  if (slashIdx > -1) {
    resourceType = resource.slice(0, slashIdx);
    resourceId = resource.slice(slashIdx + 1);
  } else if (resourceParts.length > 1) {
    resourceType = resourceParts[0];
    resourceId = resourceParts.slice(1).join(':');
  }

  return {
    ...EMPTY_PARSED,
    partition,
    service,
    region,
    accountId,
    resource,
    resourceType,
    resourceId,
  };
}

const SERVICE_LABELS: Record<string, string> = {
  iam: 'IAM',
  s3: 'S3',
  ec2: 'EC2',
  ecr: 'ECR',
  ecs: 'ECS',
  eks: 'EKS',
  lambda: 'Lambda',
  rds: 'RDS',
  dynamodb: 'DynamoDB',
  sns: 'SNS',
  sqs: 'SQS',
  cloudfront: 'CloudFront',
  cloudwatch: 'CloudWatch',
  cloudtrail: 'CloudTrail',
  kms: 'KMS',
  secretsmanager: 'Secrets Manager',
  ssm: 'SSM',
  organizations: 'Organizations',
  sts: 'STS',
  apigateway: 'API Gateway',
  route53: 'Route 53',
  glue: 'Glue',
  athena: 'Athena',
  redshift: 'Redshift',
  cloudformation: 'CloudFormation',
};

export function awsServiceLabel(arn: string | null | undefined, fallback = ''): string {
  const parsed = parseAwsArn(arn);
  if (!parsed) return fallback;
  return SERVICE_LABELS[parsed.service] || parsed.service.toUpperCase() || fallback;
}

export function awsResourceTypeLabel(arn: string | null | undefined, fallback = ''): string {
  const parsed = parseAwsArn(arn);
  if (!parsed || !parsed.resourceType) return fallback;
  // Title-case singular AWS resource types (role, policy, user, group, bucket, function...)
  const t = parsed.resourceType;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function awsResourceShortName(arn: string | null | undefined, fallback = ''): string {
  const parsed = parseAwsArn(arn);
  if (!parsed) return fallback;
  return parsed.resourceId || parsed.resource || fallback;
}

/** Keys used to join graph nodes with findings-based risk scores. */
export function canonicalRiskLookupKeys(arn?: string | null, name?: string | null): string[] {
  const keys = new Set<string>();
  const arnTrim = (arn || '').trim().toLowerCase();
  const nameTrim = (name || '').trim().toLowerCase();

  if (arnTrim) {
    keys.add(arnTrim);
    const arnResource = awsResourceShortName(arnTrim, '');
    if (arnResource) keys.add(arnResource.toLowerCase());
  }
  if (nameTrim) {
    keys.add(nameTrim);
    if (nameTrim.startsWith('arn:')) {
      const nameResource = awsResourceShortName(nameTrim, '');
      if (nameResource) keys.add(nameResource.toLowerCase());
    }
  }
  return Array.from(keys).filter(Boolean);
}
