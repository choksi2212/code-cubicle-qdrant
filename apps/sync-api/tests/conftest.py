"""Pytest config for the sync-api test suite."""

import pytest


def pytest_collection_modifyitems(config, items):
    """Auto-mark async test functions so pytest-asyncio picks them up."""
    for item in items:
        if item.get_closest_marker("asyncio") is not None:
            continue
        import inspect
        if inspect.iscoroutinefunction(getattr(item, "function", None)):
            item.add_marker(pytest.mark.asyncio)
