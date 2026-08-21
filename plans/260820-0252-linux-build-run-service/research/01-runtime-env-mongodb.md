# Research index: runtime and MongoDB

Historical research index for a superseded predecessor plan. Current acceptance
status is maintained by `../../260820-0912-revalidation-build-run-service/`.

Full evidence: [runtime-env-mongodb](../../reports/researcher-260820-0252-runtime-env-mongodb.md).

Key constraints: `dotenvy::dotenv().ok()` already loads a working-directory
dotenv file before CLI parsing; explicit CLI flags override environment values;
the server creates MongoDB only when both `MONGODB_URI` and
`MONGODB_DATABASE` are present; project terminal `env_file` is not server
configuration; production must keep the no-auth guard fail-closed. The
implementation should narrow selected MongoDB values into a private runtime
environment file rather than copying a generic dotenv file into `/opt`.
