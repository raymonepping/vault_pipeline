# vpip-probe: prompt 03's probe token (4h, minted at bootstrap). Everything on
# probe-* scratch mounts and probe-* policies, so make probe can enable a
# mount, prove a mechanic, and remove it again. Nothing on the story's own
# mounts or on the tools' own policies.

path "sys/mounts" { capabilities = ["read"] }
path "sys/mounts/probe-*" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "probe-*" { capabilities = ["create", "read", "update", "delete", "list", "sudo"] }

path "sys/auth" { capabilities = ["read"] }
path "sys/auth/probe-*" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "sys/mounts/auth/probe-*" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "auth/probe-*" { capabilities = ["create", "read", "update", "delete", "list", "sudo"] }

path "sys/policies/acl/probe-*" { capabilities = ["create", "read", "update", "delete"] }
path "identity/group" { capabilities = ["create", "update"] }
path "identity/group/name/probe-*" { capabilities = ["create", "read", "update", "delete"] }
path "identity/group/id/*" { capabilities = ["read", "delete"] }
path "identity/group-alias" { capabilities = ["create", "update"] }
path "identity/group-alias/id/*" { capabilities = ["read", "delete"] }

# Child tokens with probe-* policies only (a token cannot grant a policy its
# parent lacks unless it is listed here).
path "auth/token/create" { capabilities = ["create", "update", "sudo"] }
path "auth/token/create-orphan" { capabilities = ["create", "update", "sudo"] }
path "auth/token/revoke-accessor" { capabilities = ["update"] }
path "sys/wrapping/lookup" { capabilities = ["update"] }
path "sys/license/status" { capabilities = ["read"] }
path "sys/audit" { capabilities = ["read", "sudo"] }
path "sys/audit/probe-*" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "sys/leases/revoke-prefix/probe-*" { capabilities = ["update", "sudo"] }
path "sys/leases/lookup/probe-*" { capabilities = ["list", "sudo"] }

path "sys/policies/acl/vpip-*" { capabilities = ["deny"] }
