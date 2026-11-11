#!/usr/bin/env bash
# scripts/probe.sh (make probe): prove every mechanic the story relies on, on
# probe-* scratch mounts and vpip-probe_* scratch containers, then remove
# them. Uses the 4h probe token minted at bootstrap (D7). Exits non-zero when
# any answer differs from docs/capabilities.md. Never prints a token, a data
# key or an SVID: only status codes, Vault's error text and decoded claims.
set -euo pipefail
# shellcheck source=scripts/probe-lib.sh
source "$(dirname -- "$0")/probe-lib.sh"
cd "$VPIP_ROOT"
[ -s "$VPIP_STATE/tokens/probe" ] || die "probe: no probe token (it is minted at bootstrap and lives 4h)"
hdr probe "$VPIP_STATE/tokens/probe"
[ "$(code "$(vreq probe GET auth/token/lookup-self)")" = 200 ] || die "probe: the probe token expired (4h after bootstrap); probe answers stay in docs/capabilities.md"

W="$PROBE_DIR/client"
mkdir -p "$W"
# The in-network clients are tracked in scripts/probe/; the run dir is scratch.
cp "$VPIP_ROOT"/scripts/probe/*.mjs "$W/"
NODE_IMAGE=$(vpip_conf NODE_IMAGE)
PG_IMAGE=$(vpip_conf POSTGRES_IMAGE)
OLLAMA_IMAGE=$(vpip_conf OLLAMA_IMAGE)
fails=0
expect() { # id what want-regex got
  if [[ "$4" =~ $3 ]]; then printf '  \033[32mok\033[0m   %-4s %s\n' "$1" "$2"
  else printf '  \033[31mFAIL\033[0m %-4s %s: want /%s/, got: %s\n' "$1" "$2" "$3" "$4"; fails=$((fails + 1)); fi
}
cleanup() {
  for c in vpip-probe_a vpip-probe_b vpip-probe_pg vpip-probe_ollama vpip-probe_client vpip-probe_envelope; do
    podman rm -f "$c" >/dev/null 2>&1 || true
  done
  for m in probe-spiffe probe-transit probe-db; do vreq probe DELETE "sys/mounts/$m" >/dev/null || true; done
  vreq probe DELETE sys/auth/probe-approle >/dev/null || true
  vreq probe DELETE sys/audit/probe-file >/dev/null || true
  for p in probe-nothing probe-maker probe-opener probe-relocker probe-turner; do vreq probe DELETE "sys/policies/acl/$p" >/dev/null || true; done
  find "$W" -type f ! -name '*.mjs' -delete 2>/dev/null || true
  find "$PROBE_DIR" -maxdepth 1 -type f \( -name '*.hdr' -o -name 'pgpw' -o -name 'jwks.json' -o -name 'svid' \) -delete 2>/dev/null || true
}
trap cleanup EXIT
cleanup
hdr probe "$VPIP_STATE/tokens/probe"
mk_token() { # name policy-hcl
  vreq probe POST "sys/policies/acl/probe-$1" "$(jq -cn --arg p "$2" '{policy:$p}')" >/dev/null
  hdr_value "$1" "$(body "$(vreq probe POST auth/token/create "$(jq -cn --arg p "probe-$1" '{policies:[$p],ttl:"10m",no_default_policy:true}')")" | jq -r .auth.client_token)"
}
ip_run() { # name ip plan-file
  podman run --rm --name "vpip-probe_$1" --network vpip-internal --ip "$2" -v "$W:/w" -v "$VPIP_ROOT/vault-tls:/tls:ro" \
    -e NODE_EXTRA_CA_CERTS=/tls/ca-chain.pem "$NODE_IMAGE" node /w/client.mjs "/w/$3"
}

echo "P1 licence"
feats=$(body "$(vreq probe GET sys/license/status)" | jq -r '.data.autoloaded.features | join(",")')
expect P1 "SPIFFE Secrets Engine licensed" 'SPIFFE Secrets Engine' "$feats"

echo "P2 SPIFFE engine"
vreq probe POST sys/mounts/probe-spiffe '{"type":"spiffe"}' >/dev/null
vreq probe POST probe-spiffe/config '{"trust_domain":"pipeline.lab","jwt_signing_algorithm":"ES256","jwt_issuer_url":"https://vault.pipeline.lab/v1/spiffe"}' >/dev/null
vreq probe POST probe-spiffe/role/probe "$(jq -cn '{template: ({sub:"/workload/probe"}|tojson), ttl:"60s", use_jti_claim:true}')" >/dev/null
r=$(vreq probe POST probe-spiffe/role/probe/mintjwt '{"audience":"spiffe://pipeline.lab/workload/keeper"}')
t=$(body "$r" | jq -r .data.token)
c=$(jwt_claims "$t")
expect P2a "sub is the full SPIFFE ID" '"sub":"spiffe://pipeline.lab/workload/probe"' "$c"
expect P2b "aud is a one-element list" '"aud":\["spiffe://pipeline.lab/workload/keeper"\]' "$c"
expect P2c "iss is the configured issuer" '"iss":"https://vault.pipeline.lab/v1/spiffe"' "$c"
expect P2d "ES256 with a kid, a jti, 60 s" '"alg":"ES256".*"kid".*"exp":([0-9]+).*"iat":.*"jti"' "$c"
expect P2e "exp - iat = 60" '^60$' "$(jq '.claims.exp - .claims.iat' <<<"$c")"
expect P2f "audience required" 'audience is required' "$(vreq probe POST probe-spiffe/role/probe/mintjwt '{}')"
expect P2g "a list audience is refused" "expected type 'string'" "$(vreq probe POST probe-spiffe/role/probe/mintjwt '{"audience":["a","b"]}')"
vreq - GET probe-spiffe/.well-known/keys | cut -d' ' -f2- >"$PROBE_DIR/jwks.json"
expect P2h "JWKS readable without a token, ES256 P-256" '"crv":"P-256"' "$(cat "$PROBE_DIR/jwks.json")"
printf '%s' "$t" >"$PROBE_DIR/svid"
v=$(node - "$PROBE_DIR/svid" "$PROBE_DIR/jwks.json" <<'JS'
const fs = require('fs'), crypto = require('crypto');
const [h, c, s] = fs.readFileSync(process.argv[2], 'utf8').split('.');
const kid = JSON.parse(Buffer.from(h, 'base64url')).kid;
const key = crypto.createPublicKey({ key: JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).keys.find((k) => k.kid === kid), format: 'jwk' });
const ok = (sig, body = `${h}.${c}`) => crypto.verify('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' }, sig);
const sig = Buffer.from(s, 'base64url'); const bad = Buffer.from(sig); bad[5] ^= 1;
console.log(`valid=${ok(sig)} flipped=${ok(bad)}`);
JS
)
expect P2i "Node verifies ES256; a flipped byte fails" 'valid=true flipped=false' "$v"
mk_token nothing 'path "sys/nothing" { capabilities = ["read"] }'
expect P2j "mint without the role in policy" '^403 .*permission denied' "$(vreq nothing POST probe-spiffe/role/probe/mintjwt '{"audience":"x"}')"

echo "P3 data keys"
vreq probe POST sys/mounts/probe-transit '{"type":"transit"}' >/dev/null
vreq probe POST probe-transit/keys/col '{"type":"aes256-gcm96"}' >/dev/null
expect P3a "keys/<k>/datakeys is not a path" '^404 .*unsupported path' "$(vreq probe POST probe-transit/keys/col/datakeys '{}')"
expect P3b "datakeys needs count" 'count is required' "$(vreq probe POST probe-transit/datakeys/plaintext/col '{}')"
expect P3c "count is 1 to 100" 'between 1 and 100' "$(vreq probe POST probe-transit/datakeys/plaintext/col '{"count":101}')"
mk_token maker 'path "probe-transit/datakeys/plaintext/col" { capabilities = ["update"] }'
mk_token opener 'path "probe-transit/decrypt/col" { capabilities = ["update"] }'
mk_token relocker 'path "probe-transit/rewrap/col" { capabilities = ["update"] }'
mk_token turner 'path "probe-transit/keys/col/rotate" { capabilities = ["update"] }
path "probe-transit/keys/col/config" { capabilities = ["update"] }'
r=$(vreq maker POST probe-transit/datakeys/plaintext/col '{"count":3}')
expect P3d "update on datakeys/plaintext/<k>: three pairs, vault:v1:" '^200 .*"key_pairs":\[\{"ciphertext":"vault:v1:' "$r"
edk=$(body "$r" | jq -r '.data.key_pairs[0].ciphertext')
dek=$(body "$r" | jq -r '.data.key_pairs[0].plaintext')
expect P3e "the maker cannot decrypt" '^403' "$(vreq maker POST probe-transit/decrypt/col "$(jq -cn --arg c "$edk" '{ciphertext:$c}')")"
r=$(vreq opener POST probe-transit/decrypt/col "$(jq -cn --arg c "$edk" '{ciphertext:$c}')")
expect P3f "the opener gets the same data key back" 'same' "$([ "$(body "$r" | jq -r .data.plaintext)" = "$dek" ] && echo same || echo different)"
expect P3g "the opener cannot make keys" '^403' "$(vreq opener POST probe-transit/datakeys/plaintext/col '{"count":1}')"

echo "P4 envelope CLI (.vee)"
vreq probe POST probe-transit/keys/env '{}' >/dev/null
cp "$VPIP_STATE/tokens/probe" "$W/token" && chmod 644 "$W/token"
head -c 1048576 /dev/urandom >"$W/big.bin"
out=$(podman run --rm --name vpip-probe_envelope --network vpip-internal -v "$W:/w" -v "$VPIP_ROOT/vault-tls:/tls:ro" \
  -e VAULT_ADDR=https://vault-1:8200 -e VAULT_CACERT=/tls/ca-chain.pem -e HOME=/tmp --entrypoint sh "$(vpip_conf VAULT_ENT_IMAGE)" -c '
  export VAULT_TOKEN=$(cat /w/token); rm -f /w/token; cd /w
  vault transit envelope encrypt probe-transit/keys/env big.bin >/dev/null 2>&1
  vault transit envelope header big.bin.vee 2>&1 | grep algorithm; head -c 3 big.bin.vee; echo
  mv big.bin big.orig; vault transit envelope decrypt probe-transit/keys/env big.bin.vee >/dev/null 2>&1; cmp -s big.orig big.bin && echo roundtrip')
expect P4 "OAE2-AES256-GCM96-HKDF, VEE magic, round trip" 'OAE2-AES256-GCM96-HKDF.*VEE.*roundtrip' "$(tr '\n' ' ' <<<"$out")"

echo "P5 rotate, rewrap, minimum version"
vreq turner POST probe-transit/keys/col/rotate '{}' >/dev/null
r=$(vreq relocker POST probe-transit/rewrap/col "$(jq -cn --arg c "$edk" '{ciphertext:$c}')")
expect P5a "rewrap with update on rewrap only: vault:v2:" '^200 .*"ciphertext":"vault:v2:' "$r"
edk2=$(body "$r" | jq -r .data.ciphertext)
expect P5b "the relocker cannot decrypt" '^403' "$(vreq relocker POST probe-transit/decrypt/col "$(jq -cn --arg c "$edk" '{ciphertext:$c}')")"
vreq turner POST probe-transit/keys/col/config '{"min_decryption_version":2}' >/dev/null
expect P5c "an old encrypted key after the minimum is raised" '^400 .*disallowed by policy \(too old\)' "$(vreq opener POST probe-transit/decrypt/col "$(jq -cn --arg c "$edk" '{ciphertext:$c}')")"
expect P5d "rewrap after the minimum is raised: too late" 'too old' "$(vreq relocker POST probe-transit/rewrap/col "$(jq -cn --arg c "$edk" '{ciphertext:$c}')")"
r=$(vreq opener POST probe-transit/decrypt/col "$(jq -cn --arg c "$edk2" '{ciphertext:$c}')")
expect P5e "the rewrapped key opens to the same data key" 'same' "$([ "$(body "$r" | jq -r .data.plaintext)" = "$dek" ] && echo same || echo different)"
leak=$(node -e 'const c=require("crypto");const k=Buffer.from(process.argv[1],"base64");const iv=c.randomBytes(12);const e=c.createCipheriv("aes-256-gcm",k,iv);const ct=Buffer.concat([e.update("frame"),e.final()]);const d=c.createDecipheriv("aes-256-gcm",k,iv);d.setAuthTag(e.getAuthTag());console.log(Buffer.concat([d.update(ct),d.final()]).toString())' "$dek")
expect P5f "a leaked data key still opens its frames" '^frame$' "$leak"

echo "P6 secret zero"
vreq probe POST sys/audit/probe-file '{"type":"file","options":{"file_path":"/vault/audit/probe.log"}}' >/dev/null
vreq probe POST sys/auth/probe-approle '{"type":"approle"}' >/dev/null
vreq probe POST auth/probe-approle/role/w '{"secret_id_bound_cidrs":["10.89.230.240/32"],"token_bound_cidrs":["10.89.230.240/32"],"secret_id_num_uses":1,"secret_id_ttl":"600s","token_period":"3600s","token_policies":["default"]}' >/dev/null
body "$(vreq probe GET auth/probe-approle/role/w/role-id)" | jq -r .data.role_id >"$W/role_id"
sid() { curl -sS --cacert "$VAULT_CACERT" -H "@$PROBE_DIR/probe.hdr" "$@" -X POST "$VAULT_ADDR/v1/auth/probe-approle/role/w/secret-id"; }
sid -H 'X-Vault-Wrap-TTL: 300' | jq -r .wrap_info.token >"$W/wrapped"
sid | jq -r .data.secret_id >"$W/sid2"
sid | jq -r .data.secret_id >"$W/sid3"
chmod 644 "$W"/*
printf '%s' '[{"do":"unwrap","as":"u1"},{"do":"unwrap","as":"u2"},{"do":"login","as":"in"},{"do":"use","as":"use"}]' >"$W/pa.json"
printf '%s' '[{"do":"use","as":"stolen"},{"do":"login","as":"wrong","sid":"/w/sid2"}]' >"$W/pb.json"
printf '%s' '[{"do":"login","as":"after","sid":"/w/sid2"}]' >"$W/pc.json"
a=$(ip_run a 10.89.230.240 pa.json)
expect P6a "a wrapped secret id opens once" '"u1":\{"status":200' "$a"
expect P6b "the second unwrap" '"u2":\{"status":400,"errors":\["wrapping token is not valid or does not exist"\]' "$a"
expect P6c "login and use from the bound address" '"in":\{"status":200.*"use":\{"status":200' "$a"
b=$(ip_run b 10.89.230.241 pb.json)
expect P6d "the token from another address" '"stolen":\{"status":403,"errors":\["permission denied"\]' "$b"
expect P6e "login from another address" 'unauthorized by CIDR restrictions on the role' "$b"
expect P6f "the refused login burned the secret id" 'invalid role or secret ID' "$(ip_run a 10.89.230.240 pc.json)"
h=$(curl -sS --cacert "$VAULT_CACERT" -X POST -d "$(jq -cn --arg r "$(cat "$W/role_id")" --arg s "$(cat "$W/sid3")" '{role_id:$r,secret_id:$s}')" "$VAULT_ADDR/v1/auth/probe-approle/login")
expect P6g "the host through a published port arrives as vault-1's own address" 'source address \\"10.89.230.2\\"' "$h"

echo "P7 database engine"
openssl rand -hex 16 >"$PROBE_DIR/pgpw" && chmod 644 "$PROBE_DIR/pgpw"
podman run -d --name vpip-probe_pg --network vpip-internal --ip 10.89.230.250 --hostname probe-pg \
  -e POSTGRES_DB=pipeline -e POSTGRES_PASSWORD_FILE=/run/pw -e POSTGRES_INITDB_ARGS='--auth-local=scram-sha-256 --auth-host=scram-sha-256' \
  -v "$PROBE_DIR/pgpw:/run/pw:ro" "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do podman exec vpip-probe_pg pg_isready -h probe-pg -U postgres -d pipeline >/dev/null 2>&1 && break; sleep 1; done
podman exec -i vpip-probe_pg sh -c 'PGPASSWORD=$(cat /run/pw) psql -h probe-pg -U postgres -d pipeline -v ON_ERROR_STOP=1 -q' <"$VPIP_ROOT/ansible/roles/schema/files/schema.sql"
vreq probe POST sys/mounts/probe-db '{"type":"database"}' >/dev/null
vreq probe POST probe-db/config/pipeline "$(jq -cn --arg p "$(cat "$PROBE_DIR/pgpw")" '{plugin_name:"postgresql-database-plugin",connection_url:"postgresql://{{username}}:{{password}}@probe-pg:5432/pipeline?sslmode=disable",username:"postgres",password:$p,allowed_roles:["keeper"],password_authentication:"scram-sha-256"}')" >/dev/null
vreq probe POST probe-db/roles/keeper "$(jq -cn --rawfile c "$VPIP_ROOT/terraform/vault-platform/sql/keeper-create.sql" --rawfile r "$VPIP_ROOT/terraform/vault-platform/sql/keeper-revoke.sql" '{db_name:"pipeline",creation_statements:[$c],revocation_statements:[$r],default_ttl:"3600s",max_ttl:"14400s"}')" >/dev/null
expect P7a "rotate-root" '^204' "$(vreq probe POST probe-db/rotate-root/pipeline '{}')"
expect P7b "the bootstrap password is dead, even on loopback" 'password authentication failed' \
  "$(podman exec vpip-probe_pg sh -c 'PGPASSWORD=$(cat /run/pw) psql -h 127.0.0.1 -U postgres -d pipeline -tAc "select 1" 2>&1' || true)"
r=$(vreq probe GET probe-db/creds/keeper)
u=$(body "$r" | jq -r .data.username)
q() { body "$r" | jq -r .data.password | podman exec -i vpip-probe_pg sh -c "PGPASSWORD=\$(cat) psql -h probe-pg -U '$u' -d pipeline -tAc \"$1\" 2>&1" || true; }
expect P7c "the keeper inserts a document" '^d1' "$(q "INSERT INTO documents VALUES ('d1','c','{}','vault:v1:x',1,'probe') RETURNING doc_id")"
expect P7d "the keeper updates an encrypted key (rewrap)" 'UPDATE 1' "$(q "UPDATE documents SET edk='vault:v2:x' WHERE doc_id='d1'")"
expect P7e "custody is append-only for the keeper" 'permission denied for table custody' "$(q "DELETE FROM custody")"
expect P7f "the keeper cannot drop a table" 'must be owner of table frames' "$(q "DROP TABLE frames")"
vreq probe POST sys/leases/revoke-prefix/probe-db/creds/keeper '{}' >/dev/null
expect P7g "a revoked lease is a dead login" 'password authentication failed' "$(q "SELECT 1")"

echo "P9 Ollama on the VM's CPU"
podman volume exists vpip-ollama_models || podman volume create --label io.vpip.data=true vpip-ollama_models >/dev/null
podman run -d --name vpip-probe_ollama --network vpip-internal --ip 10.89.230.251 -v vpip-ollama_models:/root/.ollama \
  -e OLLAMA_KEEP_ALIVE=30m -e OLLAMA_NUM_PARALLEL=1 "$OLLAMA_IMAGE" >/dev/null
for _ in $(seq 1 30); do podman exec vpip-probe_ollama ollama list >/dev/null 2>&1 && break; sleep 1; done
for m in "$(vpip_conf VPIP_EMBED_MODEL)" "$(vpip_conf VPIP_CHAT_MODEL)"; do podman exec vpip-probe_ollama ollama pull "$m" >/dev/null 2>&1; done
o=$(podman run --rm --name vpip-probe_client --network vpip-internal --ip 10.89.230.240 -v "$W:/w" "$NODE_IMAGE" node /w/ollama.mjs | tr '\n' ' ')
expect P9 "768 dimensions, an answer streams" 'dims 768 .*answer run 2' "$o"
echo "     $o"

echo "P10 audit"
vreq probe POST probe-transit/keys/aud '{}' >/dev/null
r=$(vreq probe POST probe-transit/datakeys/plaintext/aud '{"count":1}')
vreq probe POST probe-transit/decrypt/aud "$(jq -cn --arg c "$(body "$r" | jq -r '.data.key_pairs[0].ciphertext')" '{ciphertext:$c}')" >/dev/null
log=$(podman exec "$(vault_container vault-1)" sh -c 'cat /vault/audit/probe.log')
made=$(jq -r 'select(.type=="response" and .request.path=="probe-transit/datakeys/plaintext/aud") | .response.data.key_pairs[0].ciphertext' <<<"$log" | tail -1)
a=$(jq -r --arg h "$made" 'select(.type=="response" and .request.path=="probe-transit/decrypt/aud" and .request.data.ciphertext==$h) | .request.path' <<<"$log" | wc -l | tr -d ' ')
expect P10 "the same HMAC for an encrypted key where it is made and where it is opened" '^[1-9]' "$a"

echo
if [ "$fails" -eq 0 ]; then info "probe: every answer matches docs/capabilities.md"; else die "probe: $fails answer(s) changed: update docs/capabilities.md and the code that relies on them"; fi
