"""Full end-to-end API test: auth -> project -> uploads -> red zone ->
analysis -> polygons -> tiles. Run with the backend + docker services up."""

import os
import sys
import time
from pathlib import Path

import httpx

# Native runs hit the backend directly; the Docker POC exposes it behind the
# frontend's nginx, so point this at the app origin instead:
#   ADA_BASE_URL=http://localhost:5173 python scripts/e2e_test.py
BASE = os.environ.get("ADA_BASE_URL", "http://localhost:8000")
SAMPLES = Path(__file__).resolve().parents[2] / "data" / "samples"
EMAIL, PASSWORD = "test@ada.gov.in", "TestPass123!"

client = httpx.Client(base_url=BASE, timeout=120,
                      headers={"st-auth-mode": "cookie"})


def step(msg: str) -> None:
    print(f"\n=== {msg} ===")


step("Sign in (SuperTokens)")
r = client.post("/api/auth/signin", json={"formFields": [
    {"id": "email", "value": EMAIL}, {"id": "password", "value": PASSWORD}]})
if r.json().get("status") != "OK":
    r = client.post("/api/auth/signup", json={"formFields": [
        {"id": "email", "value": EMAIL}, {"id": "password", "value": PASSWORD}]})
assert r.json()["status"] == "OK", r.text
print("signed in, cookies:", list(client.cookies.keys()))

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
