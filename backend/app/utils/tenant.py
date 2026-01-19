from fastapi import HTTPException, status

from .. import models


def require_org_id(user: models.User) -> int:
  """
  Ensure the current user is associated with an organization and return its id.

  In a multi-tenant deployment, this must be called before any org-scoped
  query. If organization_id is missing, we treat it as a server-side
  configuration error rather than silently falling back to global access.
  """
  org_id = getattr(user, "organization_id", None)
  if org_id is None:
      raise HTTPException(
          status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
          detail="User is not associated with an organization.",
      )
  return int(org_id)


