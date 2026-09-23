"""Full end-to-end API test: auth -> project -> uploads -> red zone ->
analysis -> polygons -> tiles.

Run with the stack up (`docker compose up -d`). It signs in through ada-auth,
then drives ada-api; ada-ml does the ingest and the analysis, so a slow first
run is the model service fetching weights rather than this script hanging.
"""

import os
import sys
import time
from pathlib import Path

import httpx

# Native runs hit ada-api directly; the Docker POC exposes it behind the
# frontend's nginx, so point this at the app origin instead:
#   ADA_BASE_URL=http://localhost:5173 python scripts/e2e_test.py
BASE = os.environ.get("ADA_BASE_URL", "http://localhost:8000")
# ada-auth, for the phone + one-time-code sign-in below.
AUTH_BASE = os.environ.get("ADA_AUTH_URL", "http://localhost:8002")
# scripts/ is one level below the repository root.
SAMPLES = Path(__file__).resolve().parents[1] / "data" / "samples"

# The account this test signs in as. It must exist in the realm with this
# number on its phoneNumber attribute — digits only, no '+' and no spaces, or
# ada-auth will not find it and answers as though it were unregistered.
PHONE = os.environ.get("ADA_E2E_PHONE", "919990001234")
# In ADA_ENV=local every issued code is ADA_DEV_OTP, so this needs no SMS
# provider and no inbox. Production cannot enable that bypass.
DEV_OTP = os.environ.get("ADA_DEV_OTP", "000000")


def step(msg: str) -> None:
    print(f"\n=== {msg} ===")


def sign_in() -> str:
    """An access token for the test officer.

    Authentication is Keycloak now, not SuperTokens, so there is no signup
    endpoint on this API to call and no session cookie to collect. Two ways in:

      * ADA_ACCESS_TOKEN, for a CI job that already minted one;
      * otherwise ada-auth's OTP pair, which is ADA's own sign-in path and
        needs nothing but the local dev bypass.
    """
    existing = os.environ.get("ADA_ACCESS_TOKEN")
    if existing:
        print("using ADA_ACCESS_TOKEN from the environment")
        return existing

    with httpx.Client(base_url=AUTH_BASE, timeout=30) as auth:
        r = auth.post("/v1/auth/request-otp", json={"phone": PHONE})
        assert r.status_code == 202, f"request-otp: {r.status_code} {r.text}"
        r = auth.post("/v1/auth/verify-otp", json={"phone": PHONE, "code": DEV_OTP})
        assert r.status_code == 200, (
            f"verify-otp: {r.status_code} {r.text}\n"
            "A 401 here with ADA_ENV=local usually means the account does not "
            "carry this phone number; a 503 means Keycloak refused the token "
            "exchange (check --features=token-exchange:v1)."
        )
        return r.json()["access_token"]


step("Sign in (ada-auth, phone + one-time code)")
token = sign_in()
# Bearer, not a cookie. Every request below carries it, including the tile and
# report calls the browser used to make on its own.
client = httpx.Client(base_url=BASE, timeout=120,
                      headers={"Authorization": f"Bearer {token}"})
print("signed in, token length:", len(token))

step("Create project")
r = client.post("/api/projects", json={"name": "Agra POC",
                                       "description": "synthetic e2e test"})
r.raise_for_status()
pid = r.json()["id"]
print("project", pid)

step("Upload T1 + T2 rasters")
raster_ids = []
for name, fname in [("T1 2024 (drone)", "agra_t1_2024.tif"),
                    ("T2 2026 (satellite)", "agra_t2_2026.tif")]:
    with open(SAMPLES / fname, "rb") as f:
        r = client.post(f"/api/projects/{pid}/rasters",
                        data={"name": name},
                        files={"file": (fname, f, "image/tiff")})
    r.raise_for_status()
    raster_ids.append(r.json()["id"])
print("rasters", raster_ids)

step("Wait for ingestion (COG)")
for _ in range(60):
    r = client.get(f"/api/projects/{pid}/rasters")
    statuses = {x["id"]: x["status"] for x in r.json()}
    if all(s == "ready" for s in statuses.values()):
        print("all ready:", statuses)
        break
    if any(s == "failed" for s in statuses.values()):
        print("FAILED:", r.json())
        sys.exit(1)
    time.sleep(2)
else:
    sys.exit("ingest timeout")

step("Raster tile + info")
r = client.get(f"/api/tiles/raster/{raster_ids[0]}/info")
r.raise_for_status()
info = r.json()
print("info:", info)
w, s, e, n = info["bounds"]
import math
z = 16
cx, cy = (w + e) / 2, (s + n) / 2
xt = int((cx + 180) / 360 * 2 ** z)
yt = int((1 - math.log(math.tan(math.radians(cy)) + 1 / math.cos(math.radians(cy))) / math.pi) / 2 * 2 ** z)
r = client.get(f"/api/tiles/raster/{raster_ids[0]}/{z}/{xt}/{yt}.png")
print("tile status:", r.status_code, "bytes:", len(r.content))
assert r.status_code == 200 and r.content[:4] == b"\x89PNG"

step("Create red zone (covers one new building)")
# new building at T1 px (400,500) size 80x100, res 0.5m -> offset in degrees
zw = w + (500 * 0.5) / 111320 / math.cos(math.radians(cy)) * 0.98
zn = n - (400 * 0.5) / 111320 * 0.98
ze = zw + (250 * 0.5) / 111320 / math.cos(math.radians(cy))
zs = zn - (250 * 0.5) / 111320
zone_geom = {"type": "Polygon", "coordinates": [[
    [zw, zs], [ze, zs], [ze, zn], [zw, zn], [zw, zs]]]}
r = client.post(f"/api/projects/{pid}/red-zones",
                json={"name": "Protected monument buffer", "geometry": zone_geom})
r.raise_for_status()
print("red zone", r.json()["id"])

step("Run change detection")
r = client.post(f"/api/projects/{pid}/analyses",
                json={"raster_t1_id": raster_ids[0], "raster_t2_id": raster_ids[1]})
r.raise_for_status()
job = r.json()["id"]
for _ in range(300):
    r = client.get(f"/api/analyses/{job}").json()
    print(f"  {r['status']:8s} {r['progress']*100:5.1f}%  {r.get('stage') or ''}")
    if r["status"] in ("done", "failed"):
        break
    time.sleep(3)
if r["status"] != "done":
    sys.exit(f"analysis failed: {r.get('error')}")
print("stats:", r["stats"])

step("Fetch change polygons")
fc = client.get(f"/api/analyses/{job}/features").json()
print("features:", len(fc["features"]))
for f in fc["features"][:6]:
    p = f["properties"]
    print(f"  [{p['status']:7s}] {p['label'][:60]:60s} {p['area_m2']:9.1f} m2 "
          f"conf={p['confidence']:.2f}")
illegal = [f for f in fc["features"] if f["properties"]["status"] == "illegal"]
print("illegal count:", len(illegal))

step("Mask tile")
r = client.get(f"/api/tiles/mask/{job}/{z}/{xt}/{yt}.png")
print("mask tile:", r.status_code, "bytes:", len(r.content))
assert r.status_code == 200

step("E2E OK")
