"""ICMS Batch 1 — the lookup endpoint, and the collection contract it proves.

`GET /api/icms/code-values` is the smallest endpoint in the batch, which makes
it the right place to hold the shared machinery to account: pagination, the sort
whitelist, the filter whitelist, `total`, the error envelope and the request id
are all general, and every register in Batches 2 to 6 inherits whatever is
asserted here.

The denial tests are not padding. The legacy ICMS routers are mounted with no
authentication middleware at all (`server.js` lines 499-542), and a suite of
happy paths would not have noticed for a moment.
"""

from __future__ import annotations

from tests.conftest import LEAD, NODAL, SUPER_ADMIN, SURVEYOR

ROLES = (SUPER_ADMIN, NODAL, SURVEYOR, LEAD)
CODE_VALUES = "/api/icms/code-values"

# A sort value that is a statement fragment rather than a key. If the whitelist
# ever stopped working, this is the shape of thing that would reach the SQL.
INJECTION = "id) UNION SELECT 1 --"


def error_of(response):
    """The envelope's error object, asserted to be the right shape first."""
    body = response.json()
    assert set(body) == {"error"}, body
    error = body["error"]
    assert set(error) == {"code", "message", "field", "allowed", "request_id"}, error
    assert isinstance(error["code"], str) and error["code"]
    assert isinstance(error["message"], str) and error["message"]
    assert error["request_id"], "every error carries the id of the request that caused it"
    return error


# --------------------------------------------------------------- happy path
class TestReads:
    def test_a_domain_comes_back_in_its_declared_order(self, icms_client, code_values):
        response = icms_client.sign_in(SUPER_ADMIN).get(
            CODE_VALUES, params={"domain": "complaint_type"})

        assert response.status_code == 200
        body = response.json()
        assert [item["code"] for item in body["items"]] == [
            "unauthorised_construction", "deviation_from_plan", "encroachment",
        ]
        assert body["total"] == 3

    def test_the_envelope_has_every_field_the_contract_promises(
        self, icms_client, code_values
    ):
        body = icms_client.sign_in(NODAL).get(CODE_VALUES).json()

        assert set(body) == {
            "items", "page", "size", "total", "pages", "sort", "next_cursor",
        }
        assert (body["page"], body["size"], body["sort"]) == (1, 200, "sort_order")

    def test_retired_values_are_hidden_unless_asked_for(self, icms_client, code_values):
        client = icms_client.sign_in(SUPER_ADMIN)

        active = client.get(CODE_VALUES, params={"domain": "complaint_type"}).json()
        retired = client.get(
            CODE_VALUES, params={"domain": "complaint_type", "active": "false"}).json()

        assert "illegal_colony" not in [item["code"] for item in active["items"]]
        assert [item["code"] for item in retired["items"]] == ["illegal_colony"]

    def test_repeated_values_of_one_filter_or_together(self, icms_client, code_values):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CODE_VALUES, params=[("domain", "complaint_type"), ("domain", "property_type")]
        ).json()

        assert body["total"] == 5
        assert {item["domain"] for item in body["items"]} == {
            "complaint_type", "property_type"}

    def test_search_matches_the_label(self, icms_client, code_values):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CODE_VALUES, params={"q": "encroach"}).json()

        assert [item["code"] for item in body["items"]] == ["encroachment"]
        assert body["total"] == 1

    def test_a_wildcard_in_the_search_term_is_not_a_wildcard(
        self, icms_client, code_values
    ):
        """`escape_like` is what stops `%` matching everything, which reads as a
        broken search rather than as the SQL feature it is."""
        body = icms_client.sign_in(SUPER_ADMIN).get(CODE_VALUES, params={"q": "%"}).json()

        assert body["total"] == 0


# ------------------------------------------------------------- authentication
class TestAuthentication:
    def test_no_token_is_refused(self, anonymous_client):
        response = anonymous_client.get(CODE_VALUES)

        assert response.status_code == 401
        assert error_of(response)["code"] == "unauthenticated"

    def test_the_refusal_keeps_the_header_a_client_refreshes_on(self, anonymous_client):
        """Dropping WWW-Authenticate would undo the reason ADAAuth sets it: a
        client holding a short-lived token needs to be told to refresh."""
        response = anonymous_client.get(CODE_VALUES)

        assert response.headers.get("www-authenticate") == 'Bearer realm="ada"'


# ------------------------------------------------------------- authorisation
class TestAuthorisation:
    def test_every_icms_role_may_read_the_vocabulary(self, icms_client, code_values):
        """A surveyor whose app cannot load its complaint types has no form."""
        for role in ROLES:
            response = icms_client.sign_in(role).get(CODE_VALUES)
            assert response.status_code == 200, role

    def test_a_token_with_no_icms_role_is_refused(self, icms_client, code_values):
        response = icms_client.sign_in().get(CODE_VALUES)

        assert response.status_code == 403
        error = error_of(response)
        assert error["code"] == "role_not_permitted"
        assert error["allowed"] == sorted(ROLES)

    def test_the_refusal_is_403_and_not_401(self, icms_client, code_values):
        """401 tells a client to refresh, and refreshing produces the same token.
        A client that retries on 401 would loop until it gave up."""
        assert icms_client.sign_in().get(CODE_VALUES).status_code != 401


# ---------------------------------------------------------------- pagination
class TestPagination:
    def test_a_page_reports_the_total_beyond_it(self, icms_client, code_values):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CODE_VALUES, params={"domain": "complaint_type", "size": 2}).json()

        assert len(body["items"]) == 2
        assert (body["total"], body["pages"], body["next_cursor"]) == (3, 2, "2")

    def test_the_last_page_offers_no_cursor(self, icms_client, code_values):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CODE_VALUES, params={"domain": "complaint_type", "size": 2, "page": 2}).json()

        assert len(body["items"]) == 1
        assert body["next_cursor"] is None

    def test_a_page_past_the_end_still_knows_the_total(self, icms_client, code_values):
        """The window count produces no row when the page is empty, so the total
        has to come from a second count over the same selectable. Getting this
        wrong reports `total: 0` and makes a client think the register emptied."""
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CODE_VALUES, params={"domain": "complaint_type", "size": 2, "page": 99}).json()

        assert body["items"] == []
        assert (body["total"], body["pages"], body["next_cursor"]) == (3, 2, None)

    def test_pages_do_not_overlap(self, icms_client, code_values):
        client = icms_client.sign_in(SUPER_ADMIN)
        seen = []
        for page in (1, 2, 3):
            body = client.get(CODE_VALUES, params={"size": 2, "page": page}).json()
            seen += [item["id"] for item in body["items"]]

        assert len(seen) == len(set(seen)) == 5

    def test_the_size_ceiling_is_enforced(self, icms_client, code_values):
        response = icms_client.sign_in(SUPER_ADMIN).get(CODE_VALUES, params={"size": 5000})

        assert response.status_code == 422
        assert error_of(response)["field"] == "size"

    def test_page_zero_is_refused(self, icms_client, code_values):
        assert icms_client.sign_in(SUPER_ADMIN).get(
            CODE_VALUES, params={"page": 0}).status_code == 422


# --------------------------------------------------------------- whitelists
class TestWhitelists:
    def test_an_unknown_sort_key_is_refused_with_the_legal_ones(
        self, icms_client, code_values
    ):
        response = icms_client.sign_in(SUPER_ADMIN).get(
            CODE_VALUES, params={"sort": INJECTION})

        assert response.status_code == 400
        error = error_of(response)
        assert error["code"] == "unknown_sort_field"
        assert error["field"] == "sort"
        assert error["allowed"] == ["code", "domain", "label", "sort_order"]

    def test_a_known_sort_key_reverses(self, icms_client, code_values):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CODE_VALUES, params={"domain": "complaint_type", "sort": "-code"}).json()

        assert [item["code"] for item in body["items"]] == [
            "unauthorised_construction", "encroachment", "deviation_from_plan",
        ]
        assert body["sort"] == "-code"

    def test_an_unknown_filter_is_refused_rather_than_ignored(
        self, icms_client, code_values
    ):
        """`extra="forbid"` makes the query model the whitelist. Ignoring
        `?domian=complaint_type` would answer with the unfiltered register and
        look like it worked."""
        response = icms_client.sign_in(SUPER_ADMIN).get(
            CODE_VALUES, params={"domian": "complaint_type"})

        assert response.status_code == 422
        error = error_of(response)
        assert error["code"] == "validation_failed"
        assert error["field"] == "domian"


# ------------------------------------------------------- envelope and tracing
class TestErrorEnvelopeAndTracing:
    def test_every_response_carries_a_request_id(self, icms_client, code_values):
        response = icms_client.sign_in(SUPER_ADMIN).get(CODE_VALUES)

        assert response.headers["x-request-id"]

    def test_a_supplied_request_id_is_kept(self, icms_client, code_values):
        response = icms_client.sign_in(SUPER_ADMIN).get(
            CODE_VALUES, headers={"X-Request-ID": "abc-123"})

        assert response.headers["x-request-id"] == "abc-123"

    def test_a_hostile_request_id_is_cleaned_rather_than_echoed(
        self, icms_client, code_values
    ):
        """A control character in a header value is a response split, and in a
        log line it is a forged entry. Neither is worth echoing."""
        response = icms_client.sign_in(SUPER_ADMIN).get(
            CODE_VALUES, headers={"X-Request-ID": "ok 1 <script>"})

        assert response.headers["x-request-id"] == "ok1script"

    def test_the_id_in_the_body_is_the_id_in_the_header(self, icms_client, code_values):
        response = icms_client.sign_in(SUPER_ADMIN).get(
            CODE_VALUES, params={"sort": "nope"}, headers={"X-Request-ID": "trace-9"})

        assert error_of(response)["request_id"] == "trace-9"
        assert response.headers["x-request-id"] == "trace-9"

    def test_an_unexpected_failure_is_logged_and_not_quoted_back(
        self, engine, db, monkeypatch
    ):
        """The legacy handler swallows the driver error and answers HTTP 200
        with `{error: true, data: "Some error occured at server side"}`. This
        answers 500, keeps the reason in the log, and tells the caller nothing
        about the database it could not reach."""
        from ada_core.database import get_db
        from fastapi.testclient import TestClient

        from app import deps
        from app.main import app
        from app.routers import icms as icms_router
        from tests.conftest import SUPER_ADMIN_ID, icms_principal

        secret = "password authentication failed for user 'ada' at 10.0.0.5"

        def boom(*args, **kwargs):
            raise RuntimeError(secret)

        monkeypatch.setattr(icms_router.repo, "list_code_values", boom)
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[deps.require_user] = lambda: icms_principal(
            SUPER_ADMIN_ID, SUPER_ADMIN)
        try:
            with TestClient(app, raise_server_exceptions=False) as failing:
                response = failing.get(CODE_VALUES, headers={"X-Request-ID": "boom-1"})
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 500
        assert error_of(response)["code"] == "internal_error"
        assert "password" not in response.text
        assert "10.0.0.5" not in response.text
        # The id is the thread back to the traceback in the log, and a 500 is
        # when somebody actually needs it.
        assert response.headers["x-request-id"] == "boom-1"
        assert error_of(response)["request_id"] == "boom-1"

    def test_the_older_routes_keep_the_body_the_console_reads(self, client):
        """The envelope is scoped to /api/icms on purpose. Changing the error
        shape underneath a running console to tidy it up is a regression."""
        response = client.get("/api/projects/999999")

        assert response.status_code == 404
        assert response.json() == {"detail": "Project not found"}
