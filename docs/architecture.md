# Architecture

## Topology

```text
network vpip-internal 10.89.230.0/24 (static block below .128, dynamic above)
 ├─ seal      vault-s .5 (Shamir 1/1, Raft): Transit key autounseal, one token per node
 ├─ vault     vault-1..3 .2-.4 (Raft, seal "transit"), a file audit device each
 │              spiffe/ (pipeline.lab, ES256)  transit/ (handbook, board)
 │              database/ (postgres)  approle/ (one role per workload)  jwt/ (Keycloak)
 ├─ identity  openldap ── keycloak 26.8.1 (realm pipeline, :13802)
 ├─ data      postgres (pgvector 0.8.7, pg18)   ollama 0.13.5 (two models)
 ├─ pipeline  scribe .11   keeper .12   librarian .13    (one image)
 └─ app       console .14 (:13800)   web (nginx, :13801)
```

TLS 1.3 everywhere with the lab CA (`make gen-certs`), except Keycloak and
Ollama, which stay inside the network or on loopback.

## Trust boundaries

1. **Secret zero.** Ansible writes each workload's role id and a
   response-wrapped single-use secret id (300 s). The workload unwraps it once,
   logs in with AppRole and keeps the token in memory. The secret id and the
   token work only from the workload's own address.
2. **Workload to workload.** Every call carries a JWT-SVID minted for that
   callee. The callee verifies it against Vault's JWKS (no token needed),
   checks issuer, audience, expiry and a single-use `jti`, then its guest
   list in `config/pipeline.json`.
3. **Person to console.** Keycloak (federated from OpenLDAP) signs the person
   in; the console is the BFF and keeps the tokens. Operators come from the
   signed `groups` claim.
4. **Person to Vault.** For one question, the console logs the person in to
   Vault (role `person`, 120 s, bound to the console's and the librarian's
   addresses); the person's groups map to read policies; the console revokes
   the token when the answer ends.

## A question, end to end

```text
browser ── POST /api/ask ──► console (session: ada)
console ── auth/jwt/login (ada's access token) ──► Vault: token, 120 s, vpip-read-board + vpip-read-handbook
console ── POST /ask + SVID(aud librarian) + ada's token ──► librarian
librarian ── embed the question ──► ollama
librarian ── POST /search + SVID(aud keeper) ──► keeper ── SELECT ... ORDER BY embedding <=> $1 ──► postgres
keeper ◄── sealed frames, headers, encrypted data keys
librarian ── transit/decrypt/<collection> with ADA's token ──► Vault (403 for vera on board)
librarian: open the frames locally, then ── chat ──► ollama ── tokens ──► console ──► browser
console ── auth/token/revoke-self (ada's token) ──► Vault
```

## Sealing a document

The scribe asks `transit/datakeys/plaintext/<collection>` once per ingest
(`count` = documents) and gets one 256-bit data key per document with its
encrypted copy (`vault:vN:`). Each document becomes AES-256-GCM frames: nonce
= a 7-byte prefix, the frame number and a last-frame flag; the authenticated
data binds the document's fixed header fields and the frame number. A
reordered, dropped, truncated or foreign frame fails to open. The keeper
stores the frames, their embeddings and the encrypted data key. A rewrap
changes the encrypted key and its version and leaves every frame valid.
