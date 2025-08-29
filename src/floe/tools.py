from src.server import mcp


# Documentation and Search Tools
@mcp.tool(
    name="floe-docs-search",
    description="Retrieve relevant passages and links from Floe documentation and knowledge sources (RAG).",
)
def floe_docs_search(
    query: str,
    top_k: int = 5,
    source: str = None,
    section: str = None,
    before: str = None,
    after: str = None,
) -> dict:
    """Search Floe documentation and knowledge sources."""
    return {
        "matches": [
            {
                "passage": f"Sample documentation passage for query: {query}",
                "source_uri": "https://docs.floe.com/search",
                "score": 0.95,
                "citation": {
                    "title": "Floe Documentation",
                    "section": "Search Results",
                    "offset_start": 0,
                    "offset_end": 100,
                },
            }
        ]
    }


# Account and Position Tools
@mcp.tool(
    name="floe-account-positions",
    description="Return open loans, collateral, and health metrics for a wallet (optionally scoped to a chain).",
)
def floe_account_positions(
    wallet: str, chain_id: int = None, include_history: bool = False
) -> dict:
    """Get account positions for a wallet."""
    return {
        "wallet": wallet,
        "chain_id": chain_id or 1,
        "positions": [
            {
                "loan_id": "loan_123",
                "side": "borrow",
                "asset": "USDC",
                "principal": "1000.00",
                "rate_apr_bps": 500,
                "duration_iso": "P30D",
                "status": "open",
                "collateral": [{"asset": "ETH", "amount": "0.5"}],
                "health_factor": 1.2,
                "updated_at": "2024-01-01T00:00:00Z",
            }
        ],
        "summary": {
            "total_borrowed_usd": 1000.0,
            "total_lent_usd": 0.0,
            "total_collateral_usd": 1200.0,
            "aggregate_health": 1.2,
        },
    }


# Intent Management Tools
@mcp.tool(
    name="floe-intent-list",
    description="Discover intents (mine or global) with filters and pagination.",
)
def floe_intent_list(
    mine: bool = True,
    wallet: str = None,
    side: str = None,
    status: list = None,
    asset: str = None,
    collateral_asset: str = None,
    chain_id: int = None,
    limit: int = 50,
    cursor: str = None,
) -> dict:
    """List intents with filters and pagination."""
    return {
        "items": [
            {
                "id": "intent_123",
                "wallet": wallet or "0x123...",
                "side": side or "borrow",
                "asset": asset or "USDC",
                "amount": "1000.00",
                "rate_apr_bps": 500,
                "duration_iso": "P30D",
                "ltv_bps": 8000,
                "chain_id": chain_id or 1,
                "status": "open",
                "created_at": "2024-01-01T00:00:00Z",
                "expires_at": "2024-02-01T00:00:00Z",
            }
        ],
        "next_cursor": "next_page_token",
    }


@mcp.tool(
    name="floe-intent-status",
    description="Fetch lifecycle and recent events for an intent.",
)
def floe_intent_status(id: str) -> dict:
    """Get intent status and lifecycle information."""
    return {
        "id": id,
        "lifecycle": "open",
        "expires_at": "2024-02-01T00:00:00Z",
        "required_signatures": ["0x123..."],
        "events": [
            {
                "ts": "2024-01-01T00:00:00Z",
                "type": "created",
                "detail": "Intent created successfully",
            }
        ],
    }


@mcp.tool(
    name="floe-intent-preview",
    description="Read-only preview for borrow/lend forms: pricing, health, fees, gas.",
)
def floe_intent_preview(
    side: str,
    asset: str,
    amount: str,
    duration_iso: str,
    max_rate_apr_bps: int = None,
    min_rate_apr_bps: int = None,
    collateral_asset: str = None,
    collateral_amount: str = None,
    ltv_bps: int = None,
    expires_in: int = None,
    valid_from: str = None,
    min_fill_amount: str = None,
    allow_partial_fills: bool = True,
    on_behalf_of: str = None,
    matcher_commission_bps: int = None,
    chain_id: int = None,
) -> dict:
    """Preview intent with pricing, health, fees, and gas estimates."""
    return {
        "quote_id": "quote_123",
        "effective_rate_apr_bps": max_rate_apr_bps or min_rate_apr_bps or 500,
        "required_collateral": (
            [{"asset": collateral_asset or "ETH", "amount": collateral_amount or "0.5"}]
            if side == "borrow"
            else []
        ),
        "health_factor": 1.2,
        "fees_estimate_usd": 25.0,
        "gas_estimate": {"limit": 150000, "price": "20000000000", "fee_usd": 15.0},
        "warnings": [],
    }


@mcp.tool(
    name="floe-intent-create",
    description="Create a draft intent (borrow or lend). Returns an unsigned payload.",
)
def floe_intent_create(
    side: str,
    asset: str,
    amount: str,
    duration_iso: str,
    max_rate_apr_bps: int = None,
    min_rate_apr_bps: int = None,
    collateral_asset: str = None,
    collateral_amount: str = None,
    ltv_bps: int = None,
    min_fill_amount: str = None,
    allow_partial_fills: bool = True,
    expires_in: int = None,
    valid_from: str = None,
    matcher_commission_bps: int = None,
    on_behalf_of: str = None,
    chain_id: int = None,
    post_mode: str = "gasless",
    simulate_only: bool = True,
    quote_id: str = None,
) -> dict:
    """Create a draft intent for borrowing or lending."""
    return {
        "draft_id": f"draft_{side}_{asset}_{amount}",
        "payload_eip712": "0x...",
        "tx_data": "0x...",
        "required_signers": [on_behalf_of or "0x123..."],
    }


@mcp.tool(
    name="floe-intent-postSigned",
    description="Publish a previously created draft using signatures or a signed transaction.",
)
def floe_intent_post_signed(draft_id: str, signatures: list = None) -> dict:
    """Post a signed intent."""
    return {"intent_id": f"intent_{draft_id}", "posted": True, "tx_hash": "0x..."}


@mcp.tool(
    name="floe-intent-update",
    description="Edit safe, mutable fields of an existing intent.",
)
def floe_intent_update(id: str, fields: dict) -> dict:
    """Update intent fields."""
    return {
        "id": id,
        "previous_values": {"rate_apr_bps": 500},
        "current_values": fields,
    }


@mcp.tool(
    name="floe-intent-extend",
    description="Increase the time-to-live of an open intent.",
)
def floe_intent_extend(id: str, add_expires_in: int) -> dict:
    """Extend intent expiry time."""
    return {"id": id, "expires_at": "2024-03-01T00:00:00Z"}


@mcp.tool(
    name="floe-intent-pause",
    description="Temporarily hide an intent from matching.",
)
def floe_intent_pause(id: str) -> dict:
    """Pause an intent."""
    return {"id": id, "status": "paused"}


@mcp.tool(
    name="floe-intent-resume",
    description="Resume a paused intent for matching.",
)
def floe_intent_resume(id: str) -> dict:
    """Resume a paused intent."""
    return {"id": id, "status": "open"}


@mcp.tool(
    name="floe-intent-cancel",
    description="Cancel an open intent. Idempotent; returns prior state if already cancelled.",
)
def floe_intent_cancel(id: str, reason: str = None) -> dict:
    """Cancel an intent."""
    return {"id": id, "status": "cancelled"}


# Loan Management Tools
@mcp.tool(
    name="floe-loan-list",
    description="List loans for a wallet with filters and pagination.",
)
def floe_loan_list(
    wallet: str,
    status: list = None,
    chain_id: int = None,
    limit: int = 50,
    cursor: str = None,
) -> dict:
    """List loans for a wallet."""
    return {
        "items": [
            {
                "loan_id": "loan_123",
                "side": "borrow",
                "asset": "USDC",
                "principal": "1000.00",
                "rate_apr_bps": 500,
                "duration_iso": "P30D",
                "due_at": "2024-02-01T00:00:00Z",
                "status": "active",
                "chain_id": chain_id or 1,
                "accrued_interest": "10.50",
                "collateral_value_usd": 1200.0,
                "liquidation_threshold_usd": 1000.0,
            }
        ],
        "next_cursor": "next_page_token",
    }


@mcp.tool(
    name="floe-loan-repay",
    description="Repay part or all of an outstanding loan; optional preview mode.",
)
def floe_loan_repay(
    loan_id: str,
    amount: str,
    preview: bool = False,
    chain_id: int = None,
    source_wallet: str = None,
) -> dict:
    """Repay a loan."""
    return {
        "loan_id": loan_id,
        "remaining_principal": "500.00",
        "status": "partial_repaid" if not preview else "preview",
        "receipts": ["receipt_123"],
        "tx_hash": "0x..." if not preview else None,
    }


@mcp.tool(
    name="floe-loan-claimInterest",
    description="Claim accrued interest on a lend-side loan; optional preview mode.",
)
def floe_loan_claim_interest(
    loan_id: str, preview: bool = False, chain_id: int = None, source_wallet: str = None
) -> dict:
    """Claim interest on a loan."""
    return {
        "loan_id": loan_id,
        "claimed_amount": "25.50",
        "status": "claimed" if not preview else "preview",
        "tx_hash": "0x..." if not preview else None,
    }


@mcp.tool(
    name="floe-loan-close",
    description="Close a fully repaid loan and release collateral.",
)
def floe_loan_close(
    loan_id: str, chain_id: int = None, source_wallet: str = None
) -> dict:
    """Close a loan and release collateral."""
    return {
        "loan_id": loan_id,
        "collateral_released": [{"asset": "ETH", "amount": "0.5"}],
        "status": "closed",
        "tx_hash": "0x...",
    }


# Policy and Configuration Tools
@mcp.tool(
    name="floe-policy-config-read",
    description="Read protocol policy limits and supported assets for a given chain.",
)
def floe_policy_config_read(chain_id: int = None) -> dict:
    """Read policy configuration for a chain."""
    return {
        "assets": [
            {"symbol": "USDC", "address": "0x...", "decimals": 6},
            {"symbol": "ETH", "address": "0x...", "decimals": 18},
        ],
        "apr_bps_range": {"min": 100, "max": 2000},
        "ltv_bps_range": {"min": 5000, "max": 9000},
        "min_fill_amount": "100.00",
        "max_duration_iso": "P365D",
    }


# Risk and Health Tools
@mcp.tool(
    name="floe-risk-health",
    description="Compute health factor and liquidation thresholds by wallet OR by parameter set.",
)
def floe_risk_health(wallet: str = None, params: dict = None) -> dict:
    """Compute health factor and liquidation thresholds."""
    return {
        "health_factor": 1.2,
        "liquidation_thresholds": [{"asset": "ETH", "threshold_usd": 1000.0}],
        "notes": "Wallet is healthy",
    }


# Matching and Pricing Tools
@mcp.tool(
    name="floe-match-quote",
    description="Deterministic pricing snapshot without routing; returns fillable size and APR for a short TTL.",
)
def floe_match_quote(params: dict, ttl_s: int = 60) -> dict:
    """Get a match quote."""
    return {
        "rate_apr_bps": params.get("rate_apr_bps", 500),
        "fillable_amount": params.get("amount", "1000.00"),
        "fee_usd": 25.0,
        "expires_at": "2024-01-01T01:00:00Z",
    }


@mcp.tool(
    name="floe-match-simulate",
    description="Pathfinding + gas simulation for an intent or raw params. No state written.",
)
def floe_match_simulate(
    intent_id: str = None,
    params: dict = None,
    pathfinding: bool = True,
    simulate_block: str = None,
    gas_price_mode: str = "avg",
) -> dict:
    """Simulate a match with pathfinding and gas estimation."""
    return {
        "effective_rate_apr_bps": 500,
        "slippage_bps": 10.0,
        "gas_estimate": {"limit": 150000, "price": "20000000000", "fee_usd": 15.0},
        "routes": [{"path": ["USDC", "ETH"], "impact_bps": 5.0}],
        "warnings": [],
    }


# Support Tools
@mcp.tool(
    name="floe-support-ticket-create",
    description="Open a support ticket with severity, context, and optional attachments.",
)
def floe_support_ticket_create(
    summary: str, severity: str, context: dict = None, attachments: list = None
) -> dict:
    """Create a support ticket."""
    return {
        "ticket_id": "ticket_123",
        "status": "open",
        "url": "https://support.floe.com/ticket_123",
        "sla": "24 hours",
        "assignee": "support_team",
    }


# Event Management Tools
@mcp.tool(
    name="floe-events-subscribe",
    description="Open a subscription for intent or loan events.",
)
def floe_events_subscribe(type: str, id: str) -> dict:
    """Subscribe to events."""
    return {"subscription_id": f"sub_{type}_{id}"}


@mcp.tool(
    name="floe-events-poll",
    description="Poll a subscription for recent events (useful if streaming is unavailable).",
)
def floe_events_poll(subscription_id: str, cursor: str = None) -> dict:
    """Poll for events."""
    return {
        "events": [
            {
                "ts": "2024-01-01T00:00:00Z",
                "type": "updated",
                "entity_type": "intent",
                "entity_id": "intent_123",
                "data": {"status": "matched"},
            }
        ],
        "next_cursor": "next_event_cursor",
    }


# Admin Tools
@mcp.tool(
    name="admin-liquidation-simulate",
    description="Administrative simulation of liquidation impact for a wallet or a single loan. No state change.",
)
def admin_liquidation_simulate(
    target: str,
    mode: str,
    slippage_bps: int = 50,
    max_sell: str = None,
    chain_id: int = None,
) -> dict:
    """Simulate liquidation impact."""
    return {
        "target": target,
        "estimated_penalty_bps": 100.0,
        "collateral_to_sell": [{"asset": "ETH", "amount": "0.5"}],
        "health_after": 1.1,
        "routes": [{"path": ["ETH", "USDC"], "impact_bps": 20.0}],
        "notes": "Simulation completed successfully",
    }
