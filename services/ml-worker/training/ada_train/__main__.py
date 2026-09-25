"""Entry point so `python -m ada_train` works.

The __main__ guard matters more than usual here: on Windows the dataloader
spawns worker processes that re-import this module, and without the guard each
worker would re-enter main() and fork-bomb the machine.
"""

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
