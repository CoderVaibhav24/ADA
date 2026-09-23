# ADA ICMS — one operational entry point. `make` or `make help` prints the menu.
#
# Written for GNU Make 3.81 (what macOS ships): no .ONESHELL, so every recipe
# that needs state across lines is one shell joined with backslashes.

ROOT         := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
COMPOSE_FILE := $(ROOT)/infra/docker-compose.yml
COMPOSE      := docker compose -f $(COMPOSE_FILE)
VENV         := $(ROOT)/.venv
PY           := $(VENV)/bin/python
RUFF         := $(VENV)/bin/ruff
ALEMBIC      := $(VENV)/bin/alembic
API_DIR      := $(ROOT)/backend/api
CORE_DIR     := $(ROOT)/backend/shared/ada-core
FE_DIR       := $(ROOT)/frontend

# Overridable on the command line: make logs SERVICE=ada-api LINES=500
SERVICE  ?=
LINES    ?= 200
INTERVAL ?= 5
COUNT    ?= 12
CONFIRM  ?=

# The repo's ada-core mounted over the one baked into the ada/api image, so the
# schema commands run the migrations on disk rather than whatever the image has.
CORE_RUN := $(COMPOSE) run --rm --no-deps -v $(CORE_DIR):/src:ro -e PYTHONPATH=/src -w /src ada-api

.DEFAULT_GOAL := help

.PHONY: help up down restart ps build rebuild pull \
        logs tail health crashes stats watch \
        db-shell db-migrate db-current db-revisions \
        test test-api test-core lint \
        fe-dev fe-build fe-container \
        doctor nuke prune

# ---------------------------------------------------------------------------

##@ General

help: ## Print this help
	@printf '\n\033[1mADA ICMS — operations\033[0m\n'
	@printf 'Usage: make <target> [VAR=value]\n'
	@printf '   make            same as make help\n'
	@printf '   make help       this menu (targets are read from this file, so it cannot drift)\n'
	@printf '   make -n TARGET  dry run: print the commands without running them\n'
	@printf '   make doctor     check the whole stack and say what is wrong\n'
	@awk 'BEGIN {FS = ":.*?## "} \
		/^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5); next} \
		/^[a-zA-Z0-9_%-]+:.*?## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@printf '\n\033[1mVariables\033[0m\n'
	@printf '  SERVICE=<name>  one compose service (up, down, restart, build, rebuild, logs, tail)\n'
	@printf '  LINES=%-9s log lines for tail/logs\n' '$(LINES)'
	@printf '  INTERVAL=%-6s seconds between watch polls    COUNT=%s polls\n' '$(INTERVAL)' '$(COUNT)'
	@printf '  CONFIRM=yes     required by the destructive targets (nuke, prune)\n'
	@printf '\n\033[1mKnown broken\033[0m\n'
	@printf '  ada-ml does not BUILD: onnxruntime-gpu==1.22.0 was pulled from PyPI\n'
	@printf '  (backend/ml/Dockerfile:48; PyPI now has 1.29.0 / 1.30.0). The pin is a\n'
	@printf '  pending decision, not a bug to patch. Every target here works around it:\n'
	@printf '  `make build` skips ada-ml, and `make up` reuses the ada/ml:0.1.0 image\n'
	@printf '  already on disk. Use `make build SERVICE=ada-ml` to see the failure.\n\n'

##@ Stack

up: ## Start the stack (SERVICE= for one); never rebuilds, so a broken ada-ml build cannot block it
	$(COMPOSE) up -d --no-build $(SERVICE)

down: ## Stop and remove containers; volumes and data survive (see nuke)
	$(COMPOSE) down $(SERVICE)

restart: ## Restart containers in place without recreating them
	$(COMPOSE) restart $(SERVICE)

ps: ## List the project's containers
	$(COMPOSE) ps -a

build: ## Build every buildable image, skipping ada-ml because its GPU pin is gone
	$(COMPOSE) build ada-auth ada-notify ada-api frontend

rebuild: ## Rebuild one service from scratch and recreate it — needs SERVICE=
	@test -n "$(SERVICE)" || { printf 'rebuild needs a service: make rebuild SERVICE=ada-api\n'; exit 2; }
	$(COMPOSE) build --no-cache $(SERVICE)
	$(COMPOSE) up -d --force-recreate --no-deps $(SERVICE)

pull: ## Pull the third-party images (postgres, redis, keycloak, mailpit, nginx)
	$(COMPOSE) pull --ignore-buildable

##@ Logs & monitoring

logs: ## Follow logs — all services, or SERVICE=ada-api for one
	$(COMPOSE) logs -f --tail=$(LINES) $(SERVICE)

logs-%: ## Follow one service by name, e.g. make logs-ada-api
	$(COMPOSE) logs -f --tail=$(LINES) $*

tail: ## Print the last LINES= lines and exit (no follow)
	$(COMPOSE) logs --tail=$(LINES) $(SERVICE)

health: ## Table of every service: state, health, exit code, published ports
	@printf '\033[1m%-16s %-9s %-10s %-5s %s\033[0m\n' SERVICE STATE HEALTH EXIT PORTS
	@$(COMPOSE) ps -a --format '{{.Service}}|{{.State}}|{{.Health}}|{{.ExitCode}}|{{.Ports}}' \
		| awk -F'|' '{h=($$3==""?"-":$$3); p=($$5==""?"-":$$5); printf "%-16s %-9s %-10s %-5s %s\n", $$1, $$2, h, $$4, p}'

crashes: ## List containers that exited non-zero and dump their last 50 log lines
	@bad=$$($(COMPOSE) ps -a --format '{{.Service}}|{{.State}}|{{.ExitCode}}' \
		| awk -F'|' '$$2=="exited" && $$3!="0" {print $$1}'); \
	if [ -z "$$bad" ]; then printf 'No container has exited non-zero.\n'; \
	else for s in $$bad; do \
		printf '\n\033[31m=== %s crashed ===\033[0m\n' "$$s"; \
		$(COMPOSE) logs --tail=50 "$$s"; \
	done; fi
	@$(COMPOSE) ps -a --format '{{.Service}}|{{.State}}|{{.Health}}' \
		| awk -F'|' '$$3=="unhealthy" {printf "\033[33mWARN  %s is running but unhealthy — make logs SERVICE=%s\033[0m\n", $$1, $$1}'

stats: ## Live CPU/memory/IO for the project's containers (Ctrl-C to exit)
	@ids=$$($(COMPOSE) ps -q); \
	if [ -z "$$ids" ]; then printf 'Nothing is running — make up\n'; exit 1; fi; \
	docker stats $$ids

watch: ## Poll the health table COUNT times every INTERVAL seconds, printing only changes
	@prev=''; i=0; \
	while [ $$i -lt $(COUNT) ]; do \
		now=$$($(COMPOSE) ps -a --format '{{.Service}}|{{.State}}|{{.Health}}' | sort); \
		if [ "$$now" != "$$prev" ]; then \
			printf '\n\033[1m[%s] state changed\033[0m\n' "$$(date +%H:%M:%S)"; \
			printf '%s\n' "$$now" | awk -F'|' '{h=($$3==""?"-":$$3); printf "  %-16s %-9s %s\n", $$1, $$2, h}'; \
			prev="$$now"; \
		fi; \
		i=$$((i+1)); \
		if [ $$i -lt $(COUNT) ]; then sleep $(INTERVAL); fi; \
	done; \
	printf '\nwatch finished after %s polls\n' '$(COUNT)'

##@ Database

db-shell: ## Interactive psql in the local dev postgres container
	@$(COMPOSE) exec postgres sh -lc 'exec psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

db-migrate: ## Bring the schema to head via ada_core.migrate, using the repo's migrations
	$(CORE_RUN) python -m ada_core.migrate

db-current: ## Show the revision the database is on and the head the repo expects
	@db=$$($(COMPOSE) exec -T postgres sh -lc 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -Atc "select version_num from alembic_version"' 2>/dev/null | tr -d '\r'); \
	head=$$(cd $(CORE_DIR) && $(ALEMBIC) -c alembic.ini heads 2>/dev/null | awk '{print $$1; exit}'); \
	printf 'database : %s\n' "$${db:-<unknown - is postgres up?>}"; \
	printf 'repo head: %s\n' "$${head:-<unknown - is .venv built?>}"; \
	if [ -n "$$db" ] && [ -n "$$head" ] && [ "$$db" != "$$head" ]; then \
		printf '\033[33mBehind — run: make db-migrate\033[0m\n'; exit 1; fi

db-revisions: ## Print the migration history (does not touch the database)
	@cd $(CORE_DIR) && $(ALEMBIC) -c alembic.ini history

##@ Testing

test: test-core test-api ## Run both Python suites

test-api: ## Run the ada-api suite
	cd $(API_DIR) && $(PY) -m pytest -q

test-core: ## Run the ada-core suite
	cd $(CORE_DIR) && $(PY) -m pytest -q

lint: ## ruff over both Python packages, then oxlint over every JS workspace
	$(RUFF) check $(API_DIR) $(CORE_DIR)
	@if [ -d $(ROOT)/node_modules ]; then cd $(ROOT) && npm run --silent lint; \
	else printf 'skipped JS lint — run npm install first\n'; fi

##@ Frontend

fe-dev: ## Vite dev server on the host; the root script builds @ada/shared first
	cd $(ROOT) && npm run dev

fe-build: ## Build the production bundle; the root script builds @ada/shared first
	cd $(ROOT) && npm run build

fe-container: ## Build and run the frontend image, then prove it serves / and a deep link
	$(COMPOSE) build frontend
	$(COMPOSE) up -d --no-deps frontend
	@port=$$($(COMPOSE) port frontend 80 | sed 's/.*://'); \
	printf 'waiting for nginx on :%s' "$$port"; \
	i=0; while [ $$i -lt 20 ]; do \
		if curl -sS -o /dev/null http://localhost:$$port/ 2>/dev/null; then break; fi; \
		printf '.'; sleep 1; i=$$((i+1)); \
	done; printf '\n'; \
	root=$$(curl -sS -o /dev/null -w '%{http_code}' http://localhost:$$port/); \
	deep=$$(curl -sS -o /dev/null -w '%{http_code}' http://localhost:$$port/complaints); \
	miss=$$(curl -sS -o /dev/null -w '%{http_code}' http://localhost:$$port/assets/does-not-exist.js); \
	printf '  /                        %s\n' "$$root"; \
	printf '  /complaints (deep link)  %s\n' "$$deep"; \
	printf '  /assets/missing.js       %s (404 expected)\n' "$$miss"; \
	if [ "$$root" = "200" ] && [ "$$deep" = "200" ] && [ "$$miss" = "404" ]; then \
		printf '\033[32mPASS  frontend serves the SPA at http://localhost:%s/\033[0m\n' "$$port"; \
	else printf '\033[31mFAIL  frontend is not serving correctly\033[0m\n'; exit 1; fi

##@ Diagnostics

doctor: ## Check daemon, services, ports, .env, schema and image freshness; non-zero on failure
	@fail=0; \
	printf '\n\033[1m== ADA doctor ==\033[0m\n\n'; \
	if docker info >/dev/null 2>&1; then printf 'PASS  docker daemon reachable\n'; \
	else printf 'FAIL  docker daemon unreachable — start Docker Desktop\n'; exit 1; fi; \
	if $(COMPOSE) config --quiet >/dev/null 2>&1; then printf 'PASS  compose file parses\n'; \
	else printf 'FAIL  compose file will not parse — a required key is missing from infra/.env\n'; fail=$$((fail+1)); fi; \
	if [ -f $(ROOT)/infra/.env ]; then printf 'PASS  infra/.env present (contents never read by this Makefile)\n'; \
	else printf 'FAIL  infra/.env missing — copy infra/.env.example and fill it in\n'; fail=$$((fail+1)); fi; \
	if [ -x $(PY) ]; then printf 'PASS  host venv at .venv\n'; \
	else printf 'FAIL  no .venv — the test and schema targets need it\n'; fail=$$((fail+1)); fi; \
	printf '\n\033[1m-- services --\033[0m\n'; \
	snap=$$($(COMPOSE) ps -a --format '{{.Service}}|{{.State}}|{{.Health}}'); \
	for s in postgres redis keycloak mailpit ada-auth ada-notify ada-worker ada-ml ada-api frontend; do \
		line=$$(printf '%s\n' "$$snap" | awk -F'|' -v s="$$s" '$$1==s {print $$2"|"$$3}'); \
		state=$$(printf '%s' "$$line" | cut -d'|' -f1); health=$$(printf '%s' "$$line" | cut -d'|' -f2); \
		case "$$s" in postgres|ada-api|frontend) crit=1;; *) crit=0;; esac; \
		if [ "$$state" = "running" ] && [ "$$health" != "unhealthy" ]; then printf 'PASS  %-14s running %s\n' "$$s" "$$health"; \
		elif [ "$$crit" = "1" ]; then printf 'FAIL  %-14s %s — make up SERVICE=%s\n' "$$s" "$${state:-not created}" "$$s"; fail=$$((fail+1)); \
		else printf 'WARN  %-14s %s\n' "$$s" "$${state:-not created}"; fi; \
	done; \
	printf '\n\033[1m-- published ports --\033[0m\n'; \
	for pair in postgres:5432 keycloak:8090 ada-api:8000 frontend:80; do \
		svc=$${pair%%:*}; cport=$${pair##*:}; \
		hp=$$($(COMPOSE) port "$$svc" "$$cport" 2>/dev/null | head -1 | sed 's/.*://'); \
		if [ -z "$$hp" ]; then printf 'WARN  %-14s no published port (container not running)\n' "$$svc"; \
		elif nc -z 127.0.0.1 "$$hp" >/dev/null 2>&1; then printf 'PASS  %-14s listening on %s\n' "$$svc" "$$hp"; \
		else printf 'FAIL  %-14s port %s published but nothing is listening\n' "$$svc" "$$hp"; fail=$$((fail+1)); fi; \
	done; \
	printf '\n\033[1m-- schema --\033[0m\n'; \
	db=$$($(COMPOSE) exec -T postgres sh -lc 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -Atc "select version_num from alembic_version"' 2>/dev/null | tr -d '\r'); \
	head=$$(cd $(CORE_DIR) && $(ALEMBIC) -c alembic.ini heads 2>/dev/null | awk '{print $$1; exit}'); \
	if [ -z "$$db" ]; then printf 'FAIL  cannot read alembic_version — postgres down or never migrated\n'; fail=$$((fail+1)); \
	elif [ "$$db" = "$$head" ]; then printf 'PASS  schema at %s (repo head)\n' "$$db"; \
	else printf 'FAIL  database at %s, repo head is %s — make db-migrate\n' "$$db" "$${head:-?}"; fail=$$((fail+1)); fi; \
	printf '\n\033[1m-- image freshness --\033[0m\n'; \
	repo_r=$$(ls $(CORE_DIR)/ada_core/alembic/versions/*.py 2>/dev/null | wc -l | tr -d ' '); \
	repo_routers=$$(ls $(API_DIR)/app/routers/*.py 2>/dev/null | xargs -n1 basename 2>/dev/null | sort | tr '\n' ' '); \
	img=$$($(COMPOSE) exec -T ada-api sh -lc 'python -c "import ada_core,os,glob;print(len(glob.glob(os.path.join(os.path.dirname(ada_core.__file__),\"alembic\",\"versions\",\"*.py\"))))"; ls /app/app/routers/*.py | xargs -n1 basename | sort | tr "\n" " "' 2>/dev/null); \
	img_r=$$(printf '%s\n' "$$img" | head -1 | tr -d ' \r'); \
	img_routers=$$(printf '%s\n' "$$img" | sed -n '2p' | tr -d '\r'); \
	if [ -z "$$img_r" ]; then printf 'WARN  ada-api not running — cannot compare its image with the repo\n'; \
	else \
		if [ "$$img_r" -lt "$$repo_r" ]; then printf 'FAIL  ada/api image has %s migrations, repo has %s — make rebuild SERVICE=ada-api\n' "$$img_r" "$$repo_r"; fail=$$((fail+1)); \
		else printf 'PASS  ada/api image carries all %s migrations\n' "$$repo_r"; fi; \
		if [ "$$img_routers" != "$$repo_routers" ]; then printf 'FAIL  ada/api image routers differ from the repo — make rebuild SERVICE=ada-api\n'; fail=$$((fail+1)); \
		else printf 'PASS  ada/api image routers match the repo\n'; fi; \
	fi; \
	printf '\n\033[1m-- known broken --\033[0m\n'; \
	printf 'NOTE  ada-ml will not build: onnxruntime-gpu==1.22.0 is gone from PyPI\n'; \
	printf '      (backend/ml/Dockerfile:48). The pin is an open decision; the\n'; \
	printf '      ada/ml:0.1.0 image on disk predates it, so make up still works.\n'; \
	printf '\n'; \
	if [ "$$fail" = "0" ]; then printf '\033[32mdoctor: all critical checks passed\033[0m\n\n'; \
	else printf '\033[31mdoctor: %s critical check(s) failed\033[0m\n\n' "$$fail"; exit 1; fi

##@ Destructive (each refuses without CONFIRM=yes)

nuke: ## DESTROYS the database and every volume — make nuke CONFIRM=yes
	@test "$(CONFIRM)" = "yes" || { printf '\033[31mrefusing: this deletes ada_pgdata (every case, zone and notice).\nRun: make nuke CONFIRM=yes\033[0m\n'; exit 2; }
	$(COMPOSE) down -v --remove-orphans

prune: ## Reclaim disk by deleting unused images and build cache — make prune CONFIRM=yes
	@test "$(CONFIRM)" = "yes" || { printf '\033[31mrefusing: this removes images other projects may need, including ada/ml:0.1.0\nwhich CANNOT be rebuilt right now. Run: make prune CONFIRM=yes\033[0m\n'; exit 2; }
	docker system prune -f
