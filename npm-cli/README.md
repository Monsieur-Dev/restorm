# restorm-cli

Run a [Restorm](https://restorm.app) scenario from a terminal, or from CI where
there is no terminal to click in.

```bash
npm install -g restorm-cli
restorm --open ./api.restorm --run "Smoke tests" --headless
```

## Your token

A headless run authenticates with an organization token (prefixed `rstk_`) read
from `RESTORM_TOKEN`.

Create one **inside Restorm**: the account button in the title bar, then *My
CLI/CI tokens*. Give it a label and a lifetime, and copy it — the value is shown
once, at creation, and is never retrievable afterwards, including by us. You can
revoke it at any time, and a revoked or expired token stops working immediately.

Tokens can also be managed from your account dashboard at
[my.restorm.app](https://my.restorm.app).

→ [Accounts, sign-in and CLI/CI tokens](https://restorm.app/en/docs/entreprise/comptes-et-connexion/)

## In a pipeline

```yaml
- name: API smoke tests
  run: npx restorm-cli --open ./api.restorm --run "Smoke tests" --headless
  env:
    RESTORM_TOKEN: ${{ secrets.RESTORM_TOKEN }}
```

→ [Headless execution and CI](https://restorm.app/en/docs/scenarios/execution-headless-ci/)
· [All CLI arguments and output formats](https://restorm.app/en/docs/reference/cli/)
