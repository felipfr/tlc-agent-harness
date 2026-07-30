# Security Policy

## Supported versions

Only the latest `main` branch is supported.

## Reporting a vulnerability

Do not open a public issue for security problems.

Contact the copyright holder via GitHub: https://github.com/felipfr

Include description, impact, reproduction steps, and commit SHA when known.

Allow time for a fix before public disclosure.

## Scope

In scope: path escapes outside intended boundaries, secret leakage into committed artifacts, privilege escalation in hooks.

Out of scope: the agent’s ability to run shell commands when policy allows it.
