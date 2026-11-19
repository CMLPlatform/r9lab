# Backend Tests

Fast unit tests stay separate from persistence, runtime and end-to-end tests. The shared
fixtures are `db_session`, `db_user`, `db_superuser`, `api_client`, `api_client_user`,
`api_client_superuser`, and `redis_client`.

## Tiers

### `tests/unit/`

Isolated fast tests only.

- No Docker, database or real app lifespan.
- Prefer local stubs, parametrization, function-based tests and small files that each cover one
  behavior.
- Patch the owning module (`product_commands`, `product_tree_queries`), not a facade.
- Keep helper modules local to one test area.

### `tests/integration/api/`

Request/response behavior against the ASGI app with real routing and dependency overrides.

- Fixtures: `api_client`, `api_client_user`, `api_client_superuser`, `db_session`
- One endpoint behavior per test; multi-step stories go in `tests/integration/flows/`
- Prefer small files such as `*_public_*`, `*_membership_*`, `*_callbacks_*`
- Keep fixture and plugin modules separate from helper modules, so pytest plugin loading stays explicit

### `tests/integration/db/`

ORM models, CRUD, queries, and migrations against a real database, without HTTP routing.

- Fixtures: `db_session`, seed/data fixtures, factories

### `tests/integration/core/`

Runtime integration that is neither an HTTP request test nor a persistence test: lifespan, logging,
cache wiring, file cleanup, migration behavior. One subsystem per test.

### `tests/integration/flows/`

A few multi-step journeys that cross feature boundaries, such as authenticate -> mutate -> fetch or
camera setup -> record -> persist. Keep them few. They are slower than the other tiers.

### `tests/benchmarks/`

CPU benchmarks for backend hot paths (image uploads, product create validation, the component tree
read and the export), written with `pytest-codspeed`. They use no database or network and start
from rows built in memory. The CodSpeed workflow measures them on every pull request that touches
the backend. `just bench` and `just test` run them once as plain tests.

## Assertions

- Assert what tells the paths apart, not just the outcome. Several paths often end in one
  response (`images.py` answers 400 for a missing, non-integer and non-positive `product_id`). A
  test that checks only the status keeps passing after the guard it was written for is gone. Assert
  the `detail`, the close `reason`, or an effect: a collaborator not reached, a queue left empty.
- Sentinels have the same problem: `read_token` returns `None` from five paths.
- Break what a new test covers and watch it fail before you trust it.
- To find gaps, replace a guard with `if False:` and run `tests/unit tests/integration`. A guard
  that breaks nothing is untested, or only covered by an assertion another path also satisfies.

## Mutation testing

`just mutation` runs mutmut over `app/` against one throwaway Postgres. The Ops workflow runs it
monthly in shards by package and uploads each shard's survivor list. It never fails on survivors.
It lists the functions with more survivors than `tests/mutation-baseline.txt`. For each one, add the
missing assertion, or rebaseline with `just mutation-baseline` when the survivor is deliberate (a
guard for a state that cannot occur).

A full run is heavy, so leave it to the Ops job. Locally it runs at low priority on half the cores
(set `MUTMUT_JOBS` to change that). Pass mutant globs to narrow a local run:
`just mutation 'app.core.images*'`. Results are cached in `mutants/`. After you add an assertion,
rerun with that function's glob or delete `mutants/`, or the old verdict stands. Rebaseline only
from a full run, because it replaces the file. From an Ops run:

```sh
gh run download <run-id> -p 'ops-backend-mutation-*' -D reports/mutation/ops
cat reports/mutation/ops/*/survivors.txt | sort > reports/mutation/survivors.txt
just mutation-baseline
```

`just mutation-release` runs mutmut over `scripts/build_dataset_release.py` alone, from a copy of
the backend with its own mutmut config. It takes a few minutes and needs no database. It writes
every survivor to `reports/mutation/release-survivors.txt`. It fails while `select_records`,
`pseudonymise_owners`, `check_salt_fingerprint`, `verify` or `forbidden_values` has more survivors
than the baseline allows, because those functions decide what a release publishes, and a release
cannot be undone. The baseline's `scripts.` lines are its equivalent mutants, each with the reason
after a `#`. `just mutation-baseline` keeps them.

mutmut skips decorated functions, so it never mutates route handlers. For guards in a handler body
(such as the empty-upload check in the camera preview upload), use the `if False:` check above.

mutmut does not mutate log calls, but only on the call's first line. It still mutates the argument
lines of a multi-line call, and their survivors belong in the baseline.

## API fuzzing

`tests/integration/api/test_schemathesis.py` fuzzes every GET route in the public OpenAPI schema
with Schemathesis, once as a guest and once logged in. It fails on a 500 or on a response body
the schema does not describe. Each test is one pytest item. A failing route shows as a subtest
with the request that broke it. The integration suite tries 5 examples per route and skips
Schemathesis's coverage phase, which sends hundreds of boundary cases per route. `just fuzz` tries
100 (`just fuzz 20` for fewer) and adds the coverage phase; the Ops workflow runs it weekly. The
OAuth callbacks are fuzzed too: a fuzzed `state` never verifies, so they answer 400 before any
request reaches the provider.
