#!/usr/bin/env python3
"""Upload listing screenshots to the Snap Store.

snapcraft's CLI covers summary/description/icon (`upload-metadata`) but NOT
screenshots — those only exist on the dashboard's `binary-metadata` endpoint.
This script drives that endpoint with the same `SNAPCRAFT_STORE_CREDENTIALS`
secret snapcraft itself consumes, via craft-store (snapcraft's own auth layer,
which handles the macaroon binding).

Usage:
    SNAPCRAFT_STORE_CREDENTIALS=... python3 scripts/snap-store-media.py \
        <snap-name> <screenshot.png> [more.png ...]

Existing non-screenshot media (the icon) is preserved; the screenshot set is
REPLACED wholesale by the files given, in order. The store caps screenshots at
five per listing.

Dependency: `pip install craft-store` (pulled on demand in CI).
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import sys
from pathlib import Path

from craft_store import UbuntuOneStoreClient, endpoints

DASHBOARD = "https://dashboard.snapcraft.io"
SERIES = "16"  # the store's fixed snap series identifier
MAX_SCREENSHOTS = 5


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    snap_name = sys.argv[1]
    shots = [Path(p) for p in sys.argv[2:]]
    for shot in shots:
        if not shot.is_file():
            print(f"not a file: {shot}", file=sys.stderr)
            return 2
    if len(shots) > MAX_SCREENSHOTS:
        print(f"the store caps screenshots at {MAX_SCREENSHOTS}; got {len(shots)}", file=sys.stderr)
        return 2
    if not os.environ.get("SNAPCRAFT_STORE_CREDENTIALS"):
        print("SNAPCRAFT_STORE_CREDENTIALS is not set", file=sys.stderr)
        return 2

    # UbuntuOneStoreClient, NOT StoreClient: `snapcraft export-login` emits
    # u1-macaroon credentials ({"t": "u1-macaroon", ...}), which the generic
    # client rejects as "not Candid".
    client = UbuntuOneStoreClient(
        base_url=DASHBOARD,
        storage_base_url="https://storage.snapcraftcontent.com",
        auth_url="https://login.ubuntu.com",
        endpoints=endpoints.U1_SNAP_STORE,
        application_name="snapcraft",
        user_agent="restorm-snap-store-media/1.0",
        environment_auth="SNAPCRAFT_STORE_CREDENTIALS",
    )

    account = client.request("GET", f"{DASHBOARD}/dev/api/account").json()
    snap_entry = (account.get("snaps", {}).get(SERIES, {})).get(snap_name)
    if not snap_entry:
        print(f"snap '{snap_name}' not found in this account", file=sys.stderr)
        return 1
    snap_id = snap_entry["snap-id"]

    media_url = f"{DASHBOARD}/dev/api/snaps/{snap_id}/binary-metadata"
    current = client.request("GET", media_url, params={"conflict-on-missing": "true"}).json()
    kept = [entry for entry in current if entry.get("type") != "screenshot"]

    # Store contract (mirrors snapcraft's own icon upload): every NEW media
    # entry carries a `key`, the matching file part is registered under that
    # key, and `info` travels as a regular form field when files are present.
    info = list(kept)
    uploads: dict[str, tuple[str, bytes, str]] = {}
    for index, shot in enumerate(shots):
        key = f"screenshot-{index}"
        info.append({"type": "screenshot", "hash": sha256_of(shot), "key": key, "filename": shot.name})
        mime = mimetypes.guess_type(shot.name)[0] or "application/octet-stream"
        uploads[key] = (shot.name, shot.read_bytes(), mime)

    response = client.request(
        "PUT", media_url, data={"info": json.dumps(info)}, files=uploads, headers={"Accept": "application/json"}
    )
    print(f"updated media for '{snap_name}': {len(kept)} kept, {len(shots)} screenshots")
    for entry in response.json():
        print(f"  - {entry.get('type')}: {entry.get('filename')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
