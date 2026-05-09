from types import SimpleNamespace

import pytest
from paramiko import SSHException

from app.services.atomic_runner import (
    PinnedHostKeyPolicy,
    _normalize_ssh_host_key_sha256,
    _runner_snapshot,
    _ssh_host_key_sha256,
    run_atomic_test,
)


class FakeKey:
    def __init__(self, payload: bytes = b"runner-host-key"):
        self.payload = payload

    def asbytes(self) -> bytes:
        return self.payload

    def get_name(self) -> str:
        return "ssh-ed25519"


class FakeHostKeys:
    def __init__(self):
        self.added = []

    def add(self, hostname: str, key_type: str, key: FakeKey) -> None:
        self.added.append((hostname, key_type, key))


class FakeClient:
    def __init__(self):
        self.host_keys = FakeHostKeys()

    def get_host_keys(self) -> FakeHostKeys:
        return self.host_keys


def test_normalize_ssh_host_key_fingerprint_accepts_openssh_output():
    raw = "256 SHA256:9mYpK4pQd6VG8t7jPjvaERh6XiW6m87iJi3G5EPI3Hk runner.example (ED25519)"

    assert _normalize_ssh_host_key_sha256(raw) == "SHA256:9mYpK4pQd6VG8t7jPjvaERh6XiW6m87iJi3G5EPI3Hk"
    assert _normalize_ssh_host_key_sha256("9mYpK4pQd6VG8t7jPjvaERh6XiW6m87iJi3G5EPI3Hk=") == (
        "SHA256:9mYpK4pQd6VG8t7jPjvaERh6XiW6m87iJi3G5EPI3Hk"
    )
    assert _normalize_ssh_host_key_sha256("not-a-fingerprint") is None


def test_pinned_host_key_policy_accepts_only_matching_fingerprint():
    key = FakeKey()
    expected = _ssh_host_key_sha256(key)
    client = FakeClient()

    PinnedHostKeyPolicy(expected).missing_host_key(client, "runner.example", key)

    assert client.host_keys.added == [("runner.example", "ssh-ed25519", key)]

    with pytest.raises(SSHException, match="fingerprint mismatch"):
        PinnedHostKeyPolicy("SHA256:9mYpK4pQd6VG8t7jPjvaERh6XiW6m87iJi3G5EPI3Hk").missing_host_key(
            FakeClient(),
            "runner.example",
            key,
        )


def test_run_atomic_test_requires_pinned_host_key_before_connecting():
    runner = {
        "runner_type": "SSH",
        "hostname": "runner.example",
        "port": 22,
        "username": "purvex",
        "auth_method": "key",
        "key_path": "/tmp/id_ed25519",
        "os": "linux",
    }

    with pytest.raises(RuntimeError, match="host key SHA256 fingerprint is required"):
        run_atomic_test("T1059.004", "purvex_lab_1234", runner)


def test_runner_snapshot_includes_pinned_host_key():
    runner = SimpleNamespace(
        id=7,
        environment_name="lab",
        runner_type="SSH",
        hostname="runner.example",
        port=2222,
        username="purvex",
        auth_method="key",
        key_path="/opt/purvex/id_ed25519",
        ssh_host_key_sha256="SHA256:9mYpK4pQd6VG8t7jPjvaERh6XiW6m87iJi3G5EPI3Hk",
        os="Linux",
    )

    snapshot = _runner_snapshot(runner)

    assert snapshot["ssh_host_key_sha256"] == runner.ssh_host_key_sha256
    assert snapshot["port"] == 2222
    assert snapshot["os"] == "linux"
