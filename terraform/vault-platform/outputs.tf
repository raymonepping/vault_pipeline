output "spiffe_issuer" {
  description = "The issuer every workload checks (D10)."
  value       = local.issuer
}

output "approle_roles" {
  description = "One AppRole per workload (role ids are read by Ansible deliver, never output)."
  value       = sort([for r in vault_approle_auth_backend_role.workload : r.role_name])
}

output "jwt_accessor" {
  description = "The jwt/ mount accessor the group aliases use."
  value       = vault_jwt_auth_backend.keycloak.accessor
}
