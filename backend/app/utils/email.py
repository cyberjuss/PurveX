"""
Outbound transactional email (password reset, user invites).

SMTP is optional. When ``SMTP_HOST`` is unset, ``send_email`` logs a loud
warning and returns without raising — callers (password reset, invites) are
written so the API response stays correct either way (no enumeration
leakage, no 500s) and only the actual email delivery is skipped.
"""

from __future__ import annotations

import html
import logging
from email.message import EmailMessage

import aiosmtplib

from ..config import settings

logger = logging.getLogger(__name__)


def is_email_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_FROM_EMAIL)


async def send_email(to: str, subject: str, text_body: str, html_body: str) -> bool:
    """Send a single email. Returns True on success, False if SMTP isn't
    configured or the send failed (both are logged; neither raises)."""
    if not is_email_configured():
        logger.warning(
            "SMTP is not configured — skipping email send (subject=%r, to=%s). "
            "Set SMTP_HOST/SMTP_FROM_EMAIL to enable outbound email.",
            subject,
            to,
        )
        return False

    message = EmailMessage()
    message["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    try:
        await aiosmtplib.send(
            message,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USERNAME or None,
            password=settings.SMTP_PASSWORD or None,
            start_tls=settings.SMTP_USE_TLS,
        )
        return True
    except Exception:
        logger.exception("Failed to send email (subject=%r, to=%s)", subject, to)
        return False


def _wrap_html(title: str, body_html: str) -> str:
    return f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f5f7fc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e6eaf2;border-radius:12px;padding:32px;">
            <tr><td>
              <p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#10192e;">PurveX</p>
              <h1 style="margin:0 0 12px;font-size:20px;color:#10192e;">{title}</h1>
              {body_html}
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


async def send_password_reset_email(to: str, reset_link: str) -> bool:
    subject = "Reset your PurveX password"
    text_body = (
        "We received a request to reset your PurveX password.\n\n"
        f"Reset it here: {reset_link}\n\n"
        "This link expires in 30 minutes. If you did not request this, you can ignore this email."
    )
    html_body = _wrap_html(
        "Reset your password",
        f"""
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3f4a63;">
          We received a request to reset your PurveX password. This link expires in 30 minutes.
        </p>
        <a href="{reset_link}" style="display:inline-block;padding:10px 20px;background:#5546e0;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
          Reset password
        </a>
        <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#8a95ac;">
          If you did not request this, you can safely ignore this email.
        </p>
        """,
    )
    return await send_email(to, subject, text_body, html_body)


async def send_invite_email(to: str, invite_link: str, inviter_name: str | None = None) -> bool:
    # inviter_name comes from an admin's username/email, which has no
    # character restriction — escape it before it lands in the HTML body.
    # The plaintext body doesn't need escaping (and shouldn't get it, or
    # a name containing "&" would render as "&amp;" to a text client).
    inviter = f"{inviter_name} has" if inviter_name else "You have been"
    inviter_html = f"{html.escape(inviter_name)} has" if inviter_name else "You have been"
    subject = "You have been invited to PurveX"
    text_body = (
        f"{inviter} invited you to join PurveX.\n\n"
        f"Accept your invite here: {invite_link}\n\n"
        "This link expires in 7 days."
    )
    html_body = _wrap_html(
        "You have been invited",
        f"""
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3f4a63;">
          {inviter_html} invited you to join PurveX. This link expires in 7 days.
        </p>
        <a href="{invite_link}" style="display:inline-block;padding:10px 20px;background:#5546e0;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
          Accept invite
        </a>
        """,
    )
    return await send_email(to, subject, text_body, html_body)
