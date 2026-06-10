from __future__ import annotations

import base64
import os
from pathlib import Path


def encode_file(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def main() -> None:
    tokenstore = (
        os.getenv("GARMIN_TOKENSTORE")
        or os.getenv("GARMINTOKENS")
        or ".private/garmin_tokens"
    )
    tokenstore_path = Path(tokenstore).expanduser()
    oauth1_path = tokenstore_path / "oauth1_token.json"
    oauth2_path = tokenstore_path / "oauth2_token.json"

    if not oauth1_path.exists() or not oauth2_path.exists():
        raise SystemExit(
            f"No Garmin token files found in {tokenstore_path}. "
            "Run tools/garmin_login.py first."
        )

    print("GARMIN_TOKENSTORE=/tmp/rideloop-garmin-tokens")
    print(f"GARMIN_OAUTH1_JSON_B64={encode_file(oauth1_path)}")
    print(f"GARMIN_OAUTH2_JSON_B64={encode_file(oauth2_path)}")


if __name__ == "__main__":
    main()

