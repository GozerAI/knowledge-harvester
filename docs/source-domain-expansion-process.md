# Source and Domain Expansion Process

This repository should grow by following a fixed process, not by adding random sources whenever a new topic looks interesting.

The goal of this process is to:

- expand coverage deliberately
- keep the source catalog auditable
- prevent domain drift and duplicate sources
- preserve a bias-aware qualification path
- ensure every new domain or source has an operational reason to exist

## Expansion Principles

Every proposed domain or source should satisfy these principles:

- `Traceable demand`: there is a clear research, operational, or product need for the knowledge.
- `Structured yield`: the source is likely to produce reusable artifacts, not just noisy text.
- `Provenance`: the system can preserve where the material came from.
- `Qualification`: the source can be evaluated for coverage, legitimacy, and fit.
- `Reusability`: the artifacts are likely to support claims, graph edges, search, packaging, or downstream analysis.
- `Bias control`: additions should widen coverage responsibly, not only mirror current operator preferences.

## What Can Be Added

There are three valid expansion units:

1. `New source definition`
   Use this when the domain is already supported and the repo just needs another harvest target.

2. `New domain lens`
   Use this when the repo needs new classification language, artifact categories, or qualification logic to cover a new operational area.

3. `New ingestion mechanism`
   Use this only when YAML definitions are insufficient and a new harvester implementation is required.

Default to `new source definition` first. Only add a new domain or new ingestion mechanism when the existing taxonomy and YAML-based harvesting cannot express the need cleanly.

## Required Workflow

Every expansion should move through these stages.

### 1. Propose

Create a short proposal using [`domain-source-proposal.md`](./templates/domain-source-proposal.md).

The proposal must define:

- requester or sponsor
- target role or use case
- domain
- research objective
- expected artifact types
- expected categories
- candidate sources
- qualification and legitimacy criteria
- discard criteria
- bias risks

### 2. Check Existing Coverage

Before adding anything:

- inspect current YAML definitions in [`src/definitions`](../src/definitions)
- inspect current sourcing coverage through `/api/sourcing/requests`
- inspect existing artifacts, source records, claims, and graph coverage

Do not add a new source if the need is already covered by:

- an existing YAML definition
- an existing built-in harvester
- a domain already represented in current qualification logic

### 3. Choose The Smallest Valid Change

Prefer changes in this order:

1. update sourcing-request planner mappings only
2. add a new YAML definition
3. extend documentation normalization or classifier domain categories
4. add a new built-in harvester

If a proposal jumps to a larger change, it should explain why the smaller change was insufficient.

### 4. Define Qualification Rules

Every new source or domain must declare:

- what counts as a good result
- what counts as a duplicate
- what counts as irrelevant
- what counts as low-legitimacy or low-value
- which artifact families it should produce
- which categories it should tend to map to

At minimum, YAML definitions should include:

- `name`
- `description`
- `artifact_type`
- `queries`
- `validation`
- `metadata`

Use [`source-definition.yaml.example`](./templates/source-definition.yaml.example) as the baseline.

### 5. Implement

Implementation normally includes:

- one new YAML definition in [`src/definitions`](../src/definitions)
- taxonomy updates only if the current categories are insufficient
- planner updates if the new source should be recommended by role or domain
- README updates if the source or domain is operator-visible

Only add code outside those areas when the expansion truly needs a new ingestion path.

### 6. Verify

Every expansion should verify all of the following:

- YAML definition tests pass
- domain-specific tests pass when taxonomy changed
- sourcing qualification still recommends sensible sources
- full test suite remains green

The normal minimum verification set is:

```bash
node --test tests/harvesters/yaml-harvester.test.js
node --test tests/harvesters/yaml-harvester-normalizers.test.js
npm test
```

If planner mappings changed, also run:

```bash
node --test tests/processing/sourcing-request-planner.test.js
```

### 7. Record The Rationale

When the change ships, record:

- why the source or domain was added
- which role or research path it serves
- how it should be used in sourcing requests
- what signals should cause it to be revisited or removed later

## Guardrails

### Guardrail 1: Avoid novelty-only additions

A source is not valid just because it is interesting or new.

### Guardrail 2: Avoid opinion monocultures

Do not expand only around a single organization, platform, geography, or operator preference set.

### Guardrail 3: Avoid weak provenance

If the material cannot be traced or qualified, it should not become a first-class source.

### Guardrail 4: Prefer structured operational knowledge

Prefer policies, playbooks, checklists, specs, workflows, configs, and repeatable procedures over low-signal narrative content.

### Guardrail 5: Keep discardability explicit

Each source should make it clear what the harvester is expected to reject.

## When To Add A New Domain

Add a new domain only when at least one of these is true:

- current categories cannot describe the artifacts cleanly
- current sourcing qualification does not recommend sensible sources for the use case
- current graph or claim layers lose important meaning because the domain is flattened into generic docs

If the new artifacts fit existing categories, do not add a new domain label just for naming preference.

## When To Retire Or Rework A Source

Revisit a source when:

- source health becomes persistently poor
- yield is low and duplicates are high
- qualification repeatedly flags low coverage value
- the source is now redundant with a better source
- the source generates artifacts the current taxonomy cannot classify well

Retiring a source should preserve:

- source records
- operation logs
- sourcing request history
- the rationale for retirement

## Expected Future Operating Model

The standalone harvester remains the source of truth for:

- source definitions
- taxonomy
- qualification logic
- harvesting and cleaning behavior

C-Suite and other systems can propose or request new coverage, but accepted changes should land here so the source catalog does not drift across products.
