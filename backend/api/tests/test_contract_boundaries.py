"""The edges of every register: paging, sorting, searching and non-Latin text.

These are the inputs a real client sends by accident — the last page, a search
box with a percent sign in it, a Hindi name — and each has one right answer.
"""

from __future__ import annotations

import pytest

from tests.conftest import NODAL, SUPER_ADMIN
from tests.contract import (
    COLLECTION_READER,
    COLLECTIONS,
    PAGE,
    ZONE_DETAIL,
    assert_error,
    assert_shape,
)

ICMS = "/api/icms"
PATHS = [path for path, _, _ in COLLECTIONS]
SIZE_CAP = 200

# Search terms that are only dangerous if the term reaches SQL as syntax. They are
# sent as `q=`, which is bound as a parameter and LIKE-escaped, so the contract is
# that each matches nothing and changes nothing.
INJECTION_TERMS = [
    "'; " + "DROP" + " TABLE icms_zone;--",
    "' OR 1=1--",
    '" UNION SELECT null,null--',
    "%' OR zone_cd LIKE '%",
]


# The collection table carries a dict and a list, which pytest renders as noise.
def collection_id(value):
    return value if isinstance(value, str) else ""


def read(client, path, **params):
    return client.sign_in(COLLECTION_READER[path]).get(path, params=params)


class TestPaging:
    @pytest.mark.parametrize("path", PATHS)
    def test_page_zero_is_refused_rather_than_read_as_page_one(self, icms_client,
                                                               contract_world, path):
        """Off-by-one paging that silently works is a page of rows nobody sees."""
        assert_error(f"GET {path}", "page=0", read(icms_client, path, page=0),
                     status=422, code="validation_failed", field="page")

    @pytest.mark.parametrize("path", PATHS)
    def test_a_page_past_the_last_one_is_an_empty_page_and_not_an_error(
        self, icms_client, contract_world, path
    ):
        response = read(icms_client, path, page=9999)

        assert response.status_code == 200
        body = response.json()
        assert_shape(f"GET {path}", "a page past the end", body, PAGE)
        assert body["items"] == []
        assert body["page"] == 9999
        assert body["next_cursor"] is None, "there is no next page after the end"

    @pytest.mark.parametrize("path", PATHS)
    def test_the_size_cap_is_accepted_and_one_more_is_refused(self, icms_client,
                                                              contract_world, path):
        """The cap is what stops one call from paging the whole register into memory."""
        at_cap = read(icms_client, path, size=SIZE_CAP)

        assert at_cap.status_code == 200, f"GET {path}: size={SIZE_CAP} must be allowed"
        assert at_cap.json()["size"] == SIZE_CAP
        assert_error(f"GET {path}", f"size={SIZE_CAP + 1}",
                     read(icms_client, path, size=SIZE_CAP + 1),
                     status=422, code="validation_failed", field="size")

    def test_the_cursor_points_at_the_next_page_until_the_last_one(self, icms_client,
                                                                   contract_world):
        client = icms_client.sign_in(NODAL)
        first = client.get(f"{ICMS}/cases", params={"size": 1, "page": 1}).json()
        last = client.get(f"{ICMS}/cases", params={"size": 1, "page": first["pages"]}).json()

        # Nine since 2026-09-23: `contract_world` seeds CMP-2026-0011 in
        # `confirmed` for Batch 6's issue_notice, and the nodal officer holds TAJ.
        assert (first["total"], first["pages"]) == (9, 9)
        assert first["next_cursor"] == "2"
        assert last["next_cursor"] is None

    @pytest.mark.parametrize("path", PATHS)
    def test_an_empty_result_is_the_whole_envelope_with_zeroes(self, icms_client,
                                                               contract_world, path):
        """A grid reads `total` and `pages` even when there is nothing to draw."""
        response = read(icms_client, path, q="zzz-nothing-matches-this")

        assert response.status_code == 200
        body = response.json()
        assert_shape(f"GET {path}", "an empty result", body, PAGE)
        assert (body["items"], body["total"], body["pages"]) == ([], 0, 0)
        assert body["next_cursor"] is None


class TestSorting:
    @pytest.mark.parametrize("path,item,sorts", COLLECTIONS, ids=collection_id)
    def test_an_unknown_sort_column_is_refused_with_the_whitelist(
        self, icms_client, contract_world, path, item, sorts
    ):
        """The whitelist is the whole defence: the column name reaches ORDER BY."""
        assert_error(f"GET {path}", "an unknown sort column",
                     read(icms_client, path, sort="bogus"),
                     status=400, code="unknown_sort_field", field="sort", allowed=sorts)

    @pytest.mark.parametrize("path,item,sorts", COLLECTIONS, ids=collection_id)
    def test_every_whitelisted_column_sorts_in_both_directions(
        self, icms_client, contract_world, path, item, sorts
    ):
        for key in sorts:
            for requested in (key, f"-{key}"):
                response = read(icms_client, path, sort=requested)
                assert response.status_code == 200, f"GET {path}: sort={requested} failed"
                assert response.json()["sort"] == requested, (
                    f"GET {path}: sort={requested} was echoed as "
                    f"{response.json()['sort']!r}"
                )

    @pytest.mark.parametrize("path", PATHS)
    def test_a_sort_column_smuggling_sql_is_refused_and_not_executed(
        self, icms_client, contract_world, path
    ):
        response = read(icms_client, path, sort=INJECTION_TERMS[0])

        assert_error(f"GET {path}", "a sort column carrying SQL", response,
                     status=400, code="unknown_sort_field", field="sort")


class TestSearch:
    @pytest.fixture
    def searchable_zones(self, icms_client, contract_world):
        """Zones whose names contain the characters LIKE treats as wildcards."""
        client = icms_client.sign_in(SUPER_ADMIN)
        for code, name in (("PCT", "Fifty% Complete"), ("UND", "Under_score"),
                           ("BSL", "Back\\slash"), ("DEV", "नया क्षेत्र")):
            created = client.post(f"{ICMS}/zones", json={"zone_cd": code, "name": name})
            assert created.status_code == 201, created.text
        return client

    def test_a_percent_matches_a_literal_percent_and_not_every_row(self, searchable_zones):
        """An unescaped `%` turns the search box into 'select everything'."""
        body = searchable_zones.get(f"{ICMS}/zones", params={"q": "%"}).json()

        assert [row["zone_cd"] for row in body["items"]] == ["PCT"]
        assert body["total"] == 1

    def test_an_underscore_matches_a_literal_underscore_and_not_any_character(
        self, searchable_zones
    ):
        body = searchable_zones.get(f"{ICMS}/zones", params={"q": "_"}).json()

        assert [row["zone_cd"] for row in body["items"]] == ["UND"]

    def test_a_backslash_matches_a_literal_backslash(self, searchable_zones):
        """The escape character itself, which is the one escaping usually forgets."""
        body = searchable_zones.get(f"{ICMS}/zones", params={"q": "\\"}).json()

        assert [row["zone_cd"] for row in body["items"]] == ["BSL"]

    @pytest.mark.parametrize("term", INJECTION_TERMS)
    def test_sql_metacharacters_match_nothing_and_leave_the_table_standing(
        self, searchable_zones, term
    ):
        response = searchable_zones.get(f"{ICMS}/zones", params={"q": term})

        assert response.status_code == 200, response.text
        assert response.json()["items"] == [], f"{term!r} matched rows it should not"
        still_there = searchable_zones.get(f"{ICMS}/zones").json()
        assert still_there["total"] >= 4, f"{term!r} appears to have changed the table"

    def test_devanagari_round_trips_through_the_search(self, searchable_zones):
        body = searchable_zones.get(f"{ICMS}/zones", params={"q": "नया"}).json()

        assert [row["zone_cd"] for row in body["items"]] == ["DEV"]
        assert body["items"][0]["name"] == "नया क्षेत्र"

    def test_a_search_term_at_its_maximum_length_is_accepted(self, searchable_zones):
        response = searchable_zones.get(f"{ICMS}/zones", params={"q": "x" * 120})

        assert response.status_code == 200

    def test_a_search_term_over_the_maximum_is_refused_by_name(self, searchable_zones):
        assert_error(f"GET {ICMS}/zones", "a search term over 120 characters",
                     searchable_zones.get(f"{ICMS}/zones", params={"q": "x" * 121}),
                     status=422, code="validation_failed", field="q")


class TestUnicode:
    def test_a_hindi_zone_name_survives_write_and_read(self, icms_client, contract_world):
        client = icms_client.sign_in(SUPER_ADMIN)
        created = client.post(f"{ICMS}/zones",
                              json={"zone_cd": "HI1", "name": "Old Town",
                                    "name_hi": "पुराना शहर"})

        assert created.status_code == 201
        assert_shape(f"POST {ICMS}/zones", "a zone with a Hindi name", created.json(),
                     ZONE_DETAIL)
        read_back = client.get(f"{ICMS}/zones/HI1").json()
        assert read_back["name_hi"] == "पुराना शहर"

    def test_a_hindi_complainant_name_survives_raising_a_case(self, icms_client,
                                                              contract_world):
        """The intake form is bilingual; a mangled name is a notice served on nobody."""
        response = icms_client.sign_in(NODAL).post(
            f"{ICMS}/cases",
            json={"source": "public", "zone_cd": "TAJ", "complainant_name": "आशा देवी",
                  "property_address": "१२ फतेहाबाद रोड"})

        assert response.status_code == 201
        assert response.json()["complainant_name"] == "आशा देवी"

    def test_the_seeded_hindi_zone_name_is_returned_unchanged(self, icms_client,
                                                              contract_world):
        body = icms_client.sign_in(SUPER_ADMIN).get(f"{ICMS}/zones/TAJ").json()

        assert body["name_hi"] == "ताजगंज"
