# The declared structure of Chain of Custody (D8). Keys, the database root
# password, secret ids and stored documents are runtime state: Ansible
# creates them and the story turns them, so a plan after a full show is empty.

# ── Audit: every node writes its own file on its own volume ──────────────────
resource "vault_audit" "file" {
  type        = "file"
  path        = "file"
  description = "The custody log"
  options = {
    file_path     = "/vault/audit/audit.log"
    mode          = "0640" # gid 1000: the console reads it
    hmac_accessor = "true"
  }
}

# ── SPIFFE: one trust domain, one role per workload (D10, probe P2) ──────────
resource "vault_mount" "spiffe" {
  path        = "spiffe"
  type        = "spiffe"
  description = "JWT-SVIDs for the workloads"
}

resource "vault_spiffe_secret_backend_config" "this" {
  mount                 = vault_mount.spiffe.path
  trust_domain          = local.cfg.trust_domain
  jwt_signing_algorithm = "ES256"
  # The default issuer is the active node's address and moves with the
  # leader (probe P2): pin it.
  jwt_issuer_url      = local.issuer
  key_lifetime        = "24h"
  bundle_refresh_hint = "1h"
}

# Not vault_spiffe_secret_backend_role: provider 5.13.0 requires a unit in
# `ttl` ("60s") and reads back "60", then fails "inconsistent result after
# apply" on every role (2026-11-11). The generic endpoint compares what Vault
# returns.
removed {
  from = vault_spiffe_secret_backend_role.workload
  lifecycle {
    destroy = false
  }
}

resource "vault_generic_endpoint" "spiffe_role" {
  for_each             = local.workloads
  path                 = "${vault_mount.spiffe.path}/role/${each.key}"
  ignore_absent_fields = true
  data_json = jsonencode({
    template      = jsonencode({ sub = each.value.spiffe_path })
    ttl           = "60"
    use_jti_claim = true
  })
  depends_on = [vault_spiffe_secret_backend_config.this]
}

# ── Transit: the mount only; the collection keys are Ansible's (D8) ──────────
resource "vault_mount" "transit" {
  path        = "transit"
  type        = "transit"
  description = "Key encryption keys, one per collection"
}

# ── Secret zero: one AppRole per workload, bound to its address (D9, P6) ─────
resource "vault_auth_backend" "approle" {
  type        = "approle"
  path        = "approle"
  description = "One identity per workload"
}

resource "vault_approle_auth_backend_role" "workload" {
  for_each              = local.workloads
  backend               = vault_auth_backend.approle.path
  role_name             = "vpip-${each.key}"
  token_policies        = ["default", vault_policy.workload[each.key].name]
  token_period          = 3600
  token_bound_cidrs     = ["${each.value.address}/32"]
  secret_id_bound_cidrs = ["${each.value.address}/32"]
  secret_id_num_uses    = 1
  secret_id_ttl         = 600
}

# ── The database: the keeper's credential (D12, probe P7) ────────────────────
resource "vault_mount" "database" {
  path        = "database"
  type        = "database"
  description = "PostgreSQL credentials for the keeper"
}

resource "vault_database_secret_backend_connection" "pipeline" {
  backend           = vault_mount.database.path
  name              = "pipeline"
  allowed_roles     = ["keeper"]
  verify_connection = false # Postgres starts later (phase data-up)
  postgresql {
    connection_url          = "postgresql://{{username}}:{{password}}@postgres:5432/pipeline?sslmode=disable"
    username                = "postgres"
    password_wo             = var.pg_bootstrap_password
    password_wo_version     = var.pg_password_version
    password_authentication = "scram-sha-256"
  }
}

resource "vault_database_secret_backend_role" "keeper" {
  backend               = vault_mount.database.path
  name                  = "keeper"
  db_name               = vault_database_secret_backend_connection.pipeline.name
  creation_statements   = [trimspace(file("${path.module}/sql/keeper-create.sql"))]
  revocation_statements = [trimspace(file("${path.module}/sql/keeper-revoke.sql"))]
  default_ttl           = 3600
  max_ttl               = 14400
}

# ── People: Keycloak through JWT auth, groups from the signed claim (D13) ────
resource "vault_jwt_auth_backend" "keycloak" {
  path         = "jwt"
  type         = "jwt"
  description  = "Keycloak realm pipeline: the people"
  jwks_url     = var.keycloak_jwks_url
  bound_issuer = var.keycloak_issuer
  tune {
    default_lease_ttl = "2m"
    max_lease_ttl     = "2m"
    token_type        = "default-service"
  }
}

# One question per login: 120 s, usable only from the console (which logs the
# person in and revokes the token) and the librarian (which decrypts with it).
resource "vault_jwt_auth_backend_role" "person" {
  backend           = vault_jwt_auth_backend.keycloak.path
  role_name         = "person"
  role_type         = "jwt"
  user_claim        = "preferred_username"
  groups_claim      = "groups"
  bound_audiences   = ["pipeline-console"]
  token_policies    = ["default"]
  token_ttl         = 120
  token_max_ttl     = 120
  token_bound_cidrs = local.person_cidrs
  claim_mappings    = { azp = "client" }
}

resource "vault_identity_group" "reader" {
  for_each = local.collections
  name     = each.value.reader_group
  type     = "external"
  policies = [vault_policy.reader[each.key].name]
  metadata = { collection = each.key }
}

resource "vault_identity_group_alias" "reader" {
  for_each       = local.collections
  name           = each.value.reader_group
  mount_accessor = vault_jwt_auth_backend.keycloak.accessor
  canonical_id   = vault_identity_group.reader[each.key].id
}

# ── Policies ─────────────────────────────────────────────────────────────────
resource "vault_policy" "workload" {
  for_each = local.workloads
  name     = "vpip-wl-${each.key}"
  policy   = templatefile("${path.module}/policies/${each.key}.hcl.tftpl", { collections = keys(local.collections) })
}

resource "vault_policy" "reader" {
  for_each = local.collections
  name     = "vpip-read-${each.key}"
  policy   = <<-EOT
    # A person in ${each.value.reader_group} may open ${each.key}'s data keys, nothing else.
    path "transit/decrypt/${each.key}" {
      capabilities = ["update"]
    }
  EOT
}
