# config/pipeline.json is the one source for workloads, addresses,
# collections and groups (scripts/pipeline-check.js validates it).
locals {
  cfg          = jsondecode(file("${path.module}/../../config/pipeline.json"))
  workloads    = { for w in local.cfg.workloads : w.name => w }
  collections  = { for c in local.cfg.collections : c.name => c }
  issuer       = "https://vault.${local.cfg.trust_domain}/v1/spiffe"
  person_cidrs = ["${local.workloads.console.address}/32", "${local.workloads.librarian.address}/32"]
}
