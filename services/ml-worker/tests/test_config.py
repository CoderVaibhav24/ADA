"""ada-ml's settings: the pipeline knobs, and what it inherits from ada-core."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings


def make(**overrides) -> Settings:
    return Settings(database_url="postgresql+psycopg2://u:p@h/db", **overrides)


def test_it_inherits_the_shared_settings():
    """DATABASE_URL, DATA_DIR and the GDAL cache are defined once, in
    CoreSettings, so the two services cannot disagree about where the data is."""
    settings = make()
    assert settings.weights_dir.name == "weights"
    assert settings.gdal_cache_mb > 0
    assert settings.change_threshold == 0.5


def test_change_threshold_is_not_redeclared_here():
    """It lives in CoreSettings because ada-api renders the mask against the
    same cut. A second declaration would let the two drift silently."""
    assert "change_threshold" not in Settings.__annotations__


@pytest.mark.parametrize(
    "field,expected",
    [
        ("model_mode", "segdiff"),
        ("building_backend", "changestar"),
        ("vegetation_mode", "learned"),
        ("sam_backend", "sam2"),
        ("instance_decider", "shadow"),
        ("seed_mode", "encroachment"),
        ("ml_device", "auto"),
    ],
)
def test_the_defaults_are_the_evidence_grade_pipeline(field, expected):
    """These are the settings the accuracy numbers were measured against.
    Changing one silently changes what the officer is shown.

    Read off the field rather than off an instance: this suite sets some of
    these in the environment, and an instance would report what the test rig
    chose rather than what ships.
    """
    assert Settings.model_fields[field].default == expected


def test_the_instance_decider_starts_in_shadow():
    """The learned accept/reject net scores every instance and its agreement
    with the rules is logged, but the rules still decide. Promoting it to
    `active` before reading those numbers is how a regression ships."""
    assert make().instance_decider == "shadow"
    assert make().min_training_samples == 150


def test_gpu_is_not_required_by_default():
    """REQUIRE_GPU=true is right once a box is known to work, and wrong as a
    default: it would stop the service starting on any machine without a card."""
    assert Settings.model_fields["require_gpu"].default is False


def test_notifications_are_off_by_default():
    """A deployment without ada-notify must not trail every finished analysis
    with a warning nobody can act on."""
    assert Settings.model_fields["notify_enabled"].default is False


def test_the_service_token_is_empty_by_default():
    """Empty is a default only a local run may keep; see the tests below."""
    assert Settings.model_fields["ml_service_token"].default == ""


def test_the_environment_defaults_to_production():
    assert Settings.model_fields["ada_env"].default == "production"


@pytest.mark.parametrize("env", ["production", "staging"])
def test_an_empty_service_token_outside_local_refuses_to_load(env):
    with pytest.raises(ValidationError, match="ML_SERVICE_TOKEN"):
        make(ml_service_token="", ada_env=env)


def test_an_empty_service_token_with_no_env_refuses_to_load(monkeypatch):
    monkeypatch.delenv("ADA_ENV", raising=False)
    monkeypatch.setenv("ML_SERVICE_TOKEN", "")
    with pytest.raises(ValidationError, match="ADA_ENV='production'"):
        make(_env_file=None)


def test_an_empty_service_token_is_allowed_locally():
    assert make(ml_service_token="", ada_env="local").ml_service_token == ""


def test_a_set_service_token_loads_in_production():
    assert make(ml_service_token="s3cret", ada_env="production").ada_env == "production"


def test_the_ports_do_not_collide_with_the_other_services():
    """8000 ada-api, 8001 ada-notify, 8002 ada-auth, 8100 ada-ml."""
    assert make().ml_port == 8100


def test_environment_variables_keep_their_pre_split_names(monkeypatch):
    """An existing .env has to keep working: these names appear in the README,
    the run guide and every deployment that predates the split."""
    monkeypatch.setenv("MODEL_MODE", "cd")
    monkeypatch.setenv("SAM_REFINE", "false")
    monkeypatch.setenv("CHIP_SIZE", "512")
    settings = make()
    assert settings.model_mode == "cd"
    assert settings.sam_refine is False
    assert settings.chip_size == 512


def test_unknown_variables_are_ignored(monkeypatch):
    """One .env feeds every service, so ada-ml necessarily sees ada-api's
    OIDC_ISSUER and ada-notify's ADA_* names."""
    monkeypatch.setenv("OIDC_ISSUER", "https://keycloak.test/realms/pcsmcpl")
    monkeypatch.setenv("ADA_OTP_HMAC_KEY", "irrelevant")
    make()  # must not raise


def test_a_blank_ada_env_means_production():
    assert make(ada_env="", ml_service_token="s3cret").ada_env == "production"
