## Type of change
- [ ] New feature
- [ ] Bug fix
- [ ] Improvement / refactor
- [ ] Infrastructure / config
- [ ] Documentation

## Related issue
Closes #

## Changes made
<!--
Bullet list of what changed and WHY.
"Why" is mandatory — reviewers should not have to guess intent.
-->
-
-

## Testing
<!--
1. Which suite covers this? `./backend/scripts/run_tests.sh` runs them all.
2. Manual scenario — what did you upload/click/call, and what did you verify?
-->

## Checklist
- [ ] `./backend/scripts/run_tests.sh` passes
- [ ] New tests written for new logic
- [ ] No `print()`, `console.log()`, or debug statements left in the diff
- [ ] Alembic migration created if any DB model changed
- [ ] `infra/.env.example` updated if a new environment variable was added
- [ ] `docker compose config` still resolves if compose or a Dockerfile changed
- [ ] PR is under **500 lines changed** — if over, split into smaller PRs
- [ ] No secrets, credentials, or model weights in the diff
