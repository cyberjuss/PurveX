"""Tests for outbound transactional email (app/utils/email.py).

Covers the HTML-escaping fix for ``send_invite_email``: ``inviter_name``
comes from an admin's username/email (no character restriction) and was
previously spliced into the HTML body unescaped, letting arbitrary markup
into an otherwise-legitimate, DKIM/SPF-passing invite email.
"""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_invite_email_escapes_malicious_inviter_name(monkeypatch):
    from app.utils import email

    captured = {}

    async def _fake_send_email(to, subject, text_body, html_body):
        captured["to"] = to
        captured["subject"] = subject
        captured["text_body"] = text_body
        captured["html_body"] = html_body
        return True

    monkeypatch.setattr(email, "send_email", _fake_send_email)

    malicious_name = '<a href="https://evil.example/phish">Urgent</a><script>alert(1)</script>'
    await email.send_invite_email(
        "victim@example.com",
        "https://purvex.example/accept-invite?token=abc",
        inviter_name=malicious_name,
    )

    # The raw tag must not appear in the HTML body — it must be escaped.
    assert "<script>" not in captured["html_body"]
    assert '<a href="https://evil.example' not in captured["html_body"]
    assert "&lt;script&gt;" in captured["html_body"]
    assert "&lt;a href=" in captured["html_body"]

    # Plaintext body is unescaped on purpose — it's not rendered as HTML,
    # so escaping it would show literal "&lt;" to a text-mode client.
    assert malicious_name in captured["text_body"]


@pytest.mark.asyncio
async def test_invite_email_without_inviter_name_uses_default_copy(monkeypatch):
    from app.utils import email

    captured = {}

    async def _fake_send_email(to, subject, text_body, html_body):
        captured["html_body"] = html_body
        captured["text_body"] = text_body
        return True

    monkeypatch.setattr(email, "send_email", _fake_send_email)

    await email.send_invite_email(
        "victim@example.com",
        "https://purvex.example/accept-invite?token=abc",
        inviter_name=None,
    )

    assert "You've been invited you to join PurveX" in captured["html_body"]
    assert "You've been invited you to join PurveX" in captured["text_body"]
