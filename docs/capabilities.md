# What Vault 2.2.1 does here (measured)

Every answer below was measured on 2026-11-11 by `make probe` on this lab's
cluster (Vault Enterprise 2.2.1, three Raft nodes, Podman 5.7.1 on an Apple
Silicon Mac), on `probe-*` scratch mounts and `vpip-probe_*` scratch
containers that the probe removes again. Secrets are redacted; Vault's error
texts are verbatim. `make probe` exits non-zero when an answer changes.

## P1 Licence

The licence lists **SPIFFE Secrets Engine** (and SPIFFE Auth Engine). Transit
data keys have no feature name of their own.

## P2 The SPIFFE secrets engine (JWT-SVIDs)

| Question | Answer | What the lab does |
| --- | --- | --- |
| Mount type | `spiffe` | Terraform enables `spiffe/` |
| A minted SVID | header `{"alg":"ES256","kid":"..."}`; claims `sub` (the full ID, `spiffe://pipeline.lab/workload/<name>`), `aud` (a **list** with the one audience), `iss`, `iat`, `nbf`, `exp`, `jti` (only with `use_jti_claim=true`), `vault.entity.id` | Callees read `aud` as a list and require exactly their own ID in it |
| Lifetime | `exp - iat` = the role's `ttl` (60 s) | D10 |
| Audience | required (`audience is required`); one string only (a list: `error converting input for field "audience": ... expected type 'string'`) | One SVID per call, per callee |
| Issuer | defaults to the active node's `api_addr` (`https://vault-1:8200/v1/<mount>`), which would change with the leader; `jwt_issuer_url` pins it, and the discovery document follows | `jwt_issuer_url = https://vault.pipeline.lab/v1/spiffe`; callees check that exact issuer and fetch the JWKS from the cluster itself |
| JWKS | `GET <mount>/.well-known/keys` answers **without a token**: EC P-256 keys, two of them right after the first mint (current and next) | Callees cache keys by `kid`, refetch once on an unknown `kid` |
| Verification in Node | `crypto.createPublicKey({key: jwk, format: 'jwk'})` and `crypto.verify('sha256', ..., {dsaEncoding: 'ieee-p1363'})` accept a real SVID and refuse a flipped signature byte and edited claims | `pipeline/lib/svid.js`, standard library only |
| A token without the role in its policy | `403 permission denied` | Each workload's policy names only its own role's `mintjwt` |
| Entity | `vault.entity.id` is empty for a token without an entity; AppRole logins carry one | The custody log names the SPIFFE ID, the audit log the entity |

## P3 Transit data keys (envelope encryption)

| Question | Answer | What the lab does |
| --- | --- | --- |
| Path | **`<mount>/datakeys/{plaintext,wrapped}/<key>`**. The documented `<mount>/<key>/datakeys` and `keys/<key>/datakeys` answer `404 unsupported path` | The scribe calls `transit/datakeys/plaintext/<collection>` |
| Batch | `count` is required (`count is required`), 1 to 100 (`count must be between 1 and 100 (inclusive)`); `bits` 128, 256 (default) or 512 | One call per ingest: one data key per document |
| Response | `{"key_pairs":[{"ciphertext":"vault:v1:...","plaintext":"<44 base64 chars>"}],"key_version":1}` | `edk` = `ciphertext`, `key_version` stored per document |
| Capability | `update` on `transit/datakeys/plaintext/<key>` only. That token cannot `decrypt` (403) and cannot use the classic `datakey/plaintext/<key>` (403) | Scribe policy |
| Opening | ordinary `transit/decrypt/<key>` returns the same data key; a decrypt-only token cannot make keys (403) | People's read policies (`vpip-read-*`) |
| Derived keys | `<mount>/derivedkeys/{plaintext,wrapped}/<key>` (salt, info, index range) exists | Not used: one random key per document is simpler and enough |

## P4 The envelope CLI

`vault transit envelope encrypt <mount>/keys/<key> <file>` sealed 5 MiB in
0.04 s and wrote `<file>.vee`: the bytes `VEE`, a protobuf header
(`algorithm OAE2-AES256-GCM96-HKDF`, `key_data {mount_path, key_name,
key_version}`, `length`) and an online AEAD stream; `decrypt` restored it
byte for byte. The format is binary and undocumented, and the only SDK is Go:
**Node interop is deferred** (a bonus, not a requirement). The lab's own frame
format (D11, AES-256-GCM STREAM with a nonce prefix, a counter and a last
flag) is the same family.

## P5 Rotation, rewrap and the minimum version

| Step | Answer |
| --- | --- |
| `rewrap` with `update` on `transit/rewrap/<key>` only | `200`, `vault:v1:` becomes `vault:v2:`; the same token cannot `decrypt` (403) |
| Rewrapped key | opens to the **same** data key: frames stay valid, nothing is re-encrypted |
| `min_decryption_version` raised, then decrypt an old key | `400 ciphertext or signature version is disallowed by policy (too old)` |
| Rewrap after the minimum is raised | the same error: **rewrap first, then raise the minimum** |
| A data key that already leaked | still opens its frames: Vault is not involved in AES. Only re-sealing the document with a new data key (and deleting the old frames) closes it |

The lab's rotate button (console token: `rotate` and `config`) and the
keeper's rewrap (`update` on `rewrap`) follow that order.

## P6 Secret zero (AppRole, wrapping, CIDR binding)

| Step | Answer |
| --- | --- |
| Unwrap a wrapped `secret_id` | `200` once; the second unwrap `400 wrapping token is not valid or does not exist` |
| Login and use from the bound `/32` | `200`, `200` |
| The same token used from another address | `403 permission denied` (`token_bound_cidrs`) |
| Login from another address | `400 source address "10.89.230.241" unauthorized by CIDR restrictions on the role: %!w(<nil>)` (the `%!w(<nil>)` is Vault's own formatting) |
| A login refused by the CIDR rule | **burns** a single-use `secret_id`: the next login, from the right address, gets `invalid role or secret ID` |
| From the host through a published port | Vault sees `10.89.230.2`, vault-1's own address (rootless port forwarding) |

Consequences: workload addresses are static; a secret id tried from the wrong
place is gone (the real workload then fails loudly at start, which is the
tamper evidence the story uses); nothing on the host can log in as a workload.

## P7 The database secrets engine (PostgreSQL 18.6, pgvector 0.8.7)

| Step | Answer |
| --- | --- |
| The image's `pg_hba.conf` | `trust` for local and loopback connections: any password works there. The lab starts Postgres with `POSTGRES_INITDB_ARGS=--auth-local=scram-sha-256 --auth-host=scram-sha-256` |
| `rotate-root` | `204`; afterwards the bootstrap password fails, on loopback too (`password authentication failed`) |
| The keeper's role (`terraform/vault-platform/sql/keeper-create.sql`) | inserts documents and frames, updates an encrypted key (rewrap), reads; `DELETE FROM custody`: `permission denied for table custody`; `DROP TABLE frames`: `must be owner of table frames`; `CREATE TABLE`: `permission denied for schema public` |
| Revoke the lease | the next login: `password authentication failed for user "v-token-vp-keeper-..."` |

## P9 Ollama 0.13.5 on the VM's CPU (12 cores)

| Measure | Value |
| --- | --- |
| `nomic-embed-text:v1.5` | 768 dimensions; 1 KiB chunk: 0.6 to 0.9 s cold, **100 to 120 ms** warm (median of 5) |
| `qwen2.5:1.5b`, 3 passages | first token 2.8 to 5.9 s cold, **0.1 to 0.2 s** warm; 11 to 28 tokens per second (three runs) |
| Pull | both models (1.26 GB) in about 30 s into volume `vpip-ollama_models` |

A six-document ingest (about 20 chunks) embeds in 2 to 3 s; a 256-token
answer takes 10 to 25 s. The console streams it.

## P10 The audit log

Request and response values are HMAC-SHA256. An encrypted data key gets the
**same** HMAC in the `datakeys` response where it is made and in the
`decrypt` request where it is opened, so the custody log can link the two
without storing the key. Every entry carries `remote_address` (the workload's
address) and the token's display name; requests are logged by the active
node.

## P8 JWT auth with Keycloak

Measured in prompt 04, when Keycloak runs: see `docs/STATE.md`.
