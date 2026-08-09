# scripts

Reserved for repository-wide tooling scripts that don't belong to a single
package (the driver/ride simulator, load-test harnesses, etc. — Phase 6/19).

Database tooling (`db:migrate` / `db:seed` / `db:reset`) lives in
`packages/database` instead, since it's tightly coupled to the schema
package rather than being a standalone script — see
[`docs/database.md`](../docs/database.md).
