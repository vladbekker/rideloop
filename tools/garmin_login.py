from __future__ import annotations

import os
from getpass import getpass
from pathlib import Path

from garminconnect import Garmin


def main() -> None:
    email = os.getenv("GARMIN_EMAIL") or input("Garmin email: ").strip()
    password = os.getenv("GARMIN_PASSWORD") or getpass("Garmin password: ")
    tokenstore = (
        os.getenv("GARMIN_TOKENSTORE")
        or os.getenv("GARMINTOKENS")
        or ".private/garmin_tokens"
    )
    tokenstore_path = Path(tokenstore).expanduser()
    tokenstore_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)

    try:
        api = Garmin(
            email,
            password,
            prompt_mfa=lambda: input("Garmin MFA code: ").strip(),
        )
    except TypeError:
        api = Garmin(email, password)

    api.login()

    if hasattr(api, "client") and hasattr(api.client, "dump"):
        api.client.dump(str(tokenstore_path))
    elif hasattr(api, "garth") and hasattr(api.garth, "dump"):
        tokenstore_path.mkdir(mode=0o700, parents=True, exist_ok=True)
        api.garth.dump(str(tokenstore_path))

    print(f"Garmin login cached at {tokenstore_path}")


if __name__ == "__main__":
    main()
