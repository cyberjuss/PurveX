"""Compute runner staleness at read time.

``EnvironmentRunnerConfig.status`` is only updated by explicit transitions
(heartbeat sets "online", pause/stop commands set "paused"/"stopped") — it
never reflects a runner that simply stopped sending heartbeats. Comparing
``last_check_in`` against ``alert_offline_minutes`` on every read avoids
needing a background poller for this MVP: staleness is a property we derive,
not a state we track.
"""
from datetime import datetime, timedelta, timezone

from .. import models

DEFAULT_ALERT_OFFLINE_MINUTES = 5


def is_runner_stale(runner: "models.EnvironmentRunnerConfig", now: datetime | None = None) -> bool:
    if not runner.last_check_in:
        # Never checked in yet is a distinct state ("never connected"), not staleness.
        return False
    now = now or datetime.now(timezone.utc)
    threshold = timedelta(minutes=runner.alert_offline_minutes or DEFAULT_ALERT_OFFLINE_MINUTES)
    last_check_in = runner.last_check_in
    if last_check_in.tzinfo is None:
        last_check_in = last_check_in.replace(tzinfo=timezone.utc)
    return (now - last_check_in) > threshold
