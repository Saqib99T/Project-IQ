"""Shopify commerce extension — fully self-contained: the GraphQL client
(`extensions/shopify/service.py`) and the OAuth connect/callback/webhook
routes (`extensions/shopify/routes.py`) both live inside this folder, not in
action_server/ or web/api/blueprints/. This module just exposes that logic
through the standard Extension contract.

manage_url still points at a dedicated portal page (not the generic
install-a-config-object flow bp_extensions.py offers everything else) because
Shopify's connect step needs a real browser redirect for Shopify's consent
screen — something a JSON install endpoint can't do. That page talks to the
routes in extensions/shopify/routes.py, same as before.
"""
from extensions.base import ConfigField, Extension, ExtensionKind, ExtensionManifest, RunResult


class ShopifyExtension(Extension):
    manifest = ExtensionManifest(
        id="shopify",
        name="Shopify",
        kind=ExtensionKind.COMMERCE,
        category="Commerce",
        description="Order lookup, refund, cancel and shipping-address updates for a connected Shopify store",
        icon="\U0001F6CD",
        config_schema=[
            ConfigField(name="shop_domain", label="Shop domain", placeholder="your-store.myshopify.com"),
        ],
        capabilities=["oauth", "webhook_receiver", "write_actions"],
        manage_url="/admin/shopify",
    )

    def status(self, org_id: str) -> dict:
        from common.db._shopify import connection_status
        return connection_status(org_id) or {"status": "not_connected"}

    async def find_order(self, org_id: str, order_number: str, email: str = None):
        from extensions.shopify.service import shopify_service
        return await shopify_service.find_order(org_id, order_number, email)

    async def get_suggested_refund(self, org_id: str, order_gid: str):
        from extensions.shopify.service import shopify_service
        return await shopify_service.get_suggested_refund(org_id, order_gid)

    async def refund_order(self, org_id: str, order_gid: str, note: str = None):
        from extensions.shopify.service import shopify_service
        return await shopify_service.refund_order(org_id, order_gid, note=note)

    async def cancel_order(self, org_id: str, order_gid: str, reason: str = "CUSTOMER",
                            restock: bool = True, notify_customer: bool = True):
        from extensions.shopify.service import shopify_service
        return await shopify_service.cancel_order(
            org_id, order_gid, reason=reason, restock=restock, notify_customer=notify_customer,
        )

    async def update_shipping_address(self, org_id: str, order_gid: str, address: dict,
                                       fallback_name: dict = None):
        from extensions.shopify.service import shopify_service
        return await shopify_service.update_shipping_address(
            org_id, order_gid, address, fallback_name=fallback_name,
        )


EXTENSION = ShopifyExtension()
