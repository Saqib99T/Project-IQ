#!/usr/bin/env python3
"""Generate idempotent demo-seed SQL for itsm_db (3 tenants).

Emits SQL to stdout. Deterministic uuid5 PKs + ON CONFLICT (id) DO NOTHING make
re-runs safe. Run as the table owner (itsm_user) so RLS is bypassed; we also
SET app.bypass_rls='on' at the top as a belt-and-braces for FORCE-RLS tables.

Modules covered: Identity (users/roles/teams/departments), Ticketing
(categories/tags/tickets/comments/history/tags/SLA instances+events), SLM
(agreements/targets/rules/coverage), On-Call (services/severities/schedules/
layers/escalation policies+steps/contact methods), Alerting (alerts), Incidents
(+roles/timeline/status-updates/retrospective/action-items), KB (spaces/
categories/tags/articles), Assets/CMDB (categories/types/vendors/assets/rels).
"""
import uuid, json, datetime as dt

NS = uuid.uuid5(uuid.NAMESPACE_DNS, "piq-demo-seed.99t.local")
def u(key): return str(uuid.uuid5(NS, key))

NOW = dt.datetime(2026, 7, 2, 12, 0, 0)
def ts(days=0, hours=0, minutes=0):
    return (NOW + dt.timedelta(days=days, hours=hours, minutes=minutes)).isoformat()

# --- system role ids (tenant_id NULL, is_system) ---
ROLE = {
    "admin": "43ebb1f9-78ce-4830-8b6f-72fcf7a091e7",
    "agent": "1da49bee-2bfc-4c49-92f8-4819fe966f5b",
    "end_user": "52dd610c-24f8-47ed-8b6a-84181200955b",
    "manager": "302afd7f-8c70-47e3-96f7-f2942652f8f3",
    "team_lead": "e16363a0-d237-4b7d-b19d-305a7d85afa6",
}

TENANTS = [
    # (slug, tenant_id or None-> generate, iam_org_id, display name, create_tenant?)
    ("blue", "06a270ba-09fc-7752-8000-0b10a0c66562", "5f75b273-7b21-4877-8c49-79408ba094e1", "Blue Team", False),
    ("piq",  "7862dc84-72d6-40a9-b2b1-c7c7896bc148", "c05f6ddc-8433-4ae1-aea2-2a1b1785599f", "PIQ-Client", False),
    ("acme", None,                                   "demo-acme-org",                        "Acme Corp", True),
]

OUT = []
def emit(sql): OUT.append(sql)

# ---- value formatting helpers -------------------------------------------------
def q(v):
    if v is None: return "NULL"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return str(v)
    if isinstance(v, dt.date) and not isinstance(v, dt.datetime): return "'%s'" % v.isoformat()
    return "'" + str(v).replace("'", "''") + "'"
def uarr(ids): return "ARRAY[%s]::uuid[]" % (",".join("'%s'" % i for i in ids)) if ids else "ARRAY[]::uuid[]"
def iarr(xs): return "ARRAY[%s]" % (",".join(str(x) for x in xs)) if xs else "ARRAY[]::integer[]"
def tarr(xs): return "ARRAY[%s]::varchar[]" % (",".join(q(x) for x in xs)) if xs else "NULL"
def jb(d): return "%s::jsonb" % q(json.dumps(d))

def ins(table, cols, rows, conflict="(id)"):
    """rows: list of dict. Emits multi-row INSERT ... ON CONFLICT DO NOTHING."""
    if not rows: return
    collist = ",".join(cols)
    vals = []
    for r in rows:
        vals.append("(" + ",".join(str(r[c]) for c in cols) + ")")
    tgt = "ON CONFLICT %s DO NOTHING" % conflict if conflict else ""
    emit("INSERT INTO %s (%s) VALUES\n%s\n%s;" % (table, collist, ",\n".join(vals), tgt))

def build_tenant(slug, tid, org_id, name, create_tenant):
    P = lambda s: "%s:%s" % (slug, s)  # key prefix

    # -- tenant (only Acme) --
    if create_tenant:
        ins("tenants", ["id","iam_org_id","name","slug","is_active","settings"],
            [{"id": q(tid), "iam_org_id": q(org_id), "name": q(name), "slug": q(slug+"-corp"),
              "is_active": q(True), "settings": jb({"seed": "piq-demo"})}])

    # -- users: mgr, lead, 3 agents, 3 end users --
    people = [
        ("mgr",  "manager",   "Morgan",  "Avery",   "manager"),
        ("lead", "team_lead", "Riley",   "Chen",    "team_lead"),
        ("ag1",  "agent",     "Jordan",  "Patel",   "agent"),
        ("ag2",  "agent",     "Sam",     "Nguyen",  "agent"),
        ("ag3",  "agent",     "Taylor",  "Okafor",  "agent"),
        ("eu1",  "end_user",  "Casey",   "Brooks",  "end_user"),
        ("eu2",  "end_user",  "Devin",   "Flores",  "end_user"),
        ("eu3",  "end_user",  "Alex",    "Romano",  "end_user"),
    ]
    uid = {k: u(P("user:"+k)) for k,_,_,_,_ in people}
    urows, rrows = [], []
    for k, role, fn, ln, _ in people:
        email = "%s.%s@%s.demo" % (fn.lower(), ln.lower(), slug)
        urows.append({"id": q(uid[k]), "iam_user_id": q("demo-%s-%s" % (slug, k)),
            "tenant_id": q(tid), "email": q(email), "first_name": q(fn), "last_name": q(ln),
            "is_active": q(True), "metadata": jb({"seed":"piq-demo"}),
            "iam_roles": jb([role]), "last_seen_at": q(ts(days=-1))})
        rrows.append({"user_id": q(uid[k]), "role_id": q(ROLE[role]), "tenant_id": q(tid)})
    ins("users", ["id","iam_user_id","tenant_id","email","first_name","last_name","is_active","metadata","iam_roles","last_seen_at"], urows)
    ins("user_itsm_roles", ["user_id","role_id","tenant_id"], rrows, conflict="(user_id,role_id)")

    # -- departments --
    dep_it, dep_ops = u(P("dept:it")), u(P("dept:ops"))
    ins("departments", ["id","tenant_id","name","description","is_active"],
        [{"id":q(dep_it),"tenant_id":q(tid),"name":q("IT"),"description":q("Information Technology"),"is_active":q(True)},
         {"id":q(dep_ops),"tenant_id":q(tid),"name":q("Operations"),"description":q("Business Operations"),"is_active":q(True)}])

    # -- teams + members --
    t_sd, t_infra = u(P("team:sd")), u(P("team:infra"))
    ins("teams", ["id","tenant_id","name","description","lead_id"],
        [{"id":q(t_sd),"tenant_id":q(tid),"name":q("Service Desk"),"description":q("First-line support"),"lead_id":q(uid["lead"])},
         {"id":q(t_infra),"tenant_id":q(tid),"name":q("Infrastructure"),"description":q("Servers, network & cloud"),"lead_id":q(uid["mgr"])}])
    tm = [(t_sd,"ag1"),(t_sd,"ag2"),(t_sd,"lead"),(t_infra,"ag3"),(t_infra,"mgr")]
    ins("team_members", ["team_id","user_id"], [{"team_id":q(t),"user_id":q(uid[k])} for t,k in tm], conflict="(team_id,user_id)")

    # -- coverage windows --
    cw_247, cw_biz = u(P("cw:247")), u(P("cw:biz"))
    biz_windows = [{"day":d,"start":"09:00","end":"18:00"} for d in (1,2,3,4,5)]
    ins("coverage_windows", ["id","tenant_id","name","timezone","is_247","work_days","windows"],
        [{"id":q(cw_247),"tenant_id":q(tid),"name":q("24x7"),"timezone":q("UTC"),"is_247":q(True),"work_days":iarr([1,2,3,4,5,6,7]),"windows":"NULL"},
         {"id":q(cw_biz),"tenant_id":q(tid),"name":q("Business Hours (Mon-Fri 9-6)"),"timezone":q("UTC"),"is_247":q(False),"work_days":iarr([1,2,3,4,5]),"windows":jb(biz_windows)}])

    # -- SLA agreements + targets + rules --
    a_std, a_prem, a_ola = u(P("agr:std")), u(P("agr:prem")), u(P("agr:ola"))
    ins("sla_agreements", ["id","tenant_id","name","kind","description","owner_team_id","is_active"],
        [{"id":q(a_std),"tenant_id":q(tid),"name":q("Standard Support SLA"),"kind":q("sla"),"description":q("Default customer SLA"),"owner_team_id":q(t_sd),"is_active":q(True)},
         {"id":q(a_prem),"tenant_id":q(tid),"name":q("Premium SLA"),"kind":q("sla"),"description":q("Priority customers"),"owner_team_id":q(t_sd),"is_active":q(True)},
         {"id":q(a_ola),"tenant_id":q(tid),"name":q("Infrastructure OLA"),"kind":q("ola"),"description":q("Internal infra underpinning"),"owner_team_id":q(t_infra),"is_active":q(True)}])
    tgt_std_fr = u(P("tgt:std:fr")); tgt_std_res = u(P("tgt:std:res"))
    tgt_prem_fr = u(P("tgt:prem:fr")); tgt_prem_res = u(P("tgt:prem:res"))
    tgt_ola_mit = u(P("tgt:ola:mit"))
    ins("sla_targets", ["id","tenant_id","agreement_id","metric","duration_minutes","coverage_window_id","applies_priority","warn_thresholds_pct"],
        [{"id":q(tgt_std_fr),"tenant_id":q(tid),"agreement_id":q(a_std),"metric":q("first_response"),"duration_minutes":60,"coverage_window_id":q(cw_biz),"applies_priority":q("high"),"warn_thresholds_pct":iarr([50,75,90])},
         {"id":q(tgt_std_res),"tenant_id":q(tid),"agreement_id":q(a_std),"metric":q("resolution"),"duration_minutes":480,"coverage_window_id":q(cw_biz),"applies_priority":"NULL","warn_thresholds_pct":iarr([50,75,90])},
         {"id":q(tgt_prem_fr),"tenant_id":q(tid),"agreement_id":q(a_prem),"metric":q("first_response"),"duration_minutes":15,"coverage_window_id":q(cw_247),"applies_priority":q("critical"),"warn_thresholds_pct":iarr([50,75,90])},
         {"id":q(tgt_prem_res),"tenant_id":q(tid),"agreement_id":q(a_prem),"metric":q("resolution"),"duration_minutes":240,"coverage_window_id":q(cw_247),"applies_priority":"NULL","warn_thresholds_pct":iarr([50,75,90])},
         {"id":q(tgt_ola_mit),"tenant_id":q(tid),"agreement_id":q(a_ola),"metric":q("time_to_mitigate"),"duration_minutes":120,"coverage_window_id":q(cw_247),"applies_priority":"NULL","warn_thresholds_pct":iarr([50,90])}])
    ins("sla_rules", ["id","tenant_id","position","conditions","agreement_id","is_active"],
        [{"id":q(u(P("rule:prem"))),"tenant_id":q(tid),"position":1,"conditions":jb({"priority":["critical"]}),"agreement_id":q(a_prem),"is_active":q(True)},
         {"id":q(u(P("rule:std"))),"tenant_id":q(tid),"position":2,"conditions":jb({}),"agreement_id":q(a_std),"is_active":q(True)}])

    # -- ticket categories + tags --
    cats = {"hw":"Hardware","sw":"Software","net":"Network","acc":"Access Request"}
    cid = {k:u(P("cat:"+k)) for k in cats}
    ins("ticket_categories", ["id","tenant_id","name","is_active","default_team_id"],
        [{"id":q(cid[k]),"tenant_id":q(tid),"name":q(v),"is_active":q(True),"default_team_id":q(t_sd if k!="net" else t_infra)} for k,v in cats.items()])
    tags = {"vip":"#e11d48","recurring":"#f59e0b","hardware":"#3b82f6","urgent":"#dc2626"}
    tgid = {k:u(P("tag:"+k)) for k in tags}
    ins("ticket_tags", ["id","tenant_id","name","color"],
        [{"id":q(tgid[k]),"tenant_id":q(tid),"name":q(k),"color":q(v)} for k,v in tags.items()],
        conflict="(tenant_id,name)")

    # -- tickets (varied) --
    tk_specs = [
        # key, type, status, prio, cat, requester, assignee, team, title, age_days, resolved?
        ("t01","incident","in_progress","high","hw","eu1","ag1",t_sd,"Laptop won't boot after update",2,False),
        ("t02","incident","open","critical","net","eu2","ag3",t_infra,"Office VPN down for remote staff",0,False),
        ("t03","service_request","open","medium","acc","eu3","ag2",t_sd,"New starter access to shared drive",1,False),
        ("t04","incident","resolved","medium","sw","eu1","ag1",t_sd,"Outlook crashes when opening calendar",6,True),
        ("t05","problem","in_progress","high","net","eu2","ag3",t_infra,"Intermittent packet loss on 3rd floor",4,False),
        ("t06","service_request","closed","low","hw","eu3","ag2",t_sd,"Request second monitor",9,True),
        ("t07","change","pending_approval","medium","sw","lead","mgr",t_infra,"Upgrade CRM to v12 (change request)",3,False),
        ("t08","incident","pending","high","sw","eu1","ag2",t_sd,"Payroll app slow at month end",1,False),
        ("t09","incident","resolved","low","hw","eu2","ag1",t_sd,"Printer on 2nd floor jamming",7,True),
        ("t10","service_request","open","medium","acc","eu3","ag2",t_sd,"VPN access for contractor",0,False),
    ]
    global TICKET_NO
    trows = []; tmap = {}
    for k,typ,st,pr,cat,req,asg,team,title,age,resolved in tk_specs:
        tkid = u(P("tk:"+k)); tmap[k]=tkid
        TICKET_NO += 1
        num = "%05d" % (90000 + TICKET_NO)
        created = ts(days=-age)
        res_at = q(ts(days=-age, hours=5)) if resolved else "NULL"
        closed_at = q(ts(days=-age, hours=6)) if st=="closed" else "NULL"
        trows.append({"id":q(tkid),"ticket_number":q(num),"tenant_id":q(tid),
            "department_id":q(dep_it),"type":q(typ),"status":q(st),"priority":q(pr),
            "title":q(title),"description":q(title+". Reported by user; see comments for detail."),
            "requester_id":q(uid[req]),"assignee_id":q(uid[asg]),"team_id":q(team),
            "category_id":q(cid[cat]),
            "sla_response_due":q(ts(days=-age,hours=1)),"sla_resolve_due":q(ts(days=-age,hours=8)),
            "sla_breached":q(age>=7 and not resolved),
            "resolved_at":res_at,"closed_at":closed_at,"created_at":q(created),"metadata":jb({"seed":"piq-demo"})})
    ins("tickets", ["id","ticket_number","tenant_id","department_id","type","status","priority","title","description","requester_id","assignee_id","team_id","category_id","sla_response_due","sla_resolve_due","sla_breached","resolved_at","closed_at","created_at","metadata"], trows)

    # comments + history + tag assignments
    crows = []
    comment_specs = [
        ("t01","ag1","Confirmed the device is stuck on the update screen. Trying safe boot.",True),
        ("t01","eu1","Thanks, let me know if you need me to bring it in.",False),
        ("t02","ag3","Escalating to infra — core VPN concentrator is unreachable.",True),
        ("t04","ag1","Rebuilt the Outlook profile; calendar opens normally now.",False),
        ("t05","ag3","Captured pcap; suspecting a faulty switch port. Investigating.",True),
        ("t08","ag2","Reproduced the slowness; DB query plan regressed. Looping in infra.",True),
    ]
    for k,au,body,internal in comment_specs:
        crows.append({"id":q(u(P("cm:%s:%s"%(k,au)))),"ticket_id":q(tmap[k]),"author_id":q(uid[au]),
            "body":q(body),"is_internal":q(internal),"created_at":q(ts(days=-1))})
    ins("ticket_comments", ["id","ticket_id","author_id","body","is_internal","created_at"], crows)

    hrows = []
    for k in ("t01","t04","t05","t09"):
        hrows.append({"id":q(u(P("hist:%s"%k))),"ticket_id":q(tmap[k]),"actor_id":q(uid["ag1"]),
            "field_changed":q("status"),"old_value":jb({"status":"open"}),"new_value":jb({"status":"in_progress"}),"changed_at":q(ts(days=-1))})
    ins("ticket_history", ["id","ticket_id","actor_id","field_changed","old_value","new_value","changed_at"], hrows)

    tarows = [("t01","hardware"),("t01","urgent"),("t02","urgent"),("t08","vip"),("t09","recurring"),("t05","recurring")]
    ins("ticket_tag_assignments", ["ticket_id","tag_id"],
        [{"ticket_id":q(tmap[k]),"tag_id":q(tgid[t])} for k,t in tarows], conflict="(ticket_id,tag_id)")

    # watchers
    ins("ticket_watchers", ["ticket_id","user_id"],
        [{"ticket_id":q(tmap["t02"]),"user_id":q(uid["mgr"])},{"ticket_id":q(tmap["t07"]),"user_id":q(uid["mgr"])}],
        conflict="(ticket_id,user_id)")

    # -- SLA instances + events (link a few tickets to targets) --
    si_specs = [("t01",tgt_std_res,"running",480,None),("t02",tgt_prem_res,"running",240,None),
                ("t04",tgt_std_res,"met",480,-6),("t05",tgt_std_res,"breached",480,-4),("t08",tgt_std_fr,"running",60,None)]
    sirows=[]; simap={}
    for k,tg,stt,dur,brk in si_specs:
        siid=u(P("si:"+k)); simap[k]=siid
        breached = q(ts(days=brk,hours=9)) if stt=="breached" and brk is not None else "NULL"
        sirows.append({"id":q(siid),"tenant_id":q(tid),"ticket_id":q(tmap[k]),"target_id":q(tg),
            "due_at":q(ts(days=(brk or 0),hours=8)),"status":q(stt),"breached_at":breached,
            "warned_pct":iarr([50,75] if stt in("breached","running") else []),"created_at":q(ts(days=-3))})
    ins("sla_instances", ["id","tenant_id","ticket_id","target_id","due_at","status","breached_at","warned_pct","created_at"], sirows)
    evrows=[]
    for k in simap:
        evrows.append({"id":q(u(P("ev:%s:start"%k))),"instance_id":q(simap[k]),"event":q("started")})
        evrows.append({"id":q(u(P("ev:%s:warn"%k))),"instance_id":q(simap[k]),"event":q("warned")})
    ins("sla_events", ["id","instance_id","event"], evrows)

    # -- On-Call: severities, schedule+layer, escalation policy+steps, services, contacts --
    sev1,sev2,sev3 = u(P("sev:1")),u(P("sev:2")),u(P("sev:3"))
    ins("severity_levels", ["id","tenant_id","name","rank","auto_page","required_roles"],
        [{"id":q(sev1),"tenant_id":q(tid),"name":q("SEV1"),"rank":1,"auto_page":q(True),"required_roles":tarr(["ic","comms"])},
         {"id":q(sev2),"tenant_id":q(tid),"name":q("SEV2"),"rank":2,"auto_page":q(True),"required_roles":tarr(["ic"])},
         {"id":q(sev3),"tenant_id":q(tid),"name":q("SEV3"),"rank":3,"auto_page":q(False),"required_roles":"NULL"}])
    sch = u(P("sch:primary"))
    ins("schedules", ["id","tenant_id","name","team_id","timezone","rotation_type","rotation_length_hours","handoff_time","start_at","is_active"],
        [{"id":q(sch),"tenant_id":q(tid),"name":q("Primary On-Call Rotation"),"team_id":q(t_infra),"timezone":q("UTC"),
          "rotation_type":q("weekly"),"rotation_length_hours":168,"handoff_time":q("10:00"),"start_at":q(ts(days=-14)),"is_active":q(True)}])
    ins("schedule_layers", ["id","schedule_id","layer_rank","participants"],
        [{"id":q(u(P("layer:1"))),"schedule_id":q(sch),"layer_rank":1,"participants":uarr([uid["ag1"],uid["ag2"],uid["ag3"]])}])
    pol = u(P("pol:primary"))
    ins("escalation_policies", ["id","tenant_id","name","repeat_count"],
        [{"id":q(pol),"tenant_id":q(tid),"name":q("Primary Escalation"),"repeat_count":1}])
    ins("escalation_steps", ["id","policy_id","position","target_type","target_id","timeout_minutes","notify_strategy"],
        [{"id":q(u(P("step:1"))),"policy_id":q(pol),"position":1,"target_type":q("schedule"),"target_id":q(sch),"timeout_minutes":15,"notify_strategy":q("current_oncall")},
         {"id":q(u(P("step:2"))),"policy_id":q(pol),"position":2,"target_type":q("user"),"target_id":q(uid["mgr"]),"timeout_minutes":30,"notify_strategy":q("notify_all")}])
    svc_pay,svc_web = u(P("svc:pay")),u(P("svc:web"))
    ins("oncall_services", ["id","tenant_id","name","description","escalation_policy_id","current_state","is_active"],
        [{"id":q(svc_pay),"tenant_id":q(tid),"name":q("Payments API"),"description":q("Customer billing & payments"),"escalation_policy_id":q(pol),"current_state":q("operational"),"is_active":q(True)},
         {"id":q(svc_web),"tenant_id":q(tid),"name":q("Web Platform"),"description":q("Public web & portal"),"escalation_policy_id":q(pol),"current_state":q("operational"),"is_active":q(True)}])
    cmrows=[]
    for k in ("mgr","ag1","ag2","ag3"):
        email = None
        cmrows.append({"id":q(u(P("cm-email:"+k))),"tenant_id":q(tid),"user_id":q(uid[k]),"type":q("email"),"value":q("%s@%s.demo"%(k,slug)),"is_verified":q(True)})
    cmrows.append({"id":q(u(P("cm-sms:mgr"))),"tenant_id":q(tid),"user_id":q(uid["mgr"]),"type":q("sms"),"value":q("+1-555-0100"),"is_verified":q(True)})
    ins("contact_methods", ["id","tenant_id","user_id","type","value","is_verified"], cmrows)

    # -- Alerts --
    inc_a = u(P("inc:a")); inc_b = u(P("inc:b"))
    alrows = [
        ("al1","open","monitor","payments p99 latency > 2s",svc_pay,sev2,None),
        ("al2","acknowledged","prometheus","5xx error rate spike on web",svc_web,sev3,None),
        ("al3","resolved","monitor","disk space low on db-primary",svc_pay,sev3,None),
        ("al4","resolved","prometheus","Payments API unavailable",svc_pay,sev2,None),
    ]
    arows=[]
    for k,st,src,title,svc,sev,inc in alrows:
        arows.append({"id":q(u(P("al:"+k))),"tenant_id":q(tid),"service_id":q(svc),"source":q(src),
            "dedup_key":q("%s-%s"%(slug,k)),"title":q(title),"payload":jb({"seed":"piq-demo","metric":title}),
            "severity_id":q(sev),"status":q(st),"occurrence_count":(3 if k=="al4" else 1),
            "incident_id":q(inc) if inc else "NULL",
            "acknowledged_at":q(ts(days=-1)) if st in("acknowledged","resolved") else "NULL",
            "resolved_at":q(ts(days=-1,hours=2)) if st=="resolved" else "NULL","created_at":q(ts(days=-1,hours=-1))})
    ins("alerts", ["id","tenant_id","service_id","source","dedup_key","title","payload","severity_id","status","occurrence_count","incident_id","acknowledged_at","resolved_at","created_at"], arows,
        conflict="(id)")

    # -- Incidents --
    global INC_NO
    INC_NO += 1; num_a = "IR-2026-%05d" % (90000+INC_NO)
    INC_NO += 1; num_b = "IR-2026-%05d" % (90000+INC_NO)
    ins("incidents", ["id","tenant_id","incident_number","title","description","severity_id","status","declared_by","declared_at","mitigated_at","resolved_at","affected_service_ids","source_alert_id"],
        [{"id":q(inc_a),"tenant_id":q(tid),"incident_number":q(num_a),"title":q("Payments API outage"),
          "description":q("Payments API returned 503 for ~40 min affecting checkout."),"severity_id":q(sev2),
          "status":q("resolved"),"declared_by":q(uid["mgr"]),"declared_at":q(ts(days=-5)),
          "mitigated_at":q(ts(days=-5,hours=1)),"resolved_at":q(ts(days=-5,hours=2)),
          "affected_service_ids":uarr([svc_pay]),"source_alert_id":q(u(P("al:al4")))},
         {"id":q(inc_b),"tenant_id":q(tid),"incident_number":q(num_b),"title":q("Elevated web error rate"),
          "description":q("Investigating a rise in 5xx responses on the web platform."),"severity_id":q(sev1),
          "status":q("investigating"),"declared_by":q(uid["lead"]),"declared_at":q(ts(days=0,hours=-3)),
          "mitigated_at":"NULL","resolved_at":"NULL","affected_service_ids":uarr([svc_web]),"source_alert_id":"NULL"}])
    ins("incident_roles", ["id","incident_id","role","user_id"],
        [{"id":q(u(P("ir:a:ic"))),"incident_id":q(inc_a),"role":q("ic"),"user_id":q(uid["mgr"])},
         {"id":q(u(P("ir:a:comms"))),"incident_id":q(inc_a),"role":q("comms"),"user_id":q(uid["lead"])},
         {"id":q(u(P("ir:a:ops"))),"incident_id":q(inc_a),"role":q("ops"),"user_id":q(uid["ag1"])},
         {"id":q(u(P("ir:a:scribe"))),"incident_id":q(inc_a),"role":q("scribe"),"user_id":q(uid["ag2"])},
         {"id":q(u(P("ir:b:ic"))),"incident_id":q(inc_b),"role":q("ic"),"user_id":q(uid["lead"])}])
    tlrows=[]
    for i,(inc,evt,dd,off) in enumerate([
        (inc_a,"declared",{"severity":"SEV2"},-5*24),
        (inc_a,"status_changed",{"to":"investigating"},-5*24+10),
        (inc_a,"status_changed",{"to":"monitoring"},-5*24+60),
        (inc_a,"status_changed",{"to":"resolved"},-5*24+120),
        (inc_b,"declared",{"severity":"SEV1"},-3),
        (inc_b,"status_changed",{"to":"investigating"},-2)]):
        tlrows.append({"id":q(u(P("tl:%d"%i))),"incident_id":q(inc),"actor_id":q(uid["mgr"]),
            "event_type":q(evt),"data":jb(dd),"pinned":q(evt=="declared"),"at":q(ts(hours=off))})
    ins("incident_timeline", ["id","incident_id","actor_id","event_type","data","pinned","at"], tlrows)
    ins("incident_status_updates", ["id","incident_id","body"],
        [{"id":q(u(P("isu:a1"))),"incident_id":q(inc_a),"body":q("We identified a failed deploy and rolled back. Monitoring recovery.")},
         {"id":q(u(P("isu:a2"))),"incident_id":q(inc_a),"body":q("Payments fully restored. Retrospective to follow.")}])
    retro = u(P("retro:a"))
    ins("incident_retrospectives", ["id","incident_id","summary","contributing_factors","impact","status","published_at"],
        [{"id":q(retro),"incident_id":q(inc_a),"summary":q("A bad config deploy took Payments API offline for ~40 minutes."),
          "contributing_factors":q("Missing canary stage; alert routing delayed by 5 min."),
          "impact":q("~1,200 failed checkouts; est. revenue impact moderate."),"status":q("published"),"published_at":q(ts(days=-4))}])
    ins("retro_action_items", ["id","retro_id","description"],
        [{"id":q(u(P("ai:1"))),"retro_id":q(retro),"description":q("Add canary stage to payments deploy pipeline.")},
         {"id":q(u(P("ai:2"))),"retro_id":q(retro),"description":q("Tune alert routing to page IC within 60s.")}])
    # back-reference the source alert to its incident (circular FK resolved post-insert)
    emit("UPDATE alerts SET incident_id=%s WHERE id=%s;" % (q(inc_a), q(u(P("al:al4")))))

    # -- KB --
    space = u(P("kb:space"))
    ins("kb_spaces", ["id","tenant_id","name","description","slug","scope","is_public","is_active"],
        [{"id":q(space),"tenant_id":q(tid),"name":q("IT Knowledge Base"),"description":q("Self-service help articles"),
          "slug":q(slug+"-it-kb"),"scope":q("tenant_wide"),"is_public":q(False),"is_active":q(True)}])
    kc_how,kc_ts,kc_pol = u(P("kbc:how")),u(P("kbc:ts")),u(P("kbc:pol"))
    ins("kb_categories", ["id","space_id","name","display_order","is_active"],
        [{"id":q(kc_how),"space_id":q(space),"name":q("How-To"),"display_order":1,"is_active":q(True)},
         {"id":q(kc_ts),"space_id":q(space),"name":q("Troubleshooting"),"display_order":2,"is_active":q(True)},
         {"id":q(kc_pol),"space_id":q(space),"name":q("Policies"),"display_order":3,"is_active":q(True)}])
    ins("kb_tags", ["id","tenant_id","name"],
        [{"id":q(u(P("kbt:"+t))),"tenant_id":q(tid),"name":q(t)} for t in ("vpn","email","printer")],
        conflict="(id)")
    kb_specs=[
        ("a1","How to connect to the corporate VPN",kc_how,"published","internal",
         "Step 1: Install the VPN client. Step 2: Sign in with SSO. Step 3: Select the nearest gateway and connect."),
        ("a2","Reset your email password",kc_how,"published","public",
         "Use the self-service portal at /reset, verify via SMS, then set a new password meeting the policy."),
        ("a3","Fixing a paper jam on floor printers",kc_ts,"published","internal",
         "Open tray 2, remove jammed sheet gently, close, then resume the print job from the panel."),
        ("a4","Troubleshooting Outlook calendar crashes",kc_ts,"published","agents_only",
         "Rebuild the Outlook profile, clear the calendar cache, and re-sync. Escalate if OST is corrupt."),
        ("a5","Acceptable Use Policy",kc_pol,"draft","internal",
         "Company devices are for business use. Do not install unapproved software. Report incidents to IT."),
    ]
    krows=[]
    for k,title,cat,st,vis,body in kb_specs:
        krows.append({"id":q(u(P("kb:"+k))),"tenant_id":q(tid),"space_id":q(space),"category_id":q(cat),
            "title":q(title),"slug":q("%s-%s"%(slug,k)),"body":q(body),"excerpt":q(body[:80]),
            "status":q(st),"visibility":q(vis),"author_id":q(uid["ag1"]),"version":1,
            "view_count":{"a1":142,"a2":310,"a3":58,"a4":21,"a5":4}[k],
            "helpful_count":{"a1":30,"a2":88,"a3":12,"a4":5,"a5":0}[k],
            "published_at":q(ts(days=-10)) if st=="published" else "NULL","metadata":jb({"seed":"piq-demo"})})
    ins("kb_articles", ["id","tenant_id","space_id","category_id","title","slug","body","excerpt","status","visibility","author_id","version","view_count","helpful_count","published_at","metadata"], krows)

    # -- Assets / CMDB --
    ac_hw,ac_sw = u(P("ac:hw")),u(P("ac:sw"))
    ins("asset_categories", ["id","tenant_id","name","is_active"],
        [{"id":q(ac_hw),"tenant_id":q(tid),"name":q("Hardware"),"is_active":q(True)},
         {"id":q(ac_sw),"tenant_id":q(tid),"name":q("Software"),"is_active":q(True)}])
    at_lap,at_srv,at_lic = u(P("at:lap")),u(P("at:srv")),u(P("at:lic"))
    ins("asset_types", ["id","tenant_id","category_id","name"],
        [{"id":q(at_lap),"tenant_id":q(tid),"category_id":q(ac_hw),"name":q("Laptop")},
         {"id":q(at_srv),"tenant_id":q(tid),"category_id":q(ac_hw),"name":q("Server")},
         {"id":q(at_lic),"tenant_id":q(tid),"category_id":q(ac_sw),"name":q("SaaS License")}])
    v_dell,v_atl = u(P("v:dell")),u(P("v:atl"))
    ins("vendors", ["id","tenant_id","name","contact_email","website","is_active"],
        [{"id":q(v_dell),"tenant_id":q(tid),"name":q("Dell Technologies"),"contact_email":q("support@dell.demo"),"website":q("https://dell.demo"),"is_active":q(True)},
         {"id":q(v_atl),"tenant_id":q(tid),"name":q("Atlassian"),"contact_email":q("support@atlassian.demo"),"website":q("https://atlassian.demo"),"is_active":q(True)}])
    as_specs=[
        ("s01",at_lap,"Latitude 7440 - Casey","in_use","good",v_dell,"eu1","SN-LAT-0001"),
        ("s02",at_lap,"Latitude 7440 - Devin","in_use","good",v_dell,"eu2","SN-LAT-0002"),
        ("s03",at_lap,"Latitude 5540 - Spare","in_stock","new",v_dell,None,"SN-LAT-0003"),
        ("s04",at_srv,"db-primary","in_use","good",v_dell,None,"SN-SRV-1001"),
        ("s05",at_srv,"web-01","in_use","good",v_dell,None,"SN-SRV-1002"),
        ("s06",at_lic,"Jira Software (50 seats)","in_use","new",v_atl,None,None),
    ]
    asrows=[]; asmap={}
    for i,(k,typ,nm,st,cond,ven,assignee,sn) in enumerate(as_specs,1):
        aid=u(P("as:"+k)); asmap[k]=aid
        asrows.append({"id":q(aid),"asset_tag":q("AST-%s-%03d"%(slug.upper(),i)),"tenant_id":q(tid),
            "department_id":q(dep_it),"type_id":q(typ),"name":q(nm),"status":q(st),"condition":q(cond),
            "serial_number":q(sn),"manufacturer":q("Dell" if ven==v_dell else "Atlassian"),"vendor_id":q(ven),
            "purchase_date":q("2025-01-15"),"purchase_cost":1450.00 if typ==at_lap else (8200.00 if typ==at_srv else 5000.00),
            "warranty_expiry_date":q("2028-01-15"),
            "assigned_to":q(uid[assignee]) if assignee else "NULL",
            "assigned_at":q(ts(days=-30)) if assignee else "NULL","metadata":jb({"seed":"piq-demo"})})
    ins("assets", ["id","asset_tag","tenant_id","department_id","type_id","name","status","condition","serial_number","manufacturer","vendor_id","purchase_date","purchase_cost","warranty_expiry_date","assigned_to","assigned_at","metadata"], asrows)
    ins("asset_relationships", ["id","tenant_id","source_asset_id","target_asset_id","relationship_type","created_by"],
        [{"id":q(u(P("ar:1"))),"tenant_id":q(tid),"source_asset_id":q(asmap["s06"]),"target_asset_id":q(asmap["s05"]),"relationship_type":q("runs_on"),"created_by":q(uid["mgr"])},
         {"id":q(u(P("ar:2"))),"tenant_id":q(tid),"source_asset_id":q(asmap["s04"]),"target_asset_id":q(asmap["s05"]),"relationship_type":q("connected_to"),"created_by":q(uid["mgr"])}])


TICKET_NO = 0
INC_NO = 0

emit("-- PIQ demo seed for itsm_db (generated). Idempotent via ON CONFLICT DO NOTHING.")
emit("SET app.bypass_rls = 'on';")
emit("BEGIN;")
for slug, tid, org, name, create in TENANTS:
    if tid is None:
        tid = u("tenant:"+slug)
    emit("\n-- ===== TENANT: %s (%s) =====" % (name, tid))
    build_tenant(slug, tid, org, name, create)
emit("COMMIT;")

import sys
sys.stdout.write("\n".join(OUT) + "\n")
