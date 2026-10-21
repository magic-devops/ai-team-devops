"""Bounded local submission; durable Core launch tickets survive process loss."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Lock

from hermes_core.models import Principal

MAX_LOCAL_LAUNCHES = 4
_INIT_LOCK = Lock()


def _pool(app):
    with _INIT_LOCK:
        pool = getattr(app.state, "delivery_control_launch_pool", None)
        if pool is None:
            pool = {"executor": ThreadPoolExecutor(max_workers=MAX_LOCAL_LAUNCHES, thread_name_prefix="delivery-control"),
                    "active": {}, "lock": Lock(), "closed": False}
            app.state.delivery_control_launch_pool = pool
        return pool


def submit_control_launch(app, request, workspace_id, arguments):
    """No in-memory queue of originals: at most four live submissions, then defer."""
    execution = getattr(app.state, "hermes_execution", None)
    if execution is None:
        return False
    pool = _pool(app)
    with pool["lock"]:
        pool["active"] = {key: future for key, future in pool["active"].items() if not future.done()}
        launch_id = arguments["launch_id"]
        if pool["closed"] or launch_id in pool["active"] or len(pool["active"]) >= MAX_LOCAL_LAUNCHES:
            return False
        # execute obtains fresh SQL authority before its atomic ticket claim.
        # This read-only namespace never grants execution itself.
        principal = Principal(request["actor"], tenant=request["tenant"], business=request["business"],
                              permissions=frozenset({"read"}), workspace_ids=frozenset({workspace_id}))
        pool["active"][launch_id] = pool["executor"].submit(
            execution.execute, principal, workspace_id, arguments["run_id"],
            expected_attempt=arguments["expected_attempt"], resume=arguments.get("resume"), launch_id=launch_id)
    return True


@contextmanager
def control_launch_lifespan(app):
    try:
        yield
    finally:
        pool = getattr(app.state, "delivery_control_launch_pool", None)
        if pool:
            with pool["lock"]:
                pool["closed"] = True
            # Claimed work retains its real lease/stop path. Admission shutdown
            # does not assert a physical stop.
            pool["executor"].shutdown(wait=False, cancel_futures=True)
