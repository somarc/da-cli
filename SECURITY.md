# Security Policy

## Supported Versions

Security fixes are shipped in the latest published version of `@somarc/da-cli`.

## Reporting a Vulnerability

Please do not open a public issue for suspected vulnerabilities.

Report security issues through GitHub private vulnerability reporting when available, or contact the repository owner directly through GitHub. Include:

- The affected `da-cli` version
- Your Node.js version and operating system
- The command or workflow involved
- Reproduction steps or a minimal proof of concept
- Any logs with secrets, tokens, and private URLs removed

The project will acknowledge valid reports as quickly as practical, assess impact, and publish a patched npm release when needed.

## Token Handling

`da-cli` stores DA authentication tokens in `~/.aem/da-token.json`. Treat this file as sensitive. Do not include tokens, bearer headers, `.env` files, or private DA URLs in public issues, pull requests, screenshots, or logs.
