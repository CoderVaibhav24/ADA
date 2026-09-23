"""CoreSettings: the values both services read, and the ones they share."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from ada_core.config import CoreSettings, repo_root


def make(**overrides) -> CoreSettings:
    return CoreSettings(database_url="postgresql+psycopg2://u:p@h/db", **overrides)


def test_repo_root_is_found_by_marker_not_by_counting_parents():
    """The old config counted `parents[2]` from backend/app/config.py. With the
    code split across three directories at different depths, a count is wrong
    for at least two of them, so the root is located by its compose file."""
    root = repo_root()
    assert (root / "infra" / "compose" / "docker-compose.yml").is_file()
    assert (root / "services").is_dir()


def test_data_directories_all_hang_off_data_dir(tmp_path):
    settings = make(data_dir=tmp_path)
    assert settings.uploads_dir == tmp_path / "uploads"
    assert settings.cogs_dir == tmp_path / "cogs"
    assert settings.masks_dir == tmp_path / "masks"
    assert settings.weights_dir == tmp_path / "weights"


def test_gdal_cache_is_a_share_of_the_host_budget():
    assert make(host_memory_limit_gb=18.0, gdal_cache_fraction=0.15).gdal_cache_mb == 2764


def test_gdal_cache_never_drops_below_a_usable_floor():
    """A tiny host budget would otherwise compute a cache of a few MB, which
    makes GDAL re-read the same blocks continuously during a warp."""
    assert make(host_memory_limit_gb=0.001).gdal_cache_mb == 64


def test_host_memory_limit_in_bytes():
    assert make(host_memory_limit_gb=2.0).host_memory_limit_bytes == 2 * (1 << 30)


def test_change_threshold_is_shared_because_both_services_use_it():
    """ada-ml writes the probability raster against this cut and ada-api renders
    everything below it transparent. Two copies could disagree, and the map is
    what an officer acts on — so it lives here, not in either service."""
    assert make().change_threshold == 0.5
    assert make(change_threshold=0.62).change_threshold == 0.62


class TestLocalModel:
    def test_returns_none_when_absent(self, tmp_path):
        assert make(data_dir=tmp_path).local_model("nope/model.onnx") is None

    def test_returns_the_path_for_a_vendored_file(self, tmp_path):
        settings = make(data_dir=tmp_path)
        target = settings.weights_dir / "seg" / "model.onnx"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"onnx")
        assert settings.local_model("seg/model.onnx") == target

    def test_returns_a_populated_directory(self, tmp_path):
        settings = make(data_dir=tmp_path)
        target = settings.weights_dir / "sam2.1-hiera-large"
        target.mkdir(parents=True)
        (target / "config.json").write_text("{}")
        assert settings.local_model("sam2.1-hiera-large") == target

    def test_refuses_an_empty_directory(self, tmp_path):
        """An interrupted download leaves the directory behind. Treating it as
        present sends the backend to a model that is not there, and the error
        surfaces deep inside inference instead of at load."""
        settings = make(data_dir=tmp_path)
        (settings.weights_dir / "half-fetched").mkdir(parents=True)
        assert settings.local_model("half-fetched") is None


class TestPrepareRuntime:
    def test_creates_the_data_directories(self, tmp_path):
        settings = make(data_dir=tmp_path / "fresh")
        settings.prepare_runtime()
        for directory in (settings.uploads_dir, settings.cogs_dir, settings.masks_dir):
            assert directory.is_dir()

    def test_is_idempotent(self, tmp_path):
        settings = make(data_dir=tmp_path)
        settings.prepare_runtime()
        settings.prepare_runtime()  # must not raise on existing directories

    def test_sets_the_gdal_environment(self, tmp_path, monkeypatch):
        monkeypatch.delenv("GDAL_CACHEMAX", raising=False)
        monkeypatch.delenv("GDAL_NUM_THREADS", raising=False)
        settings = make(data_dir=tmp_path, host_memory_limit_gb=10.0)
        settings.prepare_runtime()
        assert os.environ["GDAL_CACHEMAX"] == str(settings.gdal_cache_mb)
        assert os.environ["GDAL_NUM_THREADS"] == "ALL_CPUS"

    def test_does_not_override_an_operator_set_cache(self, tmp_path, monkeypatch):
        """setdefault, not assignment: someone who exported GDAL_CACHEMAX for a
        one-off large ingest means it."""
        monkeypatch.setenv("GDAL_CACHEMAX", "9999")
        make(data_dir=tmp_path).prepare_runtime()
        assert os.environ["GDAL_CACHEMAX"] == "9999"


def test_database_url_has_no_default(monkeypatch):
    """A service that silently connects to localhost is worse than one that
    refuses to start."""
    from pydantic import ValidationError

    # _env_file=None silences the dotenv files but not the process environment,
    # and ada-api's conftest exports DATABASE_URL before this suite is collected.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(ValidationError):
        CoreSettings(_env_file=None)  # type: ignore[call-arg]


def test_unknown_environment_variables_are_ignored(tmp_path):
    """extra='ignore'. One .env feeds every service, so ada-api necessarily
    sees ada-ml's fifty model tunables and must not choke on them."""
    settings = CoreSettings(
        database_url="postgresql+psycopg2://u:p@h/db",
        data_dir=tmp_path,
        sam_backend="sam2",  # type: ignore[call-arg]
    )
    assert not hasattr(settings, "sam_backend")


def test_paths_are_paths_not_strings(tmp_path):
    assert isinstance(make(data_dir=str(tmp_path)).data_dir, Path)
