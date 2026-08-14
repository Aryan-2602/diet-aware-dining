"""Vercel entrypoint for /api/recommend.

The file path is the URL path, so the request FastAPI receives is the one it
declares a route for. A previous `rewrites` block sent everything to
/api/index, which the app had no route for — every request would have 404'd
inside the function.
"""

import os
import sys

# Vercel imports this file directly rather than as a package member, so the
# package directory must be on the path for `_lib` to resolve.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _lib.http import app  # noqa: E402,F401
