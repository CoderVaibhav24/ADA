"""require_file: rows outlive the files they name, and that must read clearly."""

from __future__ import annotations

import pytest

from ada_core.storage import HINT, MissingImageryError, require_file


def test_returns_a_path_for_a_real_file(tmp_path):
    target = tmp_path / "raster_42.tif"
    target.write_bytes(b"II*\x00")
    assert require_file(str(target), "Source imagery") == target


def test_none_is_not_yet_written_rather_than_missing():
    """cog_path is NULL until ingest finishes. Saying 'missing on disk' about a
    file nothing has written yet sends the reader looking for a deleted file."""
    with pytest.raises(MissingImageryError) as exc:
        require_file(None, "The change mask")
    assert "has not been written yet" in str(exc.value)


def test_empty_string_is_treated_as_unwritten():
    with pytest.raises(MissingImageryError):
        require_file("", "The change mask")


def test_a_path_that_does_not_resolve_names_the_path_and_the_fix(tmp_path):
    """The case this exists for: a raster ingested in the container recorded
    /app/data/... and a local run reads ./data. Both the path and what to do
    about it belong in the message — it reaches the API response and the job's
    error column."""
    missing = tmp_path / "gone.tif"
    with pytest.raises(MissingImageryError) as exc:
        require_file(missing, "Source imagery for raster 7")
    message = str(exc.value)
    assert "Source imagery for raster 7" in message
    assert str(missing) in message
    assert HINT in message


def test_a_directory_is_not_a_file(tmp_path):
    with pytest.raises(MissingImageryError):
        require_file(tmp_path, "Source imagery")


def test_it_is_a_filenotfounderror(tmp_path):
    """Subclassing FileNotFoundError means an `except OSError` around a read
    path still catches it, rather than letting it escape as a 500."""
    assert issubclass(MissingImageryError, FileNotFoundError)
