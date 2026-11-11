# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Chain of Custody: a Vault Enterprise 2.2.1 workload-identity lab. Four
  Node workloads with their own AppRole (secret zero, bound to their
  address), JWT-SVIDs from the SPIFFE secrets engine, Transit data keys per
  document, a database credential for the keeper, and questions answered
  with the asking person's Vault token. Make, Terraform and Ansible build it;
  the console runs in Vault daylight glass.
