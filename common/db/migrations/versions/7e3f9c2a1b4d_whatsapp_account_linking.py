"""WhatsApp account-linking table

Adds whatsapp_links (docs/plans/WHATSAPP_INTEGRATION_PLAN.md Phase 3) — proves
which IAM account owns a given WhatsApp number via a portal-initiated OTP the
user receives on that number and types back. wa_id is the PK since
extensions/whatsapp/bridge.py always looks up by wa_id on every inbound
message. Mirrors the CREATE TABLE IF NOT EXISTS already added to
common/db/_connection.py's legacy DDL runner (see that file's baseline
migration docstring for why both exist).

Revision ID: 7e3f9c2a1b4d
Revises: 12bd2020ac48
Create Date: 2026-08-27 16:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7e3f9c2a1b4d'
down_revision: Union[str, Sequence[str], None] = '12bd2020ac48'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE IF NOT EXISTS whatsapp_links (
            wa_id               TEXT PRIMARY KEY,
            org_id              TEXT NOT NULL,
            iam_sub             TEXT NOT NULL,
            display_name        TEXT,
            status              TEXT NOT NULL DEFAULT 'pending',
            verification_code   TEXT,
            code_expires_at     TIMESTAMPTZ,
            confirmed_at        TIMESTAMPTZ,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"""
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_wa_links_iam_sub ON whatsapp_links(iam_sub)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_wa_links_org     ON whatsapp_links(org_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS whatsapp_links")
