# ADA ICMS — developer entry point. `make` or `make help` prints the menu.
#
# Dev model: infrastructure in Docker, services native.
#   make infra             postgres, redis, keycloak, mailpit, kong (containers)
#   make api / ml / auth / notify / worker / web
#                          each service on the host, one terminal each, with reload
#   make up-full           the whole stack in containers instead (compose --profile full)
#
# Native targets source infra/compose/.env, then point every connection string at
# the 127.0.0.1 ports the infra containers publish: in-network names such as
# `postgres` or `keycloak` do not resolve on the host.
#
# Written for GNU Make 3.81 (what macOS ships): no .ONESHELL, so every recipe
# that needs state across lines is one shell joined with backslashes.

ROOT         := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
COMPOSE_FILE := $(ROOT)/infra/compose/docker-compose.yml
ENV_FILE     := $(ROOT)/infra/compose/.env
COMPOSE      := docker compose -f $(COMPOSE_FILE)
VENV         := $(ROOT)/.venv
PY           := $(VENV)/bin/python
UVICORN      := $(VENV)/bin/uvicorn
RUFF         := $(VENV)/bin/ruff
ALEMBIC      := $(VENV)/bin/alembic
CORE_DIR     := $(ROOT)/libs/python/ada-core
PLATFORM_DIR := $(ROOT)/libs/python/ada-platform
API_DIR      := $(ROOT)/services/api
ML_DIR       := $(ROOT)/services/ml-worker
AUTH_DIR     := $(ROOT)/services/auth-otp
NOTIFY_DIR   := $(ROOT)/services/notify
RELOAD_LIBS  := --reload-dir . --reload-dir $(ROOT)/libs/python

# Overridable on the command line: make infra-logs SERVICE=keycloak
SERVICE ?=
CONFIRM ?=
# Where api/auth/ml/notify listen. Kong reaches them via host.docker.internal,
# which on Linux is the docker bridge, not loopback: use BIND=0.0.0.0 there.
BIND    ?= 127.0.0.1

# Shell prelude for every native target: export .env, then host-side URLs.
NATIVE_ENV = set -a; \
	if [ -f "$(ENV_FILE)" ]; then . "$(ENV_FILE)"; \
	else echo "missing $(ENV_FILE) — copy infra/compose/.env.example and fill it in" >&2; exit 1; fi; \
	PG_HOST_AUTH="$$POSTGRES_USER:$$POSTGRES_PASSWORD@127.0.0.1:$${POSTGRES_PORT:-5432}"; \
	DATABASE_URL="$${DATABASE_URL:-postgresql+psycopg2://$$PG_HOST_AUTH/$$POSTGRES_DB}"; \
	KC_HOST_ISSUER="http://127.0.0.1:$${KC_HTTP_HOST_PORT:-8090}$${KC_HTTP_RELATIVE_PATH:-/idp}/realms/$${ADA_REALM:-pcsmcpl}"; \
	ADA_INTERNAL_ISSUER_URL="$$KC_HOST_ISSUER"; \
	ADA_REDIS_URL="redis://:$$REDIS_PASSWORD@127.0.0.1:$${REDIS_HOST_PORT:-6379}/0"; \
	NOTIFY_DATABASE_URL="postgresql+asyncpg://$$PG_HOST_AUTH/$${POSTGRES_NOTIFY_DB:-ada_notify}"; \
	set +a;

.DEFAULT_GOAL := help

.PHONY: help infra infra-down infra-logs up-full down-full \
        migrate db-shell db-current \
        api ml auth notify worker web field \
        test test-api test-core lint typecheck openapi \
        gateway-sync nuke

# ---------------------------------------------------------------------------

##@ General

help: ## Print this help
	@printf '\n\033[1mADA ICMS — developer targets\033[0m\n'
	@printf 'Usage: make <target> [VAR=value]      make -n <target> prints without running\n'
	@awk 'BEGIN {FS = ":.*?## "} \
		/^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5); next} \
		/^[a-zA-Z0-9_%-]+:.*?## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@printf '\n\033[1mVariables\033[0m\n'
	@printf '  SERVICE=<name>  one compose service for infra-logs\n'
	@printf '  CONFIRM=yes     required by nuke\n'
	@printf '  BIND=0.0.0.0    api/auth/ml/notify listen address (default 127.0.0.1);\n'
	@printf '                  needed on Linux when using the gateway: make api BIND=0.0.0.0\n\n'

##@ Containers

infra: ## Start postgres, redis, keycloak, mailpit and kong; waits until healthy
	$(COMPOSE) up -d --wait --wait-timeout 300

infra-down: ## Stop the infrastructure containers; volumes survive (see nuke)
	$(COMPOSE) down

infra-logs: ## Follow infrastructure logs (SERVICE=keycloak for one)
	$(COMPOSE) logs -f --tail 200 $(SERVICE)

up-full: ## Whole stack in containers (profile full); kong routes to ada-api/ada-auth
	KONG_UPSTREAM_API=http://ada-api:8000 KONG_UPSTREAM_AUTH=http://ada-auth:8002 \
		$(COMPOSE) --profile full up -d

down-full: ## Stop the whole containerised stack; volumes survive
	$(COMPOSE) --profile full down

##@ Database

migrate: ## Bring the schema to head (ada_core.migrate) using DATABASE_URL from .env
	@$(NATIVE_ENV) cd $(CORE_DIR) && $(PY) -m ada_core.migrate

db-shell: ## Interactive psql in the postgres container
	@$(COMPOSE) exec postgres sh -lc 'exec psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

db-current: ## Show the revision the database is on and the head the repo expects
	@db=$$($(COMPOSE) exec -T postgres sh -lc 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -Atc "select version_num from alembic_version"' 2>/dev/null | tr -d '\r'); \
	head=$$(cd $(CORE_DIR) && $(ALEMBIC) -c alembic.ini heads 2>/dev/null | awk '{print $$1; exit}'); \
	printf 'database : %s\n' "$${db:-<unknown - is postgres up?>}"; \
	printf 'repo head: %s\n' "$${head:-<unknown - is .venv built?>}"; \
	if [ -n "$$db" ] && [ -n "$$head" ] && [ "$$db" != "$$head" ]; then \
		printf '\033[33mBehind — run: make migrate\033[0m\n'; exit 1; fi

##@ Services (native, one terminal each; needs make infra)

api: ## ada-api on :BACKEND_PORT (8000) with reload
	@$(NATIVE_ENV) cd $(API_DIR) && \
	OIDC_ISSUER="$${OIDC_ISSUER:-$$ADA_ISSUER}" OIDC_INTERNAL_ISSUER_URL="$$KC_HOST_ISSUER" \
	OIDC_ADMIN_CLIENT_ID="$${ADA_API_CLIENT_ID:-ada-api}" OIDC_ADMIN_CLIENT_SECRET="$${ADA_API_CLIENT_SECRET:-}" \
	ML_SERVICE_URL="http://127.0.0.1:$${ML_PORT:-8100}" WEBSITE_ORIGIN="$${APP_ORIGIN:-http://localhost:5173}" \
	exec $(UVICORN) app.main:app --reload $(RELOAD_LIBS) --host $(BIND) --port $${BACKEND_PORT:-8000}

ml: ## ada-ml on :ML_PORT (8100) with reload; migrates the schema on startup
	@$(NATIVE_ENV) cd $(ML_DIR) && \
	NOTIFY_URL="http://127.0.0.1:$${ADA_NOTIFY_PORT:-8001}" NOTIFY_ISSUER="$$KC_HOST_ISSUER" \
	NOTIFY_CLIENT_ID="$${NOTIFY_CLIENT_ID:-ada-ml}" NOTIFY_CLIENT_SECRET="$$ADA_ML_CLIENT_SECRET" \
	APP_ORIGIN="$${APP_ORIGIN:-http://localhost:5173}" \
	exec $(UVICORN) app.main:app --reload $(RELOAD_LIBS) --host $(BIND) --port $${ML_PORT:-8100}

auth: ## ada-auth (OTP) on :ADA_AUTH_PORT (8002) with reload
	@$(NATIVE_ENV) cd $(AUTH_DIR) && \
	ADA_AUTH_SMTP_HOST=127.0.0.1 ADA_AUTH_SMTP_PORT="$${MAILPIT_SMTP_PORT:-1025}" \
	exec $(UVICORN) app.main:app --reload $(RELOAD_LIBS) --host $(BIND) --port $${ADA_AUTH_PORT:-8002} --no-server-header

notify: ## ada-notify on :ADA_NOTIFY_PORT (8001) with reload; runs its alembic first
	@$(NATIVE_ENV) cd $(NOTIFY_DIR) && export ADA_DATABASE_URL="$$NOTIFY_DATABASE_URL" && \
	$(ALEMBIC) upgrade head && \
	exec $(UVICORN) app.main:app --reload $(RELOAD_LIBS) --host $(BIND) --port $${ADA_NOTIFY_PORT:-8001} --no-server-header

worker: ## ada-notify delivery worker (python -m app.worker); no reload
	@$(NATIVE_ENV) cd $(NOTIFY_DIR) && \
	ADA_DATABASE_URL="$$NOTIFY_DATABASE_URL" ADA_SMTP_HOST=127.0.0.1 ADA_SMTP_PORT="$${MAILPIT_SMTP_PORT:-1025}" \
	ADA_ADMIN_CLIENT_ID="$${ADA_ADMIN_CLIENT_ID:-ada-notify}" ADA_ADMIN_CLIENT_SECRET="$$ADA_NOTIFY_CLIENT_SECRET" \
	ADA_FCM_SERVICE_ACCOUNT_FILE="$(ROOT)/infra/secrets/fcm-service-account.json" \
	ADA_APNS_KEY_FILE="$(ROOT)/infra/secrets/apns-key.p8" \
	exec $(PY) -m app.worker

web: ## Vite dev server for apps/web (builds @ada/shared first)
	cd $(ROOT) && npm run dev

field: ## Expo dev server for apps/field
	cd $(ROOT) && npm run dev -w @ada/field

##@ Quality

test: ## Every Python suite, then npm test (notify's 3 live-stack tests deselected)
	cd $(CORE_DIR) && $(PY) -m pytest -q
	cd $(PLATFORM_DIR) && $(PY) -m pytest -q
	cd $(API_DIR) && $(PY) -m pytest -q
	cd $(ML_DIR) && $(PY) -m pytest -q
	cd $(AUTH_DIR) && $(PY) -m pytest -q
	cd $(NOTIFY_DIR) && $(PY) -m pytest -q \
		--deselect tests/test_ingestion.py::test_unauthenticated_is_refused \
		--deselect tests/test_ingestion.py::test_garbage_token_is_refused \
		--deselect tests/test_ingestion.py::test_wrong_auth_scheme_is_refused
	cd $(ROOT) && npm test

test-api: ## The ada-api suite only
	cd $(API_DIR) && $(PY) -m pytest -q

test-core: ## The ada-core suite only
	cd $(CORE_DIR) && $(PY) -m pytest -q

lint: ## ruff over libs/python and services, then every JS workspace's lint
	$(RUFF) check $(ROOT)/libs/python $(ROOT)/services
	cd $(ROOT) && npm run lint

typecheck: ## TypeScript typecheck across the workspaces
	cd $(ROOT) && npm run typecheck

openapi: ## Regenerate the typed API client from ada-api's OpenAPI (npm run api:types)
	cd $(ROOT) && npm run api:types

##@ Gateway

gateway-sync: ## Copy Keycloak's RS256 keys into infra/gateway/kong.yml and restart kong
	$(ROOT)/infra/gateway/sync-jwks.sh --restart

##@ Destructive

nuke: ## DESTROYS the databases and every volume — make nuke CONFIRM=yes
	@test "$(CONFIRM)" = "yes" || { printf '\033[31mrefusing: this deletes ada_pgdata (every case, zone and notice).\nRun: make nuke CONFIRM=yes\033[0m\n'; exit 2; }
	$(COMPOSE) --profile full --profile ota down -v --remove-orphans
