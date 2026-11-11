# vpip-ansible-platform: Ansible on the cluster (D7). Order and moment: the
# collection keys (create, read, and the story reset's delete and recreate),
# the database root rotation, secret zero (one wrapped secret-id per workload,
# D9), Raft health and snapshots, step-down, and the read-only checks of
# validate, verify and doctor. It may NOT create a mount, write an ACL policy,
# create a data key, decrypt, rewrap, mint an SVID or read a database
# credential (D8, D9). Written complete in prompt 02: after root revocation
# nothing can widen it.

# ── The collection keys are runtime state (D8) ───────────────────────────────
path "transit/keys/handbook" { capabilities = ["create", "read", "update", "delete"] }
path "transit/keys/board" { capabilities = ["create", "read", "update", "delete"] }
path "transit/keys/handbook/config" { capabilities = ["update"] }
path "transit/keys/board/config" { capabilities = ["update"] }
path "transit/keys" { capabilities = ["list"] }

# ── The database root password: rotated after Terraform creates it (D8) ─────
path "database/rotate-root/pipeline" { capabilities = ["update"] }
path "database/config/pipeline" { capabilities = ["read"] }

# ── Secret zero (D9): role ids and wrapped secret-ids, one per workload ──────
# Named per workload: Vault globs only at the end of a path.
path "auth/approle/role/vpip-scribe/role-id" { capabilities = ["read"] }
path "auth/approle/role/vpip-scribe/secret-id" { capabilities = ["update", "list"] }
path "auth/approle/role/vpip-scribe/secret-id-accessor/*" { capabilities = ["update"] }
path "auth/approle/role/vpip-keeper/role-id" { capabilities = ["read"] }
path "auth/approle/role/vpip-keeper/secret-id" { capabilities = ["update", "list"] }
path "auth/approle/role/vpip-keeper/secret-id-accessor/*" { capabilities = ["update"] }
path "auth/approle/role/vpip-librarian/role-id" { capabilities = ["read"] }
path "auth/approle/role/vpip-librarian/secret-id" { capabilities = ["update", "list"] }
path "auth/approle/role/vpip-librarian/secret-id-accessor/*" { capabilities = ["update"] }
path "auth/approle/role/vpip-console/role-id" { capabilities = ["read"] }
path "auth/approle/role/vpip-console/secret-id" { capabilities = ["update", "list"] }
path "auth/approle/role/vpip-console/secret-id-accessor/*" { capabilities = ["update"] }
path "sys/wrapping/lookup" { capabilities = ["update"] }

# ── Cluster operations ───────────────────────────────────────────────────────
path "sys/storage/raft/configuration" { capabilities = ["read"] }
path "sys/storage/raft/snapshot" { capabilities = ["read"] }
path "sys/step-down" { capabilities = ["update", "sudo"] }
path "sys/license/status" { capabilities = ["read"] }
path "sys/health" { capabilities = ["read"] }
path "auth/token/lookup" { capabilities = ["update"] }

# ── Read-only checks (validate, verify, doctor) ──────────────────────────────
path "sys/mounts" { capabilities = ["read"] }
path "sys/auth" { capabilities = ["read"] }
path "sys/audit" { capabilities = ["read", "sudo"] }
path "sys/policies/acl/vpip-wl-*" { capabilities = ["read"] }
path "sys/policies/acl/vpip-read-*" { capabilities = ["read"] }
path "identity/group/name/*" { capabilities = ["read"] }
path "auth/jwt/role/person" { capabilities = ["read"] }
path "spiffe/config" { capabilities = ["read"] }
path "spiffe/role" { capabilities = ["list"] }
path "spiffe/role/*" { capabilities = ["read"] }
path "sys/leases/lookup/database/creds/keeper" { capabilities = ["list", "sudo"] }

# Break glass (make root-regen): Vault 2.0 requires a token as well as the
# key share for sys/generate-root (HCSEC-2026-08).
path "sys/generate-root/*" { capabilities = ["create", "read", "update", "delete", "sudo"] }

# ── Never ────────────────────────────────────────────────────────────────────
path "transit/decrypt/*" { capabilities = ["deny"] }
path "transit/encrypt/*" { capabilities = ["deny"] }
path "transit/rewrap/*" { capabilities = ["deny"] }
path "transit/datakey/*" { capabilities = ["deny"] }
path "transit/keys/+/datakeys" { capabilities = ["deny"] }
path "spiffe/role/+/mintjwt" { capabilities = ["deny"] }
path "database/creds/*" { capabilities = ["deny"] }
path "sys/mounts/*" { capabilities = ["deny"] }
path "sys/policies/acl/vpip-tf-*" { capabilities = ["deny"] }
path "sys/policies/acl/vpip-ansible-*" { capabilities = ["deny"] }
