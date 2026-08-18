"""conversations.resolved: INTEGER to BOOLEAN

Closes the gap behind M-02 in docs/ARCHITECTURE_REVIEW.md: this column was
INTEGER (0/1) while newer tables in this schema correctly use BOOLEAN.
Investigating it surfaced a live bug — bp_studio_inspector.py's ticket filter
compared it against TRUE/FALSE, which Postgres rejects for an integer column
("operator does not exist: integer = boolean"). That comparison was patched
to match the old INTEGER type as an immediate fix; this migration does the
fuller fix so the column matches every other boolean flag in the schema, and
reverts that patch back to the natural TRUE/FALSE comparison.

Verified before writing this: no code in web/ui reads back the raw `resolved`
value from any API response (checked every consumer — bp_studio_inspector.py's
filter, common/db/_analytics.py's get_recent_conversations, and every place
that renders that endpoint's response in AnalyticsPage.jsx / InspectorPage.jsx).
The type change is therefore safe with respect to JSON serialization
(1/0 -> true/false) — nothing downstream distinguishes the two.

Revision ID: 12bd2020ac48
Revises: 414f8fd00f34
Create Date: 2026-08-18 17:44:38.073787

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '12bd2020ac48'
down_revision: Union[str, Sequence[str], None] = '414f8fd00f34'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE conversations "
        "ALTER COLUMN resolved DROP DEFAULT, "
        "ALTER COLUMN resolved TYPE BOOLEAN USING (resolved <> 0), "
        "ALTER COLUMN resolved SET DEFAULT FALSE"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE conversations "
        "ALTER COLUMN resolved DROP DEFAULT, "
        "ALTER COLUMN resolved TYPE INTEGER USING (resolved::INTEGER), "
        "ALTER COLUMN resolved SET DEFAULT 0"
    )
