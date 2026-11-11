variable "vault_addr" {
  description = "The cluster on a published loopback port (scripts/tf.sh)."
  type        = string
}

variable "vault_cacert" {
  description = "The lab CA chain (vault-tls/ca-chain.pem)."
  type        = string
}

variable "keycloak_issuer" {
  description = "The issuer in the people's tokens: Keycloak's browser-facing URL."
  type        = string
}

variable "keycloak_jwks_url" {
  description = "Where Vault fetches the realm's signing keys (inside vpip-internal)."
  type        = string
}

variable "pg_bootstrap_password" {
  description = "Postgres's bootstrap password (.secrets/data/pg-bootstrap), written once and never stored: Ansible rotates it away (D8)."
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "pg_password_version" {
  description = "Bump to send pg_bootstrap_password again (after a database rebuild)."
  type        = number
  default     = 1
}
