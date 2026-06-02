/**
 * Built-in secret detection patterns.
 *
 * Vendored from `@daax/secrets-guard` (daax-dev/skills-marketplace,
 * `tools/secrets-guard/src/patterns/index.ts`). agent-handoff is published as a
 * standalone npm package and cannot take a runtime dependency on the
 * skills-marketplace repo, so the pattern definitions are vendored here. Keep in
 * sync with the upstream source.
 *
 * Patterns are organized by category and tuned for low false-positive rates.
 * Each pattern includes entropy thresholds where applicable.
 */

export type SecretSeverity = "critical" | "high" | "medium" | "low" | "info";

export type SecretCategory =
  | "api_key"
  | "oauth_token"
  | "jwt"
  | "private_key"
  | "certificate"
  | "password"
  | "connection_string"
  | "aws_credential"
  | "gcp_credential"
  | "azure_credential"
  | "github_token"
  | "generic_secret"
  | "env_var_leak"
  | "hardcoded_ip"
  | "spiffe_id";

export interface SecretPattern {
  id: string;
  name: string;
  description: string;
  category: SecretCategory;
  pattern: RegExp;
  severity: SecretSeverity;
  /** Minimum Shannon entropy of the matched value required to report. */
  entropyThreshold?: number;
  /** Keywords that must be present somewhere in the content for the pattern to apply. */
  keywords?: string[];
  /** Restrict to these file extensions (unused for agent-output scanning). */
  fileExtensions?: string[];
  /** Glob exclude patterns (unused for agent-output scanning). */
  excludePatterns?: string[];
  /** Pattern is prone to false positives; lowers confidence. */
  highFalsePositiveRisk?: boolean;
}

/** AWS credential patterns */
export const awsPatterns: SecretPattern[] = [
  {
    id: "aws-access-key-id",
    name: "AWS Access Key ID",
    description:
      "AWS Access Key ID (starts with AKIA, ABIA, ACCA, AGPA, AIDA, AIPA, AKIA, ANPA, ANVA, APKA, AROA, ASCA, ASIA)",
    category: "aws_credential",
    pattern:
      /\b(?:A3T[A-Z0-9]|AKIA|ABIA|ACCA|AGPA|AIDA|AIPA|AKIA|ANPA|ANVA|APKA|AROA|ASCA|ASIA)[A-Z0-9]{16}\b/g,
    severity: "critical",
  },
  {
    id: "aws-secret-access-key",
    name: "AWS Secret Access Key",
    description: "AWS Secret Access Key (40 character base64)",
    category: "aws_credential",
    pattern:
      /(?:aws_secret_access_key|aws_secret_key|secret_access_key|secretaccesskey)\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi,
    severity: "critical",
    entropyThreshold: 4.5,
  },
  {
    id: "aws-mws-key",
    name: "AWS MWS Key",
    description: "Amazon Marketplace Web Service key",
    category: "aws_credential",
    pattern: /amzn\.mws\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    severity: "critical",
  },
];

/** GCP credential patterns */
export const gcpPatterns: SecretPattern[] = [
  {
    id: "gcp-api-key",
    name: "GCP API Key",
    description: "Google Cloud Platform API key",
    category: "gcp_credential",
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
    severity: "critical",
  },
  {
    id: "gcp-oauth-id",
    name: "GCP OAuth Client ID",
    description: "Google OAuth 2.0 Client ID",
    category: "gcp_credential",
    pattern: /[0-9]+-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com/g,
    severity: "high",
  },
  {
    id: "gcp-service-account",
    name: "GCP Service Account Key",
    description: "Google Cloud Service Account private key",
    category: "gcp_credential",
    pattern: /"type"\s*:\s*"service_account"[\s\S]*?"private_key"\s*:/g,
    severity: "critical",
    fileExtensions: [".json"],
  },
];

/** Azure credential patterns */
export const azurePatterns: SecretPattern[] = [
  {
    id: "azure-storage-key",
    name: "Azure Storage Account Key",
    description: "Azure Storage Account access key",
    category: "azure_credential",
    pattern: /(?:AccountKey|azure[_-]?storage[_-]?key)\s*[=:]\s*['"]?([A-Za-z0-9/+=]{88})['"]?/gi,
    severity: "critical",
  },
  {
    id: "azure-connection-string",
    name: "Azure Connection String",
    description: "Azure service connection string with credentials",
    category: "azure_credential",
    pattern: /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[A-Za-z0-9/+=]+/gi,
    severity: "critical",
  },
  {
    id: "azure-client-secret",
    name: "Azure Client Secret",
    description: "Azure AD application client secret",
    category: "azure_credential",
    pattern:
      /(?:azure[_-]?client[_-]?secret|aad[_-]?client[_-]?secret)\s*[=:]\s*['"]?([A-Za-z0-9~._-]{34,})['"]?/gi,
    severity: "critical",
    entropyThreshold: 4.0,
  },
];

/** GitHub patterns */
export const githubPatterns: SecretPattern[] = [
  {
    id: "github-pat",
    name: "GitHub Personal Access Token",
    description: "GitHub personal access token (classic or fine-grained)",
    category: "github_token",
    pattern: /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59})\b/g,
    severity: "critical",
  },
  {
    id: "github-oauth",
    name: "GitHub OAuth Access Token",
    description: "GitHub OAuth access token",
    category: "github_token",
    pattern: /\bgho_[A-Za-z0-9]{36}\b/g,
    severity: "critical",
  },
  {
    id: "github-app-token",
    name: "GitHub App Token",
    description: "GitHub App installation or user-to-server token",
    category: "github_token",
    pattern: /\b(ghu_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9]{36})\b/g,
    severity: "critical",
  },
  {
    id: "github-refresh-token",
    name: "GitHub Refresh Token",
    description: "GitHub OAuth refresh token",
    category: "github_token",
    pattern: /\bghr_[A-Za-z0-9]{36}\b/g,
    severity: "critical",
  },
];

/** API key patterns (various services) */
export const apiKeyPatterns: SecretPattern[] = [
  {
    id: "stripe-secret-key",
    name: "Stripe Secret Key",
    description: "Stripe API secret key",
    category: "api_key",
    pattern: /\bsk_live_[A-Za-z0-9]{24,}\b/g,
    severity: "critical",
  },
  {
    id: "stripe-restricted-key",
    name: "Stripe Restricted Key",
    description: "Stripe restricted API key",
    category: "api_key",
    pattern: /\brk_live_[A-Za-z0-9]{24,}\b/g,
    severity: "critical",
  },
  {
    id: "slack-token",
    name: "Slack Token",
    description: "Slack bot, user, or workspace token",
    category: "api_key",
    // Suffix group is non-capturing (divergence from upstream): a capturing
    // group would become match[1] and cause SecretsScanner to treat only the
    // trailing segment as the secret, leaving the prefix unredacted.
    pattern: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}(?:-[A-Za-z0-9]{24,})?\b/g,
    severity: "critical",
  },
  {
    id: "slack-webhook",
    name: "Slack Webhook URL",
    description: "Slack incoming webhook URL",
    category: "api_key",
    pattern:
      /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{24}/g,
    severity: "high",
  },
  {
    id: "twilio-api-key",
    name: "Twilio API Key",
    description: "Twilio API key",
    category: "api_key",
    pattern: /\bSK[a-f0-9]{32}\b/g,
    severity: "critical",
  },
  {
    id: "sendgrid-api-key",
    name: "SendGrid API Key",
    description: "SendGrid API key",
    category: "api_key",
    pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g,
    severity: "critical",
  },
  {
    id: "mailchimp-api-key",
    name: "Mailchimp API Key",
    description: "Mailchimp API key",
    category: "api_key",
    pattern: /\b[a-f0-9]{32}-us[0-9]{1,2}\b/g,
    severity: "high",
    entropyThreshold: 3.5,
  },
  {
    id: "npm-token",
    name: "NPM Access Token",
    description: "NPM registry access token",
    category: "api_key",
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/g,
    severity: "critical",
  },
  {
    id: "pypi-token",
    name: "PyPI API Token",
    description: "Python Package Index API token",
    category: "api_key",
    pattern: /\bpypi-[A-Za-z0-9_-]{100,}\b/g,
    severity: "critical",
  },
  {
    id: "openai-api-key",
    name: "OpenAI API Key",
    description: "OpenAI API key (legacy sk- + 48 chars)",
    category: "api_key",
    pattern: /\bsk-[A-Za-z0-9]{48}\b/g,
    severity: "critical",
  },
  // Divergence from upstream secrets-guard: modern OpenAI project / service
  // account / admin keys carry a prefix and `-`/`_` payload chars the legacy
  // pattern above misses.
  {
    id: "openai-project-key",
    name: "OpenAI Project/Service-Account Key",
    description: "OpenAI project, service-account, or admin key (sk-proj-, sk-svcacct-, sk-admin-)",
    category: "api_key",
    pattern: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}\b/g,
    severity: "critical",
  },
  {
    id: "anthropic-api-key",
    name: "Anthropic API Key",
    description: "Anthropic (Claude) API key",
    category: "api_key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{95,}\b/g,
    severity: "critical",
  },
  {
    id: "datadog-api-key",
    name: "Datadog API Key",
    description: "Datadog API key",
    category: "api_key",
    pattern: /(?:datadog[_-]?api[_-]?key|dd[_-]?api[_-]?key)\s*[=:]\s*['"]?([a-f0-9]{32})['"]?/gi,
    severity: "high",
  },
  {
    id: "heroku-api-key",
    name: "Heroku API Key",
    description: "Heroku API key",
    category: "api_key",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
    severity: "medium",
    keywords: ["heroku", "HEROKU_API_KEY"],
    highFalsePositiveRisk: true,
  },
];

/** Private key patterns */
export const privateKeyPatterns: SecretPattern[] = [
  {
    id: "rsa-private-key",
    name: "RSA Private Key",
    description: "RSA private key in PEM format",
    category: "private_key",
    pattern: /-----BEGIN RSA PRIVATE KEY-----[\s\S]*?-----END RSA PRIVATE KEY-----/g,
    severity: "critical",
  },
  {
    id: "openssh-private-key",
    name: "OpenSSH Private Key",
    description: "OpenSSH private key",
    category: "private_key",
    pattern: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
    severity: "critical",
  },
  {
    id: "ec-private-key",
    name: "EC Private Key",
    description: "Elliptic curve private key",
    category: "private_key",
    pattern: /-----BEGIN EC PRIVATE KEY-----[\s\S]*?-----END EC PRIVATE KEY-----/g,
    severity: "critical",
  },
  {
    id: "dsa-private-key",
    name: "DSA Private Key",
    description: "DSA private key",
    category: "private_key",
    pattern: /-----BEGIN DSA PRIVATE KEY-----[\s\S]*?-----END DSA PRIVATE KEY-----/g,
    severity: "critical",
  },
  {
    id: "pgp-private-key",
    name: "PGP Private Key Block",
    description: "PGP private key block",
    category: "private_key",
    pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/g,
    severity: "critical",
  },
  {
    id: "encrypted-private-key",
    name: "Encrypted Private Key",
    description: "PKCS#8 encrypted private key",
    category: "private_key",
    pattern: /-----BEGIN ENCRYPTED PRIVATE KEY-----[\s\S]*?-----END ENCRYPTED PRIVATE KEY-----/g,
    severity: "high",
  },
  // Divergence from upstream secrets-guard: the common unencrypted PKCS#8 PEM
  // (`-----BEGIN PRIVATE KEY-----`) was missing. It also covers the private_key
  // value embedded in a GCP service-account JSON, so that value is redacted.
  {
    id: "pkcs8-private-key",
    name: "PKCS#8 Private Key",
    description: "Unencrypted PKCS#8 private key in PEM format",
    category: "private_key",
    pattern: /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g,
    severity: "critical",
  },
];

/** JWT and OAuth patterns */
export const authPatterns: SecretPattern[] = [
  {
    id: "jwt-token",
    name: "JSON Web Token",
    description: "JWT token (may contain sensitive claims)",
    category: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\b/g,
    severity: "medium",
    highFalsePositiveRisk: true,
  },
  {
    id: "bearer-token",
    name: "Bearer Token",
    description: "Authorization Bearer token",
    category: "oauth_token",
    // Divergence from upstream: also matches a standalone `Bearer <token>` (the
    // upstream pattern required an `Authorization:`/`Bearer:` prefix first and
    // missed the common bare form). Captures the token so redaction targets it.
    pattern: /\bBearer\s+['"]?([A-Za-z0-9._~+/=-]{20,})['"]?/gi,
    severity: "high",
    entropyThreshold: 4.0,
  },
  {
    id: "oauth-client-secret",
    name: "OAuth Client Secret",
    description: "OAuth 2.0 client secret",
    category: "oauth_token",
    pattern: /(?:client_secret|oauth[_-]?secret)\s*[=:]\s*['"]?([A-Za-z0-9_-]{32,})['"]?/gi,
    severity: "critical",
    entropyThreshold: 4.0,
  },
];

/** Database and connection string patterns */
export const connectionPatterns: SecretPattern[] = [
  {
    id: "postgres-connection",
    name: "PostgreSQL Connection String",
    description: "PostgreSQL connection string with credentials",
    category: "connection_string",
    pattern: /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^/]+/gi,
    severity: "critical",
  },
  {
    id: "mysql-connection",
    name: "MySQL Connection String",
    description: "MySQL connection string with credentials",
    category: "connection_string",
    pattern: /mysql:\/\/[^:]+:[^@]+@[^/]+/gi,
    severity: "critical",
  },
  {
    id: "mongodb-connection",
    name: "MongoDB Connection String",
    description: "MongoDB connection string with credentials",
    category: "connection_string",
    pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@[^/]+/gi,
    severity: "critical",
  },
  {
    id: "redis-connection",
    name: "Redis Connection String",
    description: "Redis connection string with credentials",
    category: "connection_string",
    pattern: /redis:\/\/[^:]*:[^@]+@[^/]+/gi,
    severity: "critical",
  },
  {
    id: "jdbc-connection",
    name: "JDBC Connection String",
    description: "JDBC connection string with credentials",
    category: "connection_string",
    pattern: /jdbc:[a-z]+:\/\/[^:]+:[^@]+@[^/]+/gi,
    severity: "critical",
  },
];

/** Generic password patterns */
export const passwordPatterns: SecretPattern[] = [
  {
    id: "password-assignment",
    name: "Password Assignment",
    description: "Variable assignment containing password",
    category: "password",
    pattern: /(?:password|passwd|pwd|secret)\s*[=:]\s*['"]([^'"]{8,})['"](?!\s*[<>])/gi,
    severity: "high",
    entropyThreshold: 3.5,
    excludePatterns: ["*.test.*", "*.spec.*", "*mock*", "*example*", "*placeholder*"],
  },
  {
    id: "basic-auth-header",
    name: "Basic Auth Header",
    description: "HTTP Basic Authentication header",
    category: "password",
    pattern: /Basic\s+[A-Za-z0-9+/=]{10,}/gi,
    severity: "high",
  },
];

/** Environment variable leak patterns */
export const envVarPatterns: SecretPattern[] = [
  {
    id: "env-file-secret",
    name: "Env File Secret",
    description: "Secret in .env file format",
    category: "env_var_leak",
    pattern: /^(?:SECRET|API_KEY|TOKEN|PASSWORD|PRIVATE_KEY|AUTH)[A-Z_]*\s*=\s*['"]?([^'"\n]{8,})['"]?$/gim,
    severity: "high",
    fileExtensions: [".env", ".env.local", ".env.production", ".env.development"],
    entropyThreshold: 3.5,
  },
  {
    id: "hardcoded-process-env",
    name: "Hardcoded Process Env",
    description: "process.env with inline fallback secret",
    category: "env_var_leak",
    pattern: /process\.env\.[A-Z_]+\s*\|\|\s*['"]([^'"]{16,})['"]/g,
    severity: "medium",
    entropyThreshold: 4.0,
    fileExtensions: [".js", ".ts", ".jsx", ".tsx"],
  },
];

/** Generic high-entropy secret patterns (last resort) */
export const genericPatterns: SecretPattern[] = [
  {
    id: "generic-api-key",
    name: "Generic API Key",
    description: "Generic pattern matching common API key formats",
    category: "generic_secret",
    pattern: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[=:]\s*['"]?([A-Za-z0-9_-]{20,})['"]?/gi,
    severity: "medium",
    entropyThreshold: 4.0,
    highFalsePositiveRisk: true,
  },
  {
    id: "generic-secret",
    name: "Generic Secret",
    description: "Generic pattern for secret-like variables",
    category: "generic_secret",
    pattern: /(?:secret|token|credential|auth)[_-]?(?:key|value|token)?\s*[=:]\s*['"]?([A-Za-z0-9_-]{24,})['"]?/gi,
    severity: "low",
    entropyThreshold: 4.5,
    highFalsePositiveRisk: true,
  },
  {
    id: "hex-secret-32",
    name: "Hex Secret (32 chars)",
    description: "32-character hex string that may be a secret",
    category: "generic_secret",
    pattern: /\b[a-f0-9]{32}\b/gi,
    severity: "low",
    entropyThreshold: 3.5,
    highFalsePositiveRisk: true,
    keywords: ["key", "secret", "token", "auth", "api"],
  },
  {
    id: "hex-secret-64",
    name: "Hex Secret (64 chars)",
    description: "64-character hex string that may be a secret",
    category: "generic_secret",
    pattern: /\b[a-f0-9]{64}\b/gi,
    severity: "low",
    entropyThreshold: 3.5,
    highFalsePositiveRisk: true,
    keywords: ["key", "secret", "token", "auth", "hash"],
  },
];

/** All built-in patterns combined */
export const allPatterns: SecretPattern[] = [
  ...awsPatterns,
  ...gcpPatterns,
  ...azurePatterns,
  ...githubPatterns,
  ...apiKeyPatterns,
  ...privateKeyPatterns,
  ...authPatterns,
  ...connectionPatterns,
  ...passwordPatterns,
  ...envVarPatterns,
  ...genericPatterns,
];
