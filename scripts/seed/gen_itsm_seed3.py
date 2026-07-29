#!/usr/bin/env python3
"""Phase-3 demo seed for itsm_db: Support Recording + RCA Governance
(specs/08, Phase 1+2 — migrations 0034-0036). Re-derives Phase-1/2 ids via the
SAME uuid5 scheme so all FKs line up. Idempotent (ON CONFLICT DO NOTHING for
inserts; UPDATE statements re-set the same values so re-running is a no-op).
Emits SQL to stdout.

Story per tenant — one recording/RCA pipeline spanning every lifecycle stage:
  RCA-2026-0001  completed          <- inc_a  "Payments API outage"      (+ bridge-call recording, no ticket)
  RCA-2026-0002  actions_in_progress<- t05     "Intermittent packet loss" (+ recording, 1 overdue action + 1 verified)
  RCA-2026-0003  under_review       <- t08     "Payroll app slow"         (+ recording, consent disputed -> 3 evidence gaps)
  RCA-2026-0004  overdue            <- t02     "Office VPN down"          (+ recording, inaccessible + missing consent)
  RCA-2026-0005  waived             <- t09     "Printer jamming"          (no recording; manager waived as trivial)
Plus one plain, non-RCA recording on t01 to show the everyday "attach a call
recording" flow with nothing governance-related attached.
"""
import uuid, json, datetime as dt

NS = uuid.uuid5(uuid.NAMESPACE_DNS, "piq-demo-seed.99t.local")
def u(key): return str(uuid.uuid5(NS, key))

# Phase-1/2 anchor (unchanged — keeps ticket/incident ages internally consistent)
NOW = dt.datetime(2026, 7, 2, 12, 0, 0)
def ts(days=0, hours=0, minutes=0):
    return (NOW + dt.timedelta(days=days, hours=hours, minutes=minutes)).isoformat()

# Phase-3 anchor = "today" — RCA due dates/history should read as live, not stale
NOW3 = dt.datetime(2026, 7, 29, 12, 0, 0)
def t3(days=0, hours=0, minutes=0):
    return (NOW3 + dt.timedelta(days=days, hours=hours, minutes=minutes)).isoformat()

TENANTS = [
    ("blue", "06a270ba-09fc-7752-8000-0b10a0c66562"),
    ("piq",  "7862dc84-72d6-40a9-b2b1-c7c7896bc148"),
    ("acme", None),
]

OUT = []
def emit(s): OUT.append(s)
def q(v):
    if v is None: return "NULL"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"
def jb(d): return "%s::jsonb" % q(json.dumps(d))
def ins(table, cols, rows, conflict="(id)"):
    if not rows: return
    vals = ["(" + ",".join(str(r[c.strip('\"')]) for c in cols) + ")" for r in rows]
    tgt = "ON CONFLICT %s DO NOTHING" % conflict if conflict else ""
    emit("INSERT INTO %s (%s) VALUES\n%s\n%s;" % (table, ",".join(cols), ",\n".join(vals), tgt))
def upd(table, set_cols, where):
    emit("UPDATE %s SET %s WHERE %s;" % (table, ", ".join(set_cols), where))

RCA_EVIDENCE_TYPES = [
    "primary_ticket_linked", "customer_impact_documented", "timeline_completed",
    "recording_linked_if_exists", "recording_summary_reviewed", "logs_alerts_linked",
    "service_asset_impact_linked", "sla_breach_evidence_linked",
    "customer_communication_captured", "corrective_actions_created", "approval_comments_present",
]


def build3(slug, tid):
    P = lambda s: "%s:%s" % (slug, s)
    K = lambda s: u(P("p3:" + s))  # phase-3 key namespace

    # ---- re-derive ids from phase 1/2 ----
    uid = {k: u(P("user:" + k)) for k in ("mgr", "lead", "ag1", "ag2", "ag3", "eu1", "eu2", "eu3")}
    t_sd, t_infra = u(P("team:sd")), u(P("team:infra"))
    svc_pay = u(P("svc:pay"))
    tk = {k: u(P("tk:" + k)) for k in ("t01", "t02", "t05", "t08", "t09")}
    inc_a = u(P("inc:a"))
    retro_a = u(P("retro:a"))
    ai1, ai2 = u(P("ai:1")), u(P("ai:2"))

    # ================= Tenant recording policy (singleton) =================
    ins("tenant_recording_policies",
        ["tenant_id", "recording_consent_required", "consent_source", "block_link_if_missing_consent",
         "allow_customer_visibility", "redact_transcript_before_ai", "allow_ai_summary",
         "recording_retention_days", "allow_manual_upload"],
        [{"tenant_id": q(tid), "recording_consent_required": q(True), "consent_source": q("teams_notice"),
          "block_link_if_missing_consent": q(False), "allow_customer_visibility": q(False),
          "redact_transcript_before_ai": q(True), "allow_ai_summary": q(True),
          "recording_retention_days": 365, "allow_manual_upload": q(True)}],
        conflict="(tenant_id)")

    # ================= RCA policies (policy builder demo rows) =================
    pol_a, pol_b, pol_c = K("rcapol:major"), K("rcapol:slabreach"), K("rcapol:repeat")
    ins("rca_policies", ["id", "tenant_id", "name", "description", "status", "conditions", "outputs", "priority", "created_by"],
        [{"id": q(pol_a), "tenant_id": q(tid), "name": q("Major incident postmortem"),
          "description": q("SEV1/SEV2 incidents always require a governed RCA."),
          "status": q("active"),
          "conditions": jb([{"field": "incident.severity", "op": "in", "value": ["SEV1", "SEV2"]}]),
          "outputs": jb({"owner_role": "team_lead", "approver_role": "manager", "due_days": 3,
                          "required_evidence_types": RCA_EVIDENCE_TYPES}),
          "priority": 10, "created_by": q(uid["mgr"])},
         {"id": q(pol_b), "tenant_id": q(tid), "name": q("SLA breach on high/critical ticket"),
          "description": q("A breached SLA on a high or critical ticket triggers an RCA owned by the assignee."),
          "status": q("active"),
          "conditions": jb([{"field": "ticket.priority", "op": "in", "value": ["high", "critical"]},
                             {"field": "ticket.sla_breached", "op": "eq", "value": True}]),
          "outputs": jb({"owner_role": "agent", "approver_role": "team_lead", "due_days": 5}),
          "priority": 20, "created_by": q(uid["mgr"])},
         {"id": q(pol_c), "tenant_id": q(tid), "name": q("Repeat incident review"),
          "description": q("Three or more recurrences of the same issue require a review, but may be waived by a manager if the root cause is already known and resolved."),
          "status": q("active"),
          "conditions": jb([{"field": "ticket.tag", "op": "eq", "value": "recurring"}]),
          "outputs": jb({"owner_role": "agent", "approver_role": "manager", "due_days": 7}),
          "priority": 30, "created_by": q(uid["mgr"])}])

    # ================= Support recordings =================
    rec_t01 = K("rec:t01")   # plain, non-RCA — everyday attach-a-call-recording flow
    rec_t05 = K("rec:t05")   # RCA-2 evidence — clean happy path
    rec_t08 = K("rec:t08")   # RCA-3 evidence — sensitivity/consent gate blocks approval
    rec_t02 = K("rec:t02")   # RCA-4 evidence — inaccessible, missing consent
    rec_inc = K("rec:inc")   # RCA-1 evidence — bridge call, no ticket (incident-only)

    recs = [
        {"id": rec_t01, "source_type": "teams", "title": "Laptop won't boot — troubleshooting call w/ Casey Brooks",
         "description": "Screen-share to diagnose a Windows Update stuck at boot. Tried safe mode, then a rollback.",
         "started": t3(days=-6, hours=1), "ended": t3(days=-6, hours=1, minutes=22), "dur": 1320,
         "organizer": uid["ag1"], "org_email": "%s@%s.demo" % ("ag1", slug),
         "cc_name": "Casey Brooks", "cc_email": "casey.brooks@%s.demo" % slug,
         "consent": "captured_in_teams", "sensitivity": "normal", "access": "ticket_team_only",
         "status": "linked", "ai_status": "completed",
         "ai_summary": "Customer's laptop hung on a Windows Update splash screen after a forced restart. Agent booted into safe mode, confirmed the update service was corrupted, then rolled back the pending update and re-applied it cleanly. Laptop boots normally; no data loss. No follow-up needed.",
         "ai_actions": [{"title": "Confirm update rollback didn't affect BitLocker key escrow", "owner_suggestion": "ag1", "confidence": 0.62}]},
        {"id": rec_t05, "source_type": "teams", "title": "3rd floor packet loss — on-site diagnostic w/ Taylor Okafor",
         "description": "Screen-share of switch diagnostics while investigating intermittent packet loss.",
         "started": t3(days=-9, hours=2), "ended": t3(days=-9, hours=2, minutes=41), "dur": 2460,
         "organizer": uid["ag3"], "org_email": "%s@%s.demo" % ("ag3", slug),
         "cc_name": None, "cc_email": None,
         "consent": "manually_confirmed", "sensitivity": "normal", "access": "ticket_team_only",
         "status": "linked", "ai_status": "completed",
         "ai_summary": "Agent captured a packet trace on the 3rd-floor switch stack during an active loss event and identified a flapping uplink port. A temporary reroute restored stable connectivity; root cause traced to a failing SFP module on switch port 14, scheduled for replacement.",
         "ai_actions": [{"title": "Replace SFP module on switch port 14", "owner_suggestion": "ag3", "confidence": 0.88}]},
        {"id": rec_t08, "source_type": "sharepoint", "title": "Payroll slowness review — includes finance walkthrough",
         "description": "Customer shared their screen to demo the slowdown; briefly showed a payroll record with an account number visible.",
         "started": t3(days=-2, hours=3), "ended": t3(days=-2, hours=3, minutes=18), "dur": 1080,
         "organizer": uid["ag2"], "org_email": "%s@%s.demo" % ("ag2", slug),
         "cc_name": "Devin Flores", "cc_email": "devin.flores@%s.demo" % slug,
         "consent": "disputed", "sensitivity": "contains_pii", "access": "manager_only",
         "status": "needs_review", "ai_status": "skipped_no_consent",
         "ai_summary": None, "ai_actions": None},
        {"id": rec_t02, "source_type": "onedrive", "title": "VPN concentrator outage — infra bridge (customer leg)",
         "description": "Customer-facing leg of the VPN outage bridge; organizer's OneDrive link expired before it could be archived.",
         "started": t3(days=-5, hours=4), "ended": t3(days=-5, hours=4, minutes=35), "dur": 2100,
         "organizer": uid["ag3"], "org_email": "%s@%s.demo" % ("ag3", slug),
         "cc_name": None, "cc_email": None,
         "consent": "missing", "sensitivity": "normal", "access": "ticket_team_only",
         "status": "inaccessible", "ai_status": "not_requested",
         "ai_summary": None, "ai_actions": None},
        {"id": rec_inc, "source_type": "teams", "title": "Payments API outage — incident bridge (all-hands)",
         "description": "Full incident bridge call: detection, rollback decision, and recovery confirmation.",
         "started": ts(days=-5, hours=0, minutes=5), "ended": ts(days=-5, hours=1, minutes=5), "dur": 3600,
         "organizer": uid["mgr"], "org_email": "%s@%s.demo" % ("mgr", slug),
         "cc_name": None, "cc_email": None,
         "consent": "not_required", "sensitivity": "normal", "access": "ticket_team_only",
         "status": "linked", "ai_status": "completed",
         "ai_summary": "Incident bridge for the Payments API outage: on-call engineer identified a bad config deploy within 6 minutes of paging, IC approved an immediate rollback, and payments traffic recovered within ~40 minutes. No canary stage existed to catch the bad config pre-rollout; action item raised to add one.",
         "ai_actions": [{"title": "Add canary stage to payments deploy pipeline", "owner_suggestion": "lead", "confidence": 0.91}]},
    ]
    rrows = []
    for r in recs:
        rrows.append({
            "id": q(r["id"]), "tenant_id": q(tid), "source_type": q(r["source_type"]),
            "source_recording_id": q("demo-%s" % r["id"][:8]), "source_meeting_id": "NULL", "source_drive_id": "NULL", "source_item_id": "NULL",
            "recording_url": q("https://%s.demo/recordings/%s" % (r["source_type"], r["id"][:8])),
            "transcript_url": "NULL", "title": q(r["title"]), "description": q(r["description"]),
            "started_at": q(r["started"]), "ended_at": q(r["ended"]), "duration_seconds": r["dur"],
            "organizer_user_id": q(r["organizer"]), "organizer_email": q(r["org_email"]),
            "customer_contact_name": q(r["cc_name"]) if r["cc_name"] else "NULL",
            "customer_contact_email": q(r["cc_email"]) if r["cc_email"] else "NULL",
            "participants": jb([{"name": "Support Agent", "email": r["org_email"], "role": "organizer", "internal": True}] +
                                ([{"name": r["cc_name"], "email": r["cc_email"], "role": "customer", "internal": False}] if r["cc_name"] else [])),
            "consent_status": q(r["consent"]), "sensitivity": q(r["sensitivity"]), "access_policy": q(r["access"]),
            "retention_expires_at": q(t3(days=365)), "storage_mode": q("external_reference"), "storage_key": "NULL",
            "status": q(r["status"]), "ai_summary_status": q(r["ai_status"]),
            "ai_summary": q(r["ai_summary"]) if r["ai_summary"] else "NULL",
            "ai_action_items": jb(r["ai_actions"]) if r["ai_actions"] else "NULL",
            "created_by": q(r["organizer"]), "created_at": q(r["started"]), "updated_at": q(t3(hours=-6)),
        })
    ins("support_recordings",
        ["id", "tenant_id", "source_type", "source_recording_id", "source_meeting_id", "source_drive_id", "source_item_id",
         "recording_url", "transcript_url", "title", "description", "started_at", "ended_at", "duration_seconds",
         "organizer_user_id", "organizer_email", "customer_contact_name", "customer_contact_email", "participants",
         "consent_status", "sensitivity", "access_policy", "retention_expires_at", "storage_mode", "storage_key",
         "status", "ai_summary_status", "ai_summary", "ai_action_items", "created_by", "created_at", "updated_at"],
        rrows)

    # -- ticket recording links (rec_inc has no ticket — incident-only evidence) --
    ins("ticket_recording_links",
        ["ticket_id", "recording_id", "link_type", "linked_by", "linked_at", "is_primary", "visible_to_customer", "notes", "evidence_weight"],
        [{"ticket_id": q(tk["t01"]), "recording_id": q(rec_t01), "link_type": q("troubleshooting"),
          "linked_by": q(uid["ag1"]), "linked_at": q(t3(days=-6, hours=1, minutes=25)), "is_primary": q(True),
          "visible_to_customer": q(False), "notes": q("Attached right after the call."), "evidence_weight": q("supporting")},
         {"ticket_id": q(tk["t05"]), "recording_id": q(rec_t05), "link_type": q("rca_evidence"),
          "linked_by": q(uid["ag3"]), "linked_at": q(t3(days=-9, hours=2, minutes=45)), "is_primary": q(True),
          "visible_to_customer": q(False), "notes": q("Shows the switch fault directly — primary RCA evidence."), "evidence_weight": q("required_for_rca")},
         {"ticket_id": q(tk["t08"]), "recording_id": q(rec_t08), "link_type": q("rca_evidence"),
          "linked_by": q(uid["ag2"]), "linked_at": q(t3(days=-2, hours=3, minutes=20)), "is_primary": q(True),
          "visible_to_customer": q(False), "notes": q("Flagged sensitive — account number briefly visible on screen."), "evidence_weight": q("required_for_rca")},
         {"ticket_id": q(tk["t02"]), "recording_id": q(rec_t02), "link_type": q("rca_evidence"),
          "linked_by": q(uid["ag3"]), "linked_at": q(t3(days=-5, hours=4, minutes=40)), "is_primary": q(True),
          "visible_to_customer": q(False), "notes": q("Organizer's OneDrive link expired before archival — needs reshare."), "evidence_weight": q("required_for_rca")}],
        conflict="(ticket_id,recording_id)")

    # -- access log (realistic view/open/summary/restrict trail) --
    alog = [
        (rec_t01, uid["ag1"], "ag1", "viewed_metadata", -6*24+1),
        (rec_t01, uid["ag1"], "ag1", "opened_recording", -6*24+1),
        (rec_t01, uid["ag1"], "ag1", "generated_summary", -6*24+2),
        (rec_t05, uid["ag3"], "ag3", "opened_recording", -9*24+3),
        (rec_t05, uid["ag3"], "ag3", "generated_summary", -9*24+3),
        (rec_t05, uid["mgr"], "mgr", "viewed_transcript", -1*24),
        (rec_t08, uid["ag2"], "ag2", "viewed_metadata", -2*24+1),
        (rec_t08, uid["lead"], "lead", "changed_permissions", -2*24+2),
        (rec_t02, uid["ag3"], "ag3", "viewed_metadata", -5*24+5),
        (rec_inc, uid["mgr"], "mgr", "opened_recording", -1),
        (rec_inc, uid["mgr"], "mgr", "generated_summary", -1),
        (rec_inc, uid["lead"], "lead", "downloaded", -1, ),
    ]
    logrows = []
    for i, row in enumerate(alog):
        rid, actor, key, action, off_hours = row
        logrows.append({"id": q(K("alog:%d" % i)), "tenant_id": q(tid), "recording_id": q(rid),
                         "actor_id": q(actor), "actor_email": q("%s@%s.demo" % (key, slug)),
                         "action": q(action), "source_ip": q("10.20.%d.%d" % (i % 5, 10 + i)),
                         "request_id": q("demo-req-%s-%d" % (slug, i)), "created_at": q(t3(hours=off_hours))})
    ins("recording_access_log", ["id", "tenant_id", "recording_id", "actor_id", "actor_email", "action", "source_ip", "request_id", "created_at"], logrows)

    # ================= RCA records (governed retrospectives) =================
    rca1 = retro_a                       # completed — reuse existing "Payments API outage" retro
    rca2, rca3, rca4, rca5 = K("rca:2"), K("rca:3"), K("rca:4"), K("rca:5")

    # -- RCA-1: elevate the existing published retro into a completed, governed RCA --
    upd("incident_retrospectives",
        ["is_rca_governed=true", "source_type=" + q("incident"), "rca_number=" + q("RCA-2026-0001"),
         "severity=" + q("sev2"), "owner_id=" + q(uid["lead"]), "approver_id=" + q(uid["mgr"]),
         "team_id=" + q(t_infra), "service_id=" + q(svc_pay), "trigger_policy_id=" + q(pol_a),
         "status=" + q("completed"), "previous_status=" + q("approved"),
         "due_at=" + q(ts(days=-1, hours=5)), "submitted_at=" + q(ts(days=-3, hours=10)),
         "approved_at=" + q(ts(days=-2, hours=9)), "completed_at=" + q(ts(days=-1, hours=4)),
         "executive_summary=" + q("A configuration deploy without a canary stage took the Payments API offline for ~40 minutes; rolled back and fully recovered."),
         "customer_impact=" + q("~1,200 failed checkout attempts during the outage window; no data loss."),
         "business_impact=" + q("Moderate — estimated $18k in retried/abandoned transactions; SLA credit not triggered (within contractual outage allowance)."),
         "technical_summary=" + q("A config change disabling a feature flag was deployed directly to production. The flag gated a code path that, when disabled, caused the payment-processing worker to crash-loop on startup. No canary or staged rollout caught it before full deployment."),
         "root_cause_statement=" + q("Direct-to-production deploys bypass canary validation, allowing a bad config change to reach 100% of traffic before detection."),
         "root_cause_category=" + q("change_management"),
         "contributing_factor_tags=" + jb(["no_canary_stage", "alert_routing_delay", "missing_config_validation"]),
         "detection_gap=" + q("Alert fired 5 minutes after impact began due to a routing misconfiguration in the escalation policy."),
         "response_gap=" + q("None significant — IC was paged and rolled back within the first 6 minutes of acknowledging."),
         "prevention_plan=" + q("Add a canary deploy stage gated on error-rate + config-schema validation before full rollout."),
         "lessons_learned=" + q("Config changes need the same staged-rollout discipline as code changes."),
         "customer_facing_summary=" + q("On <date>, a subset of checkout attempts failed for approximately 40 minutes due to an internal deployment issue. The issue was identified and resolved quickly; no customer data was affected."),
         "ai_draft_status=" + q("completed"), "ai_confidence=0.78", "ai_model_version=" + q("heuristic-v1")],
        "id=" + q(rca1))
    upd("retro_action_items",
        ["title=" + q("Add canary stage to payments deploy pipeline"), "action_type=" + q("preventive"),
         "priority=" + q("high"), "owner_id=" + q(uid["ag1"]), "team_id=" + q(t_infra),
         "due_at=" + q(ts(days=-2)), "status=" + q("done"),
         "verification_method=" + q("Deployed a config-only canary stage; verified it blocks on error-rate spike in staging drill."),
         "verified_by=" + q(uid["mgr"]), "verified_at=" + q(ts(days=-1, hours=6))],
        "id=" + q(ai1))
    upd("retro_action_items",
        ["title=" + q("Tune alert routing to page IC within 60s"), "action_type=" + q("detection_improvement"),
         "priority=" + q("medium"), "owner_id=" + q(uid["ag2"]), "team_id=" + q(t_infra),
         "due_at=" + q(ts(days=-2)), "status=" + q("done"),
         "verification_method=" + q("Simulated a SEV2 page; IC notified in 42s."),
         "verified_by=" + q(uid["mgr"]), "verified_at=" + q(ts(days=-1, hours=3))],
        "id=" + q(ai2))
    ins("rca_linked_entities", ["id", "retro_id", "tenant_id", "entity_type", "entity_id", "link_role", "required", "linked_by", "linked_at"],
        [{"id": q(K("rle:1a")), "retro_id": q(rca1), "tenant_id": q(tid), "entity_type": q("incident"), "entity_id": q(inc_a), "link_role": q("source"), "required": q(True), "linked_by": q(uid["lead"]), "linked_at": q(ts(days=-3, hours=10))},
         {"id": q(K("rle:1b")), "retro_id": q(rca1), "tenant_id": q(tid), "entity_type": q("recording"), "entity_id": q(rec_inc), "link_role": q("evidence"), "required": q(True), "linked_by": q(uid["mgr"]), "linked_at": q(t3(days=-1))},
         {"id": q(K("rle:1c")), "retro_id": q(rca1), "tenant_id": q(tid), "entity_type": q("service"), "entity_id": q(svc_pay), "link_role": q("affected"), "required": q(False), "linked_by": q(uid["lead"]), "linked_at": q(ts(days=-3, hours=10))}])
    ins("rca_evidence_checklist", ["id", "retro_id", "evidence_type", "required", "status", "provided_entity_type", "provided_entity_id", "updated_at"],
        [{"id": q(K("ec1:%s" % et)), "retro_id": q(rca1), "evidence_type": q(et), "required": q(True), "status": q("provided"),
          "provided_entity_type": q("incident" if et == "primary_ticket_linked" else "recording" if "recording" in et else "note"),
          "provided_entity_id": q(inc_a) if et == "primary_ticket_linked" else (q(rec_inc) if "recording" in et else "NULL"),
          "updated_at": q(ts(days=-2, hours=9))} for et in RCA_EVIDENCE_TYPES])
    ins("rca_history", ["id", "retro_id", "tenant_id", "actor_id", "event_type", "field_changed", "old_value", "new_value", "changed_at"],
        [{"id": q(K("rh1:%d" % i)), "retro_id": q(rca1), "tenant_id": q(tid), "actor_id": q(actor), "event_type": q(ev),
          "field_changed": q("status"), "old_value": jb({"status": ov}), "new_value": jb({"status": nv}), "changed_at": q(at)}
         for i, (actor, ev, ov, nv, at) in enumerate([
             (uid["lead"], "submitted", "draft", "under_review", ts(days=-3, hours=10)),
             (uid["mgr"], "approved", "under_review", "approved", ts(days=-2, hours=9)),
             (uid["mgr"], "actions_verified", "actions_in_progress", "completed", ts(days=-1, hours=4)),
         ])])

    # -- RCA-2: t05 packet loss — actions_in_progress (1 overdue action, 1 verified) --
    ins("incident_retrospectives",
        ["id", "tenant_id", "incident_id", "summary", "status", "is_rca_governed", "source_type", "source_ticket_id",
         "rca_number", "severity", "owner_id", "approver_id", "team_id", "trigger_policy_id", "previous_status",
         "due_at", "submitted_at", "approved_at",
         "executive_summary", "customer_impact", "technical_summary", "root_cause_statement", "root_cause_category",
         "contributing_factor_tags", "detection_gap", "prevention_plan", "lessons_learned",
         "ai_draft_status", "ai_confidence", "ai_model_version", "created_by"],
        [{"id": q(rca2), "tenant_id": q(tid), "incident_id": "NULL", "summary": q("Recurring 3rd-floor packet loss traced to a failing SFP module."),
          "status": q("actions_in_progress"), "is_rca_governed": q(True), "source_type": q("ticket"), "source_ticket_id": q(tk["t05"]),
          "rca_number": q("RCA-2026-0002"), "severity": q("sev3"), "owner_id": q(uid["ag3"]), "approver_id": q(uid["mgr"]),
          "team_id": q(t_infra), "trigger_policy_id": q(pol_b), "previous_status": q("approved"),
          "due_at": q(t3(days=-4)), "submitted_at": q(t3(days=-9)), "approved_at": q(t3(days=-8)),
          "executive_summary": q("Third recurrence of packet loss on the 3rd-floor switch stack; SLA breached before root cause was found."),
          "customer_impact": q("Intermittent VoIP/video drops for ~40 staff over 4 days; two dropped customer calls reported."),
          "technical_summary": q("Packet capture during an active loss event showed a flapping uplink; SFP module on port 14 was degraded, not fully failed, so health checks didn't catch it."),
          "root_cause_statement": q("A degrading (not dead) SFP transceiver caused intermittent link flaps that standard link-up/down monitoring didn't detect."),
          "root_cause_category": q("environment"),
          "contributing_factor_tags": jb(["no_proactive_health_check", "hardware_degradation"]),
          "detection_gap": q("No signal-quality monitoring on switch uplinks — only up/down state was alerted on."),
          "prevention_plan": q("Add optical signal-strength monitoring to catch degrading transceivers before they flap."),
          "lessons_learned": q("Link up/down monitoring alone misses slow hardware degradation."),
          "ai_draft_status": q("completed"), "ai_confidence": 0.74, "ai_model_version": q("heuristic-v1"), "created_by": q(uid["mgr"])}])
    ai_2a, ai_2b = K("ai:2a"), K("ai:2b")
    ins("retro_action_items", ["id", "tenant_id", "retro_id", "description", "title", "action_type", "priority", "owner_id", "team_id", "due_at", "status", "verification_method", "verified_by", "verified_at"],
        [{"id": q(ai_2a), "tenant_id": q(tid), "retro_id": q(rca2), "description": q("Replace SFP module on switch port 14."),
          "title": q("Replace SFP module on switch port 14"), "action_type": q("corrective"), "priority": q("high"),
          "owner_id": q(uid["ag3"]), "team_id": q(t_infra), "due_at": q(t3(days=-5)), "status": q("overdue"),
          "verification_method": "NULL", "verified_by": "NULL", "verified_at": "NULL"},
         {"id": q(ai_2b), "tenant_id": q(tid), "retro_id": q(rca2), "description": q("Add optical signal-strength monitoring for switch uplinks."),
          "title": q("Add optical signal-strength monitoring for switch uplinks"), "action_type": q("monitoring"), "priority": q("medium"),
          "owner_id": q(uid["mgr"]), "team_id": q(t_infra), "due_at": q(t3(days=7)), "status": q("done"),
          "verification_method": q("Confirmed signal-strength metric now visible on the network dashboard with an alert threshold."),
          "verified_by": q(uid["mgr"]), "verified_at": q(t3(days=-1))}])
    ins("rca_linked_entities", ["id", "retro_id", "tenant_id", "entity_type", "entity_id", "link_role", "required", "linked_by", "linked_at"],
        [{"id": q(K("rle:2a")), "retro_id": q(rca2), "tenant_id": q(tid), "entity_type": q("ticket"), "entity_id": q(tk["t05"]), "link_role": q("source"), "required": q(True), "linked_by": q(uid["ag3"]), "linked_at": q(t3(days=-9))},
         {"id": q(K("rle:2b")), "retro_id": q(rca2), "tenant_id": q(tid), "entity_type": q("recording"), "entity_id": q(rec_t05), "link_role": q("evidence"), "required": q(True), "linked_by": q(uid["ag3"]), "linked_at": q(t3(days=-9))}])
    ins("rca_evidence_checklist", ["id", "retro_id", "evidence_type", "required", "status", "provided_entity_type", "provided_entity_id", "updated_at"],
        [{"id": q(K("ec2:%s" % et)), "retro_id": q(rca2), "evidence_type": q(et), "required": q(True), "status": q("provided"),
          "provided_entity_type": q("ticket" if et == "primary_ticket_linked" else "recording" if "recording" in et else "note"),
          "provided_entity_id": q(tk["t05"]) if et == "primary_ticket_linked" else (q(rec_t05) if "recording" in et else "NULL"),
          "updated_at": q(t3(days=-8))} for et in RCA_EVIDENCE_TYPES])
    ins("rca_history", ["id", "retro_id", "tenant_id", "actor_id", "event_type", "field_changed", "old_value", "new_value", "changed_at"],
        [{"id": q(K("rh2:%d" % i)), "retro_id": q(rca2), "tenant_id": q(tid), "actor_id": q(a), "event_type": q(ev), "field_changed": q("status"), "old_value": jb({"status": ov}), "new_value": jb({"status": nv}), "changed_at": q(at)}
         for i, (a, ev, ov, nv, at) in enumerate([
             (uid["ag3"], "submitted", "draft", "under_review", t3(days=-9)),
             (uid["mgr"], "approved", "under_review", "actions_in_progress", t3(days=-8)),
         ])])

    # -- RCA-3: t08 payroll slowness — under_review, 3 evidence gaps blocking approval --
    ins("incident_retrospectives",
        ["id", "tenant_id", "incident_id", "summary", "status", "is_rca_governed", "source_type", "source_ticket_id",
         "rca_number", "severity", "owner_id", "approver_id", "team_id", "trigger_policy_id", "previous_status",
         "due_at", "submitted_at", "technical_summary", "customer_impact",
         "ai_draft_status", "ai_confidence", "ai_model_version", "created_by"],
        [{"id": q(rca3), "tenant_id": q(tid), "incident_id": "NULL", "summary": q("Payroll app degraded to ~6s page loads during month-end batch; suspected query-plan regression."),
          "status": q("under_review"), "is_rca_governed": q(True), "source_type": q("ticket"), "source_ticket_id": q(tk["t08"]),
          "rca_number": q("RCA-2026-0003"), "severity": q("sev3"), "owner_id": q(uid["ag2"]), "approver_id": q(uid["lead"]),
          "team_id": q(t_sd), "trigger_policy_id": q(pol_b), "previous_status": q("draft"),
          "due_at": q(t3(days=2)), "submitted_at": q(t3(days=-1)),
          "technical_summary": q("A DB query plan for the month-end payroll batch regressed after an index was dropped in a prior maintenance window; investigation and customer notification are still in progress."),
          "customer_impact": q("Payroll processing ran ~3x slower during the month-end window; no failed pay runs, but finance team worked past their usual cutoff."),
          "ai_draft_status": q("completed"), "ai_confidence": 0.61, "ai_model_version": q("heuristic-v1"), "created_by": q(uid["ag2"])}])
    ins("rca_linked_entities", ["id", "retro_id", "tenant_id", "entity_type", "entity_id", "link_role", "required", "linked_by", "linked_at"],
        [{"id": q(K("rle:3a")), "retro_id": q(rca3), "tenant_id": q(tid), "entity_type": q("ticket"), "entity_id": q(tk["t08"]), "link_role": q("source"), "required": q(True), "linked_by": q(uid["ag2"]), "linked_at": q(t3(days=-2))},
         {"id": q(K("rle:3b")), "retro_id": q(rca3), "tenant_id": q(tid), "entity_type": q("recording"), "entity_id": q(rec_t08), "link_role": q("evidence"), "required": q(True), "linked_by": q(uid["ag2"]), "linked_at": q(t3(days=-2))}])
    _rca3_missing = {"recording_summary_reviewed", "service_asset_impact_linked", "customer_communication_captured", "corrective_actions_created", "approval_comments_present"}
    ins("rca_evidence_checklist", ["id", "retro_id", "evidence_type", "required", "status", "provided_entity_type", "provided_entity_id", "updated_at"],
        [{"id": q(K("ec3:%s" % et)), "retro_id": q(rca3), "evidence_type": q(et), "required": q(True),
          "status": q("missing" if et in _rca3_missing else "provided"),
          "provided_entity_type": ("NULL" if et in _rca3_missing else q("ticket" if et == "primary_ticket_linked" else "recording" if "recording" in et else "note")),
          "provided_entity_id": ("NULL" if et in _rca3_missing else (q(tk["t08"]) if et == "primary_ticket_linked" else (q(rec_t08) if "recording" in et else "NULL"))),
          "updated_at": q(t3(days=-1))} for et in RCA_EVIDENCE_TYPES])
    ins("rca_history", ["id", "retro_id", "tenant_id", "actor_id", "event_type", "field_changed", "old_value", "new_value", "changed_at"],
        [{"id": q(K("rh3:0")), "retro_id": q(rca3), "tenant_id": q(tid), "actor_id": q(uid["ag2"]), "event_type": q("submitted"),
          "field_changed": q("status"), "old_value": jb({"status": "draft"}), "new_value": jb({"status": "under_review"}), "changed_at": q(t3(days=-1))}])

    # -- RCA-4: t02 VPN outage — required, overdue; blocked partly by the missing/inaccessible recording --
    ins("incident_retrospectives",
        ["id", "tenant_id", "incident_id", "status", "is_rca_governed", "source_type", "source_ticket_id",
         "rca_number", "severity", "owner_id", "approver_id", "team_id", "trigger_policy_id", "previous_status",
         "due_at", "created_by"],
        [{"id": q(rca4), "tenant_id": q(tid), "incident_id": "NULL", "status": q("overdue"), "is_rca_governed": q(True),
          "source_type": q("ticket"), "source_ticket_id": q(tk["t02"]), "rca_number": q("RCA-2026-0004"),
          "severity": q("sev2"), "owner_id": q(uid["ag3"]), "approver_id": q(uid["mgr"]), "team_id": q(t_infra),
          "trigger_policy_id": q(pol_a), "previous_status": q("required"), "due_at": q(t3(days=-5)), "created_by": q(uid["mgr"])}])
    ins("rca_linked_entities", ["id", "retro_id", "tenant_id", "entity_type", "entity_id", "link_role", "required", "linked_by", "linked_at"],
        [{"id": q(K("rle:4a")), "retro_id": q(rca4), "tenant_id": q(tid), "entity_type": q("ticket"), "entity_id": q(tk["t02"]), "link_role": q("source"), "required": q(True), "linked_by": q(uid["mgr"]), "linked_at": q(t3(days=-8))},
         {"id": q(K("rle:4b")), "retro_id": q(rca4), "tenant_id": q(tid), "entity_type": q("recording"), "entity_id": q(rec_t02), "link_role": q("evidence"), "required": q(True), "linked_by": q(uid["ag3"]), "linked_at": q(t3(days=-5))}])
    ins("rca_evidence_checklist", ["id", "retro_id", "evidence_type", "required", "status", "provided_entity_type", "provided_entity_id", "updated_at"],
        [{"id": q(K("ec4:%s" % et)), "retro_id": q(rca4), "evidence_type": q(et), "required": q(True),
          "status": q("provided" if et == "primary_ticket_linked" else "missing"),
          "provided_entity_type": q("ticket") if et == "primary_ticket_linked" else "NULL",
          "provided_entity_id": q(tk["t02"]) if et == "primary_ticket_linked" else "NULL",
          "updated_at": q(t3(days=-8))} for et in RCA_EVIDENCE_TYPES])
    ins("rca_history", ["id", "retro_id", "tenant_id", "actor_id", "event_type", "field_changed", "old_value", "new_value", "changed_at"],
        [{"id": q(K("rh4:0")), "retro_id": q(rca4), "tenant_id": q(tid), "actor_id": q(uid["mgr"]), "event_type": q("required"),
          "field_changed": q("status"), "old_value": "NULL", "new_value": jb({"status": "required"}), "changed_at": q(t3(days=-8))},
         {"id": q(K("rh4:1")), "retro_id": q(rca4), "tenant_id": q(tid), "actor_id": "NULL", "event_type": q("overdue_flagged"),
          "field_changed": q("status"), "old_value": jb({"status": "required"}), "new_value": jb({"status": "overdue"}), "changed_at": q(t3(days=-5))}])

    # -- RCA-5: t09 printer jam — waived by manager as a trivial recurring hardware fault --
    ins("incident_retrospectives",
        ["id", "tenant_id", "incident_id", "status", "is_rca_governed", "source_type", "source_ticket_id",
         "rca_number", "severity", "owner_id", "approver_id", "team_id", "trigger_policy_id", "previous_status",
         "due_at", "waived_at", "waived_by", "waiver_reason", "created_by"],
        [{"id": q(rca5), "tenant_id": q(tid), "incident_id": "NULL", "status": q("waived"), "is_rca_governed": q(True),
          "source_type": q("ticket"), "source_ticket_id": q(tk["t09"]), "rca_number": q("RCA-2026-0005"),
          "severity": q("low"), "owner_id": q(uid["ag1"]), "approver_id": q(uid["mgr"]), "team_id": q(t_sd),
          "trigger_policy_id": q(pol_c), "previous_status": q("draft"), "due_at": q(t3(days=-14)),
          "waived_at": q(t3(days=-13)), "waived_by": q(uid["mgr"]),
          "waiver_reason": q("Third jam traced to the same physical tray on the 2nd-floor unit; tray was replaced during the resolved ticket. Isolated hardware fault, no systemic risk — full RCA not warranted."),
          "created_by": q(uid["mgr"])}])
    ins("rca_linked_entities", ["id", "retro_id", "tenant_id", "entity_type", "entity_id", "link_role", "required", "linked_by", "linked_at"],
        [{"id": q(K("rle:5a")), "retro_id": q(rca5), "tenant_id": q(tid), "entity_type": q("ticket"), "entity_id": q(tk["t09"]), "link_role": q("source"), "required": q(True), "linked_by": q(uid["mgr"]), "linked_at": q(t3(days=-14))}])
    _rca5_done = {"primary_ticket_linked", "customer_impact_documented", "timeline_completed"}
    ins("rca_evidence_checklist", ["id", "retro_id", "evidence_type", "required", "status", "provided_entity_type", "provided_entity_id", "waived_by", "waiver_reason", "updated_at"],
        [{"id": q(K("ec5:%s" % et)), "retro_id": q(rca5), "evidence_type": q(et), "required": q(True),
          "status": q("provided" if et in _rca5_done else "waived"),
          "provided_entity_type": q("ticket") if et == "primary_ticket_linked" else "NULL",
          "provided_entity_id": q(tk["t09"]) if et == "primary_ticket_linked" else "NULL",
          "waived_by": "NULL" if et in _rca5_done else q(uid["mgr"]),
          "waiver_reason": "NULL" if et in _rca5_done else q("Covered by the RCA-level waiver — isolated hardware fault."),
          "updated_at": q(t3(days=-13))} for et in RCA_EVIDENCE_TYPES])
    ins("rca_history", ["id", "retro_id", "tenant_id", "actor_id", "event_type", "field_changed", "old_value", "new_value", "changed_at"],
        [{"id": q(K("rh5:0")), "retro_id": q(rca5), "tenant_id": q(tid), "actor_id": q(uid["mgr"]), "event_type": q("waived"),
          "field_changed": q("status"), "old_value": jb({"status": "draft"}), "new_value": jb({"status": "waived"}), "changed_at": q(t3(days=-13))}])


emit("-- PIQ demo seed PHASE 3 (Support Recording + RCA Governance, specs/08). Idempotent.")
emit("SET app.bypass_rls = 'on';")
emit("BEGIN;")
import sys as _sys
_only = set(_sys.argv[1].split(",")) if len(_sys.argv) > 1 else None
for slug, tid in TENANTS:
    if _only and slug not in _only:
        continue
    if tid is None:
        tid = u("tenant:" + slug)
    emit("\n-- ===== TENANT %s =====" % slug)
    build3(slug, tid)
emit("COMMIT;")

import sys
sys.stdout.write("\n".join(OUT) + "\n")
