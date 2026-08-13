"""Amazon commerce extension — self-contained: the SP-API client
(`extensions/amazon/service.py`) and the LWA OAuth connect/callback routes
(`extensions/amazon/routes.py`) both live inside this folder, mirroring
extensions/shopify/extension.py.

Scope is order lookup only for now — refund/cancel would go through Amazon's
asynchronous Feeds API, which is blocked on a Solution Provider Portal
permissions grant not yet completed (Phase 0b,
docs/AMAZON_INTEGRATION_PLAN.md §6). Not implemented here rather than stubbed,
so there's nothing pretending to work that doesn't.

manage_url points at a dedicated portal page (not the generic
install-a-config-object flow bp_extensions.py offers everything else) for the
same reason as Shopify: the connect step needs a real browser redirect to
Amazon's seller-consent screen, which a JSON install endpoint can't do.
"""
from extensions.base import ConfigField, Extension, ExtensionKind, ExtensionManifest


class AmazonExtension(Extension):
    manifest = ExtensionManifest(
        id="amazon",
        name="Amazon",
        kind=ExtensionKind.COMMERCE,
        category="Commerce",
        description="Order lookup for a connected Amazon seller account (Sandbox — see docs/AMAZON_INTEGRATION_PLAN.md)",
        icon="\U0001F4E6",
        config_schema=[
            ConfigField(name="marketplace_ids", label="Marketplace ID", placeholder="ATVPDKIKX0DER"),
        ],
        capabilities=["oauth"],
        manage_url="/admin/amazon",
    )

    def status(self, org_id: str) -> dict:
        from common.db._amazon import connection_status
        return connection_status(org_id) or {"status": "not_connected"}

    async def find_order(self, org_id: str, order_number: str, email: str = None):
        from extensions.amazon.service import amazon_service
        return await amazon_service.find_order(org_id, order_number, email)


EXTENSION = AmazonExtension()
