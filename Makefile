SHELL := /bin/sh

.DEFAULT_GOAL := help

# Terraform builds the house. Ansible decorates it. Vault keeps the keys.
# Make is the front door.
#
# First run:  make env-init && make license && make gen-certs && make lab
# Daily:      make up / make down / make show-ready

STACKS   := seal vault identity data pipeline app
NETWORK  := vpip-internal
TF_ROOTS := vault-seal vault-platform

# run <script> [args]: a target whose script a later prompt adds says so.
define run
	@if [ -x ./scripts/$(firstword $(1)) ]; then ./scripts/$(1); \
	else echo "$(firstword $(1)) is not built yet (see prompts/)." >&2; exit 2; fi
endef

.PHONY: help check clock-sync status ps volumes network ports-check compose-config env-init license license-status license-features \
	gen-certs certs-reissue certs-status trust-root untrust-root \
	lab phases seal-up seal-init vault-seal seal-tokens vault-up bootstrap identity-up vault-platform keys \
	data-up schema models deliver pipeline-up app-up validate \
	unseal vault-down vault-status vault-stepdown vault-login seal-token-status seal-token-rotate root-regen root-revoke \
	identity-down identity-copy-password data-down pipeline-down pipeline-check \
	tf-plan-all boundary idempotency drift secret-scan layers \
	ingest ask act-ingest act-ask act-badges act-backup story-reset probe rehearsal show-ready \
	app-build app-down app-rebuild open \
	up down verify lint test-unit api-test e2e-install test-ui test-ui-headed test-ui-report screenshots \
	doctor backup clean-slate $(addsuffix -logs,$(STACKS))

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "; printf "vault_pipeline: Chain of Custody, a Vault Enterprise 2.2 workload identity lab (Make + Terraform + Ansible)\n"} \
	  /^# ── / {gsub(/─/, ""); gsub(/^# +| +$$/, ""); printf "\n%s\n", $$0} \
	  /^[a-zA-Z0-9_-]+:.*## / {printf "  %-24s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@printf '\nStacks (each has <stack>-logs):\n  %s\n' "$(STACKS)"

# ── Podman ────────────────────────────────────────────────────────────────────

check: ## Verify Podman machine, compose provider, VM clock, memory and host tools
	@./scripts/podman-check.sh

status: ## Show this project's containers and network
	@podman ps -a --filter name=^vpip- --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
	@podman network exists $(NETWORK) && echo '$(NETWORK): present' || echo '$(NETWORK): not created'

ps: ## List this project's containers
	@podman ps -a --filter name=^vpip-

volumes: ## List this project's named volumes and whether a container uses them
	@for v in $$(podman volume ls -q --filter name=^vpip-); do \
		used=$$(podman ps -a --filter volume=$$v --format '{{.Names}}' | tr '\n' ' '); \
		data=$$(podman volume inspect $$v --format '{{index .Labels "io.vpip.data"}}'); \
		printf '  %-40s %-11s %s\n' "$$v" "$${data:+persistent}" "$${used:-(unattached)}"; \
	done

network: ## (changes state) Create the vpip-internal network if absent
	@./scripts/network.sh
	@echo "$(NETWORK): ready"

ports-check: ## Report host ports this stack wants that something else already holds
	@./scripts/ports-check.sh

compose-config: ## Validate every compose.yaml
	@for stack in $(STACKS); do \
		if [ -f compose/$$stack/compose.yaml ]; then \
			./scripts/compose.sh "$$stack" config --quiet || exit $$?; \
			echo "compose/$$stack/compose.yaml: ok"; \
		else echo "compose/$$stack/compose.yaml: not built yet"; fi; \
	done

clock-sync: ## (changes state) Step the Podman VM's clock to the host's (after the Mac slept)
	@./scripts/clock-sync.sh

env-init: ## (changes state) Create .env from .env.example; never overwrites
	@./scripts/env-init.sh

license: ## (changes state) Install the Vault Enterprise licence: make license [LICENSE_FILE=path]
	@./scripts/license.sh

license-status: ## Is the Vault Enterprise licence file present? (never prints it)
	@./scripts/license.sh --status

license-features: ## Which licensed features the lab needs, and whether the cluster has them (names only)
	$(call run,license-features.sh)

define STACK_LOGS
$(1)-logs: ## Follow $(1) logs
	@./scripts/compose.sh "$(1)" logs -f
endef
$(foreach stack,$(STACKS),$(eval $(call STACK_LOGS,$(stack))))

# ── TLS ───────────────────────────────────────────────────────────────────────

gen-certs: ## (changes state) Create the lab CA and the shared listener certificate; idempotent
	@./scripts/gen-certs.sh

certs-reissue: ## (changes state) Re-sign the listener certificate and SIGHUP running nodes
	@./scripts/gen-certs.sh --reissue

certs-status: ## Show issuer, expiry and SANs of the listener certificate
	@./scripts/gen-certs.sh --status

trust-root: ## (changes state, sudo) Trust the lab CA in the macOS System keychain so browsers accept the console
	$(call run,trust-root.sh add)

untrust-root: ## (changes state, sudo) Remove the lab CA from the macOS System keychain
	$(call run,trust-root.sh remove)

# ── Lab: the phases of scripts/phases.txt ─────────────────────────────────────

lab: ## (changes state) Every phase in order, then the gates and the convergence record; idempotent
	$(call run,lab.sh)

phases: ## List the phases in run order with their tool
	@grep -vE '^(#|$$)' scripts/phases.txt

seal-up: ## (changes state) Phase 1, make: start vault-s (Shamir, Raft)
	$(call run,seal-up.sh)

seal-init: ## (changes state) Phase 2, ansible: init and unseal vault-s, seal bootstrap policies and tokens, revoke root
	$(call run,ansible.sh seal-init)

vault-seal: ## (changes state) Phase 3, tf: Transit mount and key, token role autounseal on vault-s
	$(call run,tf.sh vault-seal apply)

seal-tokens: ## (changes state) Phase 4, ansible: one seal token per node from the token role
	$(call run,ansible.sh seal-tokens)

vault-up: ## (changes state) Phase 5, make: vault-s up and unsealed, then vault-1..3 (auto-unseal), wait for a leader
	$(call run,vault-up.sh)

bootstrap: ## (changes state) Phase 6, ansible: init the cluster, three voters, platform bootstrap policies and tokens, revoke root
	$(call run,ansible.sh bootstrap)

identity-up: ## (changes state) Phase 7, make: OpenLDAP and Keycloak, the directory and realm pipeline (one-shots)
	$(call run,identity-up.sh)

vault-platform: ## (changes state) Phase 8, tf: audit, SPIFFE, Transit mount, AppRoles, database, JWT auth, groups, policies
	$(call run,tf.sh vault-platform apply)

keys: ## (changes state) Phase 9, ansible: the collection keys handbook and board (runtime state, D8)
	$(call run,ansible.sh keys)

data-up: ## (changes state) Phase 10, make: Postgres (pgvector) and Ollama
	$(call run,data-up.sh)

schema: ## (changes state) Phase 11, ansible: tables, index, then rotate the database root password
	$(call run,ansible.sh schema)

models: ## (changes state) Phase 12, ansible: pull the embedding and chat models, check digests
	$(call run,ansible.sh models)

deliver: ## (changes state) Secret zero for every workload by hand (pipeline-up and app-up deliver their own, D9)
	$(call run,ansible.sh deliver)

pipeline-up: ## (changes state) Phase 13, make: scribe, keeper, librarian (delivers their secret zero first)
	$(call run,pipeline-up.sh)

app-up: ## (changes state) Phase 14, make: the console and web (delivers the console's secret zero; builds if missing)
	$(call run,app-up.sh)

validate: ## Phase 15, ansible: every workload's powers, every person's reach, the line for the console
	$(call run,ansible.sh validate)

# ── Gates ─────────────────────────────────────────────────────────────────────

boundary: ## Each scoped token may do its own job and nothing else (sys/capabilities-self)
	$(call run,boundary-check.sh)

idempotency: ## Every Ansible phase again: changed=0 (exceptions in scripts/idempotency-allow.txt)
	$(call run,idempotency.sh)

drift: ## Read-only: every Terraform plan empty, every Ansible phase changed=0 in check mode
	$(call run,drift.sh)

secret-scan: ## Known secret values and secret-shaped patterns in state, .build/ and logs (names only)
	$(call run,secret-scan.sh)

tf-plan-all: ## Plan every Terraform root; fails if any has pending changes
	@for r in $(TF_ROOTS); do \
		[ -f terraform/$$r/versions.tf ] || { echo "$$r: not built yet"; continue; }; \
		out=$$(mktemp); code=0; ./scripts/tf.sh $$r plan -no-color >$$out 2>&1 || code=$$?; \
		case $$code in \
		0) echo "$$r: No changes." ;; \
		2) echo "$$r: CHANGES PENDING" >&2; grep -E '^  [#~+-]|Plan:' $$out >&2; rm -f $$out; exit 2 ;; \
		*) cat $$out >&2; rm -f $$out; exit $$code ;; \
		esac; rm -f $$out; \
	done

layers: ## Write .build/console/layers.json: every phase with its tool and evidence, and the gates
	$(call run,layers.sh)

# ── Vault ─────────────────────────────────────────────────────────────────────

unseal: ## (changes state) Unseal vault-s (idempotent); the cluster then unseals itself via Transit
	$(call run,vault-unseal.sh)

vault-down: ## (changes state) Stop the cluster then vault-s (containers and volumes are kept)
	@./scripts/compose.sh vault stop 2>/dev/null || true
	@./scripts/compose.sh seal stop 2>/dev/null || true

vault-status: ## Every node: container, init, seal, HA role, Raft index, version, voters
	$(call run,vault-status.sh)

vault-stepdown: ## (changes state) Ask the active node to step down; another voter takes over
	$(call run,vault-stepdown.sh)

vault-login: ## Print the export line that points your shell at a node: make vault-login NODE=vault-1 [TOKEN=ansible-platform]
	$(call run,vault-login.sh $(or $(NODE),vault-1) $(or $(TOKEN),ansible-platform))

seal-token-status: ## Each node's seal token: accessor fingerprint, TTL, accepted by vault-s
	$(call run,seal-token-status.sh)

seal-token-rotate: ## (changes state) Replace one node's seal token and recreate only that node: make seal-token-rotate NODE=vault-2
	$(call run,seal-token-rotate.sh $(NODE))

root-regen: ## (changes state) Generate a root token from the saved key, only when you ask: make root-regen CLUSTER=seal|vault
	$(call run,root-regen.sh $(or $(CLUSTER),vault))

root-revoke: ## (changes state) Revoke and delete a regenerated root token: make root-revoke CLUSTER=seal|vault
	$(call run,root-regen.sh --revoke $(or $(CLUSTER),vault))

# ── Story ─────────────────────────────────────────────────────────────────────

pipeline-check: ## Validate config/pipeline.json and print its digest
	@node scripts/pipeline-check.js config/pipeline.json

identity-down: ## (changes state) Stop Keycloak and OpenLDAP; the realm and the directory are kept
	@./scripts/compose.sh identity stop

identity-copy-password: ## Put a person's password on the clipboard (never printed): make identity-copy-password U=ada
	$(call run,identity-password.sh $(or $(U),ada))

data-down: ## (changes state) Stop Postgres and Ollama; their volumes are kept
	@./scripts/compose.sh data stop

pipeline-down: ## (changes state) Stop the workloads (their secret zero is spent; make pipeline-up delivers again)
	@./scripts/compose.sh pipeline stop

ingest: ## (changes state) Act I from the terminal: make ingest COLLECTION=handbook|board
	$(call run,ingest.sh $(or $(COLLECTION),handbook))

ask: ## Act II from the terminal: make ask AS=vera Q="What is Project Lighthouse?"
	$(call run,ask.sh "$(or $(AS),vera)" "$(Q)")

act-ingest: ## (changes state) Act I: both collections through the pipe
	$(call run,act.sh ingest)

act-ask: ## Act II: the two people, the two questions
	$(call run,act.sh ask)

act-badges: ## Act III: the console's own badges at the right and the wrong doors
	$(call run,act.sh badges)

act-backup: ## (changes state) Act IV: the night's backup, a login from the wrong address, rotate and rewrap
	$(call run,act.sh backup)

story-reset: ## (changes state) Forget the stored documents and recreate the collection keys (CONFIRM=yes skips the prompt)
	$(call run,story-reset.sh)

probe: ## (changes state, scratch mounts only) Prove every mechanic; writes docs/capabilities.md
	$(call run,probe.sh)

rehearsal: ## (changes state) Every act, including each way it must fail
	$(call run,rehearsal.sh)

show-ready: ## (changes state) Before the talk: clock-sync, up, story-reset, verify, open the console
	$(call run,show-ready.sh)

# ── App ───────────────────────────────────────────────────────────────────────

app-build: ## (changes state) Build the worker, api and web images: make app-build [TARGETS="worker api web"]
	$(call run,app-build.sh $(TARGETS))

app-down: ## (changes state) Stop the console
	@./scripts/compose.sh app stop

app-rebuild: ## (changes state) Rebuild images and recreate those services: make app-rebuild [TARGETS="api web"]
	$(call run,app-build.sh $(TARGETS))
	$(call run,app-up.sh --recreate $(TARGETS))

open: ## Print the console, API, Keycloak and Vault addresses
	@bash -c '. ./scripts/common.sh && \
		echo "Console:            https://localhost:$$(vpip_conf VPIP_PORT_WEB)/" && \
		echo "API:                https://localhost:$$(vpip_conf VPIP_PORT_API)/healthz" && \
		echo "Keycloak:           https://localhost:$$(vpip_conf VPIP_PORT_KEYCLOAK)/" && \
		echo "Vault UI (vault-1): https://localhost:$$(vpip_conf VPIP_PORT_VAULT_1)/ui" && \
		echo "Vault seal:         https://localhost:$$(vpip_conf VPIP_PORT_VAULT_S)"'

# ── Lifecycle ─────────────────────────────────────────────────────────────────

up: ## (changes state) Daily start: clock-sync, seal, cluster, identity, data, deliver, pipeline, console
	$(call run,up.sh)

down: ## (changes state) Stop console, pipeline, data, identity, vault, seal; containers and volumes are kept
	@for s in app pipeline data identity; do ./scripts/compose.sh $$s stop 2>/dev/null || true; done
	@$(MAKE) --no-print-directory vault-down

# ── Tests ─────────────────────────────────────────────────────────────────────

verify: ## End-to-end checks: podman, vault, platform, stage, app, console, boundary, drift
	$(call run,verify.sh)

lint: ## Static checks, as in CI: shellcheck, terraform fmt and validate, ansible syntax, node --check
	$(call run,lint.sh)

test-unit: ## Unit tests, no stack needed: scripts, pipeline, api, web
	@node --test scripts/*.test.js
	@./scripts/unit-tests.sh
	@if [ -f api/package.json ]; then cd api && npm test; fi
	@if [ -f web/package.json ]; then cd web && npm test; fi

api-test: ## The console's and workloads' unit tests, then its live boundary (needs make up)
	@./scripts/unit-tests.sh
	$(call run,boundary-workloads.sh)

# Playwright against the live stack; nothing is mocked.
E2E := cd e2e && npx playwright test

e2e-install: ## (changes state) Install Playwright and Chromium for the UI suite
	@cd e2e && npm ci --no-audit --no-fund && npx playwright install chromium

test-ui: ## Playwright: every UI journey, headless (needs make up)
	@$(E2E) --grep-invert "@shots"

test-ui-headed: ## Playwright: every UI journey in a visible browser
	@$(E2E) --grep-invert "@shots" --headed

test-ui-report: ## Open the last Playwright HTML report
	@cd e2e && npx playwright show-report

screenshots: ## Playwright: refresh docs/screenshots (desktop + phone)
	@$(E2E) --grep @shots

# ── Maintenance ───────────────────────────────────────────────────────────────

doctor: ## Explain what is wrong and which command fixes it (read-only)
	$(call run,doctor.sh)

backup: ## (changes state) Raft snapshots of vault-s and the cluster, and .secrets, into backups/<timestamp>/
	$(call run,backup.sh)

clean-slate: ## (changes state) DESTRUCTIVE: remove vpip- containers and volumes, move credentials aside (type DELETE)
	$(call run,clean-slate.sh)
