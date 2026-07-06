#!/usr/bin/env python3
"""Phase-2 demo seed for itsm_db: Phase 9 (SLO/error-budget) + remaining empty
demo-worthy entities. Re-derives Phase-1 ids via the SAME uuid5 scheme so all
FKs line up. Idempotent (ON CONFLICT DO NOTHING). Emits SQL to stdout.
"""
import uuid, json, datetime as dt

NS = uuid.uuid5(uuid.NAMESPACE_DNS, "piq-demo-seed.99t.local")
def u(key): return str(uuid.uuid5(NS, key))

NOW = dt.datetime(2026, 7, 2, 12, 0, 0)
def ts(days=0, hours=0, minutes=0):
    return (NOW + dt.timedelta(days=days, hours=hours, minutes=minutes)).isoformat()
def day(days=0):
    return (NOW + dt.timedelta(days=days)).date().isoformat()
def midnight(days=0):
    d = (NOW + dt.timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)
    return d.isoformat()
def floor5(dtime=None):
    d = dtime or NOW
    return d.replace(second=0, microsecond=0, minute=(d.minute // 5) * 5).isoformat()

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
def uarr(ids): return "ARRAY[%s]::uuid[]" % (",".join("'%s'" % i for i in ids)) if ids else "ARRAY[]::uuid[]"
def jb(d): return "%s::jsonb" % q(json.dumps(d))
def ins(table, cols, rows, conflict="(id)"):
    if not rows: return
    vals = ["(" + ",".join(str(r[c.strip('\"')]) for c in cols) + ")" for r in rows]
    tgt = "ON CONFLICT %s DO NOTHING" % conflict if conflict else ""
    emit("INSERT INTO %s (%s) VALUES\n%s\n%s;" % (table, ",".join(cols), ",\n".join(vals), tgt))


def build2(slug, tid):
    P = lambda s: "%s:%s" % (slug, s)
    # ---- re-derive Phase-1 ids ----
    uid = {k: u(P("user:" + k)) for k in ("mgr", "lead", "ag1", "ag2", "ag3", "eu1", "eu2", "eu3")}
    svc_pay, svc_web = u(P("svc:pay")), u(P("svc:web"))
    sch = u(P("sch:primary"))
    tk = {k: u(P("tk:" + k)) for k in ("t01","t02","t04","t05","t07","t10")}
    inc_a = u(P("inc:a"))
    kb = {k: u(P("kb:" + k)) for k in ("a1","a2","a3","a4")}
    kbt = {t: u(P("kbt:" + t)) for t in ("vpn","email","printer")}
    tgt_std_res, tgt_ola_mit = u(P("tgt:std:res")), u(P("tgt:ola:mit"))
    si = {k: u(P("si:" + k)) for k in ("t01","t02","t04","t05","t08")}
    sev2 = u(P("sev:2"))
    dept_it = u(P("dept:it"))

    K = lambda s: u(P("p2:" + s))  # phase-2 key namespace

    # ================= PHASE 9 — SLI/SLO/error-budget =================
    src = K("sli:uptime")
    ins("sli_sources", ["id","tenant_id","name","type","config","is_active"],
        [{"id":q(src),"tenant_id":q(tid),"name":q("Internal uptime"),"type":q("internal_metric"),
          "config":jb({"metric":"uptime"}),"is_active":q(True)}])

    slo_pay, slo_web = K("slo:pay"), K("slo:web")
    ins("slo_objectives", ["id","tenant_id","service_id","sli_source_id","name","objective_type","target_pct",'"window"',"is_active"],
        [{"id":q(slo_pay),"tenant_id":q(tid),"service_id":q(svc_pay),"sli_source_id":q(src),
          "name":q("Payments API availability"),"objective_type":q("availability"),"target_pct":99.9,"window":q("rolling_28d"),"is_active":q(True)},
         {"id":q(slo_web),"tenant_id":q(tid),"service_id":q(svc_web),"sli_source_id":q(src),
          "name":q("Web Platform availability"),"objective_type":q("availability"),"target_pct":99.5,"window":q("rolling_28d"),"is_active":q(True)}])

    # measurements: 28 daily buckets (1440 min/day). pay = meeting (~59% budget), web = at risk (over budget)
    mrows = []
    for n in range(28, 0, -1):
        good_pay = 1416 if n == 3 else 1440           # one bad day → 24 bad mins
        good_web = 1310 if n in (1, 2) else 1440       # two bad days → 260 bad mins
        mrows.append({"id":q(K("m:pay:%d"%n)),"slo_id":q(slo_pay),"bucket_start":q(midnight(-n)),"good_count":good_pay,"total_count":1440})
        mrows.append({"id":q(K("m:web:%d"%n)),"slo_id":q(slo_web),"bucket_start":q(midnight(-n)),"good_count":good_web,"total_count":1440})
    # a recent 5-min bucket so burn_rate_1h has data (web currently burning ~4x)
    mrows.append({"id":q(K("m:pay:now")),"slo_id":q(slo_pay),"bucket_start":q(floor5()),"good_count":300,"total_count":300})
    mrows.append({"id":q(K("m:web:now")),"slo_id":q(slo_web),"bucket_start":q(floor5()),"good_count":294,"total_count":300})
    ins("slo_measurements", ["id","slo_id","bucket_start","good_count","total_count"], mrows)

    ins("slo_burn_alerts", ["id","tenant_id","slo_id","kind","short_window_min","long_window_min","burn_threshold","state"],
        [{"id":q(K("ba:pay:fast")),"tenant_id":q(tid),"slo_id":q(slo_pay),"kind":q("fast_burn"),"short_window_min":5,"long_window_min":60,"burn_threshold":14.4,"state":q("ok")},
         {"id":q(K("ba:pay:slow")),"tenant_id":q(tid),"slo_id":q(slo_pay),"kind":q("slow_burn"),"short_window_min":30,"long_window_min":360,"burn_threshold":6.0,"state":q("ok")},
         {"id":q(K("ba:web:fast")),"tenant_id":q(tid),"slo_id":q(slo_web),"kind":q("fast_burn"),"short_window_min":5,"long_window_min":60,"burn_threshold":14.4,"state":q("ok")}])

    # ================= remaining demo-worthy entities =================
    # -- user → department assignments --
    ins("user_department_assignments", ["user_id","department_id","is_primary"],
        [{"user_id":q(uid[k]),"department_id":q(dept_it),"is_primary":q(True)} for k in uid],
        conflict="(user_id,department_id)")

    # -- SLA underpinning: OLA mitigate underpins the SLA resolution target --
    ins("sla_underpinning", ["id","parent_target_id","support_target_id"],
        [{"id":q(K("up:1")),"parent_target_id":q(tgt_std_res),"support_target_id":q(tgt_ola_mit)}])

    # -- AI SLA breach predictions --
    ins("ai_sla_predictions", ["id","tenant_id","ticket_id","instance_id","breach_risk","reason","model_version","actual_breached"],
        [{"id":q(K("aisla:1")),"tenant_id":q(tid),"ticket_id":q(tk["t02"]),"instance_id":q(si["t02"]),"breach_risk":0.82,
          "reason":q("Critical priority, 68% of budget consumed, no first response yet."),"model_version":q("heuristic-v1"),"actual_breached":"NULL"},
         {"id":q(K("aisla:2")),"tenant_id":q(tid),"ticket_id":q(tk["t05"]),"instance_id":q(si["t05"]),"breach_risk":0.95,
          "reason":q("Resolution clock already exceeded; breached."),"model_version":q("heuristic-v1"),"actual_breached":q(True)}])

    # -- SLA metrics daily (last 7 days) --
    mdrows = []
    for n in range(7, 0, -1):
        opened = 6 + (n % 3); breached = 1 if n in (4, 6) else 0; met = opened - breached
        mdrows.append({"id":q(K("md:%d"%n)),"tenant_id":q(tid),"date":q(day(-n)),"dimension":jb({}),
            "opened_count":opened,"met_count":met,"breached_count":breached,"total_count":opened,
            "p50_resolve_min":180,"p90_resolve_min":420,"p95_resolve_min":540,"p99_resolve_min":690})
    ins("sla_metrics_daily", ["id","tenant_id","date","dimension","opened_count","met_count","breached_count","total_count","p50_resolve_min","p90_resolve_min","p95_resolve_min","p99_resolve_min"], mdrows)

    # -- notifications + preferences --
    nrows = [
        ("n1","eu1","ticket_updated","Ticket updated","Agent replied to 'Laptop won't boot after update'.","ticket",tk["t01"],False),
        ("n2","ag1","ticket_assigned","Ticket assigned to you","'Printer on 2nd floor jamming' was assigned to you.","ticket",tk["t04"],True),
        ("n3","ag3","ticket_sla_warning","SLA at risk","'Office VPN down' is at 75% of its resolution SLA.","ticket",tk["t02"],False),
        ("n4","mgr","ticket_sla_breached","SLA breached","'Intermittent packet loss on 3rd floor' breached its SLA.","ticket",tk["t05"],False),
        ("n5","eu2","kb_article_published","New help article","'Reset your email password' was published.","kb_article",kb["a2"],True),
        ("n6","lead","mention","You were mentioned","You were mentioned on the CRM upgrade change request.","ticket",tk["t07"],False),
    ]
    ins("notifications", ["id","tenant_id","user_id","type","title","body","entity_type","entity_id","is_read"],
        [{"id":q(K("notif:"+k)),"tenant_id":q(tid),"user_id":q(uid[usr]),"type":q(typ),"title":q(t),"body":q(b),
          "entity_type":q(et),"entity_id":q(eid),"is_read":q(rd)} for k,usr,typ,t,b,et,eid,rd in nrows])
    ins("notification_preferences", ["user_id","tenant_id","type","email_enabled","in_app_enabled"],
        [{"user_id":q(uid["mgr"]),"tenant_id":q(tid),"type":q("ticket_sla_breached"),"email_enabled":q(True),"in_app_enabled":q(True)},
         {"user_id":q(uid["ag1"]),"tenant_id":q(tid),"type":q("ticket_assigned"),"email_enabled":q(False),"in_app_enabled":q(True)}],
        conflict="(user_id,type)")

    # -- maintenance window (upcoming, suppresses alerts on web) --
    ins("maintenance_windows", ["id","tenant_id","title","service_ids","start_at","end_at","suppress_alerts","created_by"],
        [{"id":q(K("mw:1")),"tenant_id":q(tid),"title":q("Web Platform DB upgrade"),"service_ids":uarr([svc_web]),
          "start_at":q(ts(days=3)),"end_at":q(ts(days=3,hours=2)),"suppress_alerts":q(True),"created_by":q(uid["mgr"])}])

    # -- status page + subscriptions --
    ins("status_page_config", ["id","tenant_id","slug","is_public","branding"],
        [{"id":q(K("sp:1")),"tenant_id":q(tid),"slug":q(slug+"-status"),"is_public":q(True),
          "branding":jb({"title":slug.title()+" Status","primary":"#0f766e"})}])
    ins("status_page_subscriptions", ["id","tenant_id","channel","value","service_ids"],
        [{"id":q(K("sps:1")),"tenant_id":q(tid),"channel":q("email"),"value":q("ops-updates@%s.demo"%slug),"service_ids":uarr([svc_pay,svc_web])},
         {"id":q(K("sps:2")),"tenant_id":q(tid),"channel":q("email"),"value":q("status-watch@%s.demo"%slug),"service_ids":"NULL"}])

    # -- workflow (auto-notify on incident declared) --
    ins("workflows", ["id","tenant_id","name","trigger","conditions","actions","is_active"],
        [{"id":q(K("wf:1")),"tenant_id":q(tid),"name":q("Notify leadership on SEV1"),"trigger":q("incident_declared"),
          "conditions":jb({"severity":"SEV1"}),"actions":jb([{"type":"post_incident_status_update","audience":"stakeholder","body":"Leadership notified; response underway."}]),"is_active":q(True)}])

    # -- schedule override (ag3 covers next 2 days) --
    ins("schedule_overrides", ["id","schedule_id","user_id","start_at","end_at","origin","created_by"],
        [{"id":q(K("so:1")),"schedule_id":q(sch),"user_id":q(uid["ag3"]),"start_at":q(ts(days=1)),"end_at":q(ts(days=3)),"origin":q("manual"),"created_by":q(uid["mgr"])}])

    # -- alert routing rule + heartbeat --
    ins("alert_routing_rules", ["id","tenant_id","position","conditions","service_id","severity_id"],
        [{"id":q(K("arr:1")),"tenant_id":q(tid),"position":1,"conditions":jb({"source":"monitor"}),"service_id":q(svc_pay),"severity_id":q(sev2)}])
    ins("heartbeats", ["id","tenant_id","service_id","name","interval_sec","last_ping_at","ping_token"],
        [{"id":q(K("hb:1")),"tenant_id":q(tid),"service_id":q(svc_pay),"name":q("Payments nightly batch"),"interval_sec":300,
          "last_ping_at":q(ts(hours=-1)),"ping_token":q("demo-%s-hb1"%slug)}])

    # -- KB feedback + tag assignments + ticket→KB links --
    ins("kb_article_feedback", ["id","article_id","user_id","is_helpful","comment"],
        [{"id":q(K("kbf:1")),"article_id":q(kb["a1"]),"user_id":q(uid["eu1"]),"is_helpful":q(True),"comment":q("Clear steps, connected first try.")},
         {"id":q(K("kbf:2")),"article_id":q(kb["a2"]),"user_id":q(uid["eu2"]),"is_helpful":q(True),"comment":"NULL"},
         {"id":q(K("kbf:3")),"article_id":q(kb["a3"]),"user_id":q(uid["eu3"]),"is_helpful":q(False),"comment":q("Tray 2 didn't apply to my model.")}])
    ins("kb_article_tag_assignments", ["article_id","tag_id"],
        [{"article_id":q(kb["a1"]),"tag_id":q(kbt["vpn"])},{"article_id":q(kb["a2"]),"tag_id":q(kbt["email"])},{"article_id":q(kb["a3"]),"tag_id":q(kbt["printer"])}],
        conflict="(article_id,tag_id)")
    ins("ticket_kb_links", ["ticket_id","article_id","linked_by","is_suggested"],
        [{"ticket_id":q(tk["t10"]),"article_id":q(kb["a1"]),"linked_by":q(uid["ag2"]),"is_suggested":q(False)},
         {"ticket_id":q(tk["t04"]),"article_id":q(kb["a4"]),"linked_by":"NULL","is_suggested":q(True)}],
        conflict="(ticket_id,article_id)")

    # -- ticket approval (t07 pending_approval) + escalation (t02) --
    ins("ticket_approvals", ["id","ticket_id","requested_by","approver_id","status","comment"],
        [{"id":q(K("appr:1")),"ticket_id":q(tk["t07"]),"requested_by":q(uid["lead"]),"approver_id":q(uid["mgr"]),"status":q("pending"),"comment":q("CRM v12 upgrade — needs change-manager sign-off.")}])
    ins("ticket_escalations", ["id","ticket_id","escalated_by","escalated_to","reason"],
        [{"id":q(K("esc:1")),"ticket_id":q(tk["t02"]),"escalated_by":q(uid["ag3"]),"escalated_to":q(uid["mgr"]),"reason":q("Core VPN concentrator unreachable; needs infra lead.")}])


emit("-- PIQ demo seed PHASE 2 (Phase 9 SLO + remaining entities). Idempotent.")
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
    build2(slug, tid)
emit("COMMIT;")

import sys
sys.stdout.write("\n".join(OUT) + "\n")
