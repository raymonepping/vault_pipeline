# vpip-tf-platform: Terraform root vault-platform on the cluster (D7, prompt 04).
# Declared, plannable structure: audit devices, the spiffe/, transit/ and
# database/ mounts, the SPIFFE config and roles, the database connection and
# role, AppRole and JWT auth, external groups and their aliases, the vpip-wl-*
# and vpip-read-* ACL policies.
# It may NOT use any of it: no data keys, no decrypt, no SVIDs, no database
# credentials, no secret-ids, no keys (D8: keys are runtime state, Ansible's).
# Written complete in prompt 02: after root revocation nothing can widen it
# (make root-regen CLUSTER=vault is the user's deliberate act).

# ── Mounts ───────────────────────────────────────────────────────────────────
path "sys/mounts" { capabilities = ["read"] }
path "sys/mounts/spiffe" { capabilities = ["create", "read", "update", "delete"] }
path "sys/mounts/transit" { capabilities = ["create", "read", "update", "delete"] }
path "sys/mounts/database" { capabilities = ["create", "read", "update", "delete"] }
path "sys/mounts/spiffe/tune" { capabilities = ["read", "update"] }
path "sys/mounts/transit/tune" { capabilities = ["read", "update"] }
path "sys/mounts/database/tune" { capabilities = ["read", "update"] }

# ── SPIFFE: the trust domain and one role per workload (D10) ─────────────────
path "spiffe/config" { capabilities = ["create", "read", "update"] }
path "spiffe/role" { capabilities = ["list"] }
path "spiffe/role/*" { capabilities = ["create", "read", "update", "delete"] }

# ── Database: the connection (password_wo) and the keeper's role (D12) ───────
path "database/config/pipeline" { capabilities = ["create", "read", "update", "delete"] }
path "database/roles/keeper" { capabilities = ["create", "read", "update", "delete"] }

# ── Audit (sudo: Vault requires it on sys/audit/*) ───────────────────────────
path "sys/audit" { capabilities = ["read", "sudo"] }
path "sys/audit/file" { capabilities = ["create", "read", "update", "delete", "sudo"] }

# ── Auth methods (enable/disable need sudo) ──────────────────────────────────
path "sys/auth" { capabilities = ["read"] }
path "sys/auth/jwt" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "sys/auth/approle" { capabilities = ["create", "read", "update", "delete", "sudo"] }
# The provider reads an auth mount through sys/mounts/auth/<path>.
path "sys/mounts/auth/jwt" { capabilities = ["read"] }
path "sys/mounts/auth/approle" { capabilities = ["read"] }
# Tuning an auth mount needs sudo (vault_dance, vault_codex).
path "sys/mounts/auth/jwt/tune" { capabilities = ["read", "update", "sudo"] }
path "sys/mounts/auth/approle/tune" { capabilities = ["read", "update", "sudo"] }
path "sys/auth/jwt/tune" { capabilities = ["read", "update", "sudo"] }
path "sys/auth/approle/tune" { capabilities = ["read", "update", "sudo"] }
path "auth/jwt/config" { capabilities = ["create", "read", "update", "delete"] }
path "auth/jwt/role/*" { capabilities = ["create", "read", "update", "delete", "list"] }
# One role per workload, named: a trailing glob would also match <role>/secret-id.
path "auth/approle/role/vpip-scribe" { capabilities = ["create", "read", "update", "delete"] }
path "auth/approle/role/vpip-scribe/role-id" { capabilities = ["read"] }
path "auth/approle/role/vpip-keeper" { capabilities = ["create", "read", "update", "delete"] }
path "auth/approle/role/vpip-keeper/role-id" { capabilities = ["read"] }
path "auth/approle/role/vpip-librarian" { capabilities = ["create", "read", "update", "delete"] }
path "auth/approle/role/vpip-librarian/role-id" { capabilities = ["read"] }
path "auth/approle/role/vpip-console" { capabilities = ["create", "read", "update", "delete"] }
path "auth/approle/role/vpip-console/role-id" { capabilities = ["read"] }
path "auth/approle/role/vpip-intruder" { capabilities = ["create", "read", "update", "delete"] }
path "auth/approle/role/vpip-intruder/role-id" { capabilities = ["read"] }

# ── Identity: external groups and their aliases on jwt/ ──────────────────────
path "identity/group" { capabilities = ["create", "update"] }
path "identity/group/id/*" { capabilities = ["create", "read", "update", "delete"] }
path "identity/group/name/*" { capabilities = ["create", "read", "update", "delete"] }
path "identity/group-alias" { capabilities = ["create", "update"] }
path "identity/group-alias/id/*" { capabilities = ["create", "read", "update", "delete"] }
path "identity/lookup/group" { capabilities = ["update"] }

# ── Policies: the story's vpip-wl-* and vpip-read-* ACLs only ────────────────
path "sys/policies/acl" { capabilities = ["list"] }
path "sys/policies/acl/vpip-wl-*" { capabilities = ["create", "read", "update", "delete"] }
path "sys/policies/acl/vpip-read-*" { capabilities = ["create", "read", "update", "delete"] }

# ── The provider ─────────────────────────────────────────────────────────────
path "auth/token/create" { capabilities = ["update"] }
path "sys/license/status" { capabilities = ["read"] }

# ── Never ────────────────────────────────────────────────────────────────────
path "transit/keys/*" { capabilities = ["deny"] }
path "transit/encrypt/*" { capabilities = ["deny"] }
path "transit/decrypt/*" { capabilities = ["deny"] }
path "transit/rewrap/*" { capabilities = ["deny"] }
path "transit/datakey/*" { capabilities = ["deny"] }
path "spiffe/role/+/mintjwt" { capabilities = ["deny"] }
path "database/creds/*" { capabilities = ["deny"] }
path "database/rotate-root/*" { capabilities = ["deny"] }
path "auth/approle/role/+/secret-id" { capabilities = ["deny"] }
path "sys/policies/acl/vpip-tf-*" { capabilities = ["deny"] }
path "sys/policies/acl/vpip-ansible-*" { capabilities = ["deny"] }
