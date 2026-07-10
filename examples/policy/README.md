# Sample policy config

A worked example of one organization's policy as it exists on **both sides** of
the publish pipeline described in
[`docs/SHIELD_POLICY_GUIDE.md`](../../docs/SHIELD_POLICY_GUIDE.md):

1. **`org-decision-matrix.example.json`** — the *Moku side*: how an org admin
   authors the config (sensitivity tiers, acknowledgements, and decision-matrix
   cells whose action is a `predicateKind` of `true` / `false` / `formula`).
   This is a readable illustration of the model, not a literal API payload —
   the real surface is `POST /api/v1/policy/org/{classifications,
   acknowledgements,policy/matrix,publications}`.

2. **`shield-bundle.example/`** — the *Shield side*: the eight flat-JSON files
   that the publisher produces and Shield loads (inside `config.tar.zst`), plus
   the `manifest.json`. This is what `predicateKind` desugars to:
   `true → allow`, `false → block`, `formula → remediate`.

## The scenario

Org **acme**, enrolled in HIPAA, with two sensitivity tiers (`public` default,
`confidential`). The intent:

- **SSN** may not go to `consumer` at all (block); it may go to `standard-api`
  only if anonymized **and** a signed BAA is attested (remediate).
- **Email** may go to `standard-api` only with redaction (remediate); allowed
  elsewhere.
- Anything tagged **confidential** is blocked from `consumer`.

Trace any cell from `org-decision-matrix.example.json` to its compiled rule in
`shield-bundle.example/rules.json` / `classification_rules.json`, then read
§1.3 of the Shield Policy guide to see how Shield evaluates it.

> Destinations are the fixed six; treatments are ranked (a rule's minimum is met
> by any treatment of equal-or-higher level). Load-time validation requires
> exactly one default classification and a `clear` treatment to exist.
