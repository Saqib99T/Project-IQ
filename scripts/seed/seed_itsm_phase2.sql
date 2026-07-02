-- PIQ demo seed PHASE 2 (Phase 9 SLO + remaining entities). Idempotent.
SET app.bypass_rls = 'on';
BEGIN;

-- ===== TENANT blue =====
INSERT INTO sli_sources (id,tenant_id,name,type,config,is_active) VALUES
('fe12c134-4877-5174-9243-27471aaf24b1','06a270ba-09fc-7752-8000-0b10a0c66562','Internal uptime','internal_metric','{"metric": "uptime"}'::jsonb,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO slo_objectives (id,tenant_id,service_id,sli_source_id,name,objective_type,target_pct,"window",is_active) VALUES
('162ddd7d-307c-56cb-9b2c-fce5a213e104','06a270ba-09fc-7752-8000-0b10a0c66562','f1852f0e-5b89-5e63-9360-8f99f62496f0','fe12c134-4877-5174-9243-27471aaf24b1','Payments API availability','availability',99.9,'rolling_28d',true),
('c25b858b-a362-5550-8ebd-d95c828187f7','06a270ba-09fc-7752-8000-0b10a0c66562','b59254e8-192d-57bc-bef2-d64dd5fd7a07','fe12c134-4877-5174-9243-27471aaf24b1','Web Platform availability','availability',99.5,'rolling_28d',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO slo_measurements (id,slo_id,bucket_start,good_count,total_count) VALUES
('afe565ff-a00f-504f-9639-7ade3948030a','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-04T00:00:00',1440,1440),
('3bab42da-f4c3-5e2e-a9e0-539fc5c97f2c','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-04T00:00:00',1440,1440),
('fdff0fed-d0f9-5949-a4ed-5f4c1f93cde5','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-05T00:00:00',1440,1440),
('397da03d-cd99-5803-adeb-7f2d1e17db56','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-05T00:00:00',1440,1440),
('820f15ea-04fd-581a-812b-ed29595660cf','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-06T00:00:00',1440,1440),
('739d144b-a750-5f96-a524-c23b4ebc1101','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-06T00:00:00',1440,1440),
('bb1b27c9-fabc-573b-911a-df2933c7eb11','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-07T00:00:00',1440,1440),
('98dc9dd5-9073-5016-8b7c-1079a0a88789','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-07T00:00:00',1440,1440),
('997629c1-f671-5935-8c07-e39f4ce4b8bc','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-08T00:00:00',1440,1440),
('1fa06917-b356-50d5-b84f-9070f316bc67','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-08T00:00:00',1440,1440),
('d87caa8f-697d-522d-b2c2-a2f44cb51163','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-09T00:00:00',1440,1440),
('81ce41ee-63f7-572e-92d0-7dce1007db7e','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-09T00:00:00',1440,1440),
('dbad503c-a240-554f-8934-f3fa8440910f','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-10T00:00:00',1440,1440),
('fb5fd114-ff01-5241-a625-bb8b91c4383c','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-10T00:00:00',1440,1440),
('b0accf17-bf95-5cde-a8b1-ee644e888eb1','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-11T00:00:00',1440,1440),
('c346cdc8-4528-5478-9897-c03c0fb3a69f','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-11T00:00:00',1440,1440),
('359d577c-8737-5cfe-a81a-f76d0f2f7b00','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-12T00:00:00',1440,1440),
('d814d1f3-c198-5d13-a30f-d5ee46b21b33','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-12T00:00:00',1440,1440),
('2830052d-faec-573c-9985-86f6e15050cf','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-13T00:00:00',1440,1440),
('ec845f97-d8e7-5a09-bd1b-d7e14f9c450b','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-13T00:00:00',1440,1440),
('1028fb28-578e-5dbc-9db4-d8b49086a7e9','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-14T00:00:00',1440,1440),
('4df96078-91c1-5787-b08b-936919c55d91','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-14T00:00:00',1440,1440),
('c0be3ac3-97ac-5b56-a12f-f15f82679c54','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-15T00:00:00',1440,1440),
('592e3365-27db-5292-a279-8a4e33fcddc9','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-15T00:00:00',1440,1440),
('e00af7f2-ada0-507c-bd80-a95f72a6c855','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-16T00:00:00',1440,1440),
('5ce978d2-b1c5-5c5b-8ad4-b23ab064533c','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-16T00:00:00',1440,1440),
('85e5390c-5aa6-5e3e-a837-3bbcc048f1f6','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-17T00:00:00',1440,1440),
('c11b5db7-20e9-5259-b6b8-e90a82fc95db','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-17T00:00:00',1440,1440),
('60bbf7b3-56b0-5ef7-9d50-65760a8586f0','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-18T00:00:00',1440,1440),
('82bd51b9-e87e-5575-b807-1c08edc7344a','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-18T00:00:00',1440,1440),
('78a3a604-be0b-5c51-af93-445e55c598a0','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-19T00:00:00',1440,1440),
('e5f74282-ee9c-5bbb-8b3a-ad621a79710c','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-19T00:00:00',1440,1440),
('4fcbcf7c-c7b5-56a0-ad56-054eaad4b039','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-20T00:00:00',1440,1440),
('b8eb756b-5683-5282-9bb3-c68cb3eb8e49','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-20T00:00:00',1440,1440),
('7be80e0e-90cc-5b0c-b3ab-f585f19130e2','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-21T00:00:00',1440,1440),
('8a8fafed-df82-5bb3-ae87-f8227072312f','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-21T00:00:00',1440,1440),
('d8a8887d-36f8-50c0-bfa3-35fc15b8856a','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-22T00:00:00',1440,1440),
('a9778de8-3e78-5f4a-b2a9-160efb073920','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-22T00:00:00',1440,1440),
('e8072329-9555-5863-a0b1-cf135c306860','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-23T00:00:00',1440,1440),
('dad2de5d-8a71-5d22-b4d8-cf64233899d3','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-23T00:00:00',1440,1440),
('9b34f8d4-7bdf-527c-bebd-f543cd596cb8','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-24T00:00:00',1440,1440),
('2d2fb86a-3da7-57eb-8c58-28b573c491ca','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-24T00:00:00',1440,1440),
('577421e9-5be9-5d73-80fe-c601dd9a2e0d','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-25T00:00:00',1440,1440),
('d7200a8b-2829-52cb-996d-18c4a207f1f6','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-25T00:00:00',1440,1440),
('17a4ed37-728a-50c5-8089-242b4990f1a0','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-26T00:00:00',1440,1440),
('16a218d0-7c8d-53dc-b610-37c5929ca31d','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-26T00:00:00',1440,1440),
('a39e7f2e-2e8e-5565-b4ce-80d7ad95d886','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-27T00:00:00',1440,1440),
('1e9eaee9-c2dd-5e32-9d63-7d5300644207','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-27T00:00:00',1440,1440),
('45bd4867-f98d-580e-b88f-b17de247d09d','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-28T00:00:00',1440,1440),
('9f13126f-25f5-5cf7-871f-24ff3b39dc6c','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-28T00:00:00',1440,1440),
('bea4f0a4-95b9-5578-bd90-35e0d93b4d73','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-29T00:00:00',1416,1440),
('cc377bf7-d274-5b46-be3f-9214981bb88a','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-29T00:00:00',1440,1440),
('d4884a54-e468-5454-a233-9a0462c05537','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-06-30T00:00:00',1440,1440),
('8244bc03-8b50-592f-a8f6-032e18ec5174','c25b858b-a362-5550-8ebd-d95c828187f7','2026-06-30T00:00:00',1310,1440),
('c5630465-6337-5d09-bb66-4fdf3b4fb1db','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-07-01T00:00:00',1440,1440),
('5d1a6c54-5d1b-5d8f-b8c9-b223729ea560','c25b858b-a362-5550-8ebd-d95c828187f7','2026-07-01T00:00:00',1310,1440),
('8d6d321f-28dd-5079-baba-f8a6f981515e','162ddd7d-307c-56cb-9b2c-fce5a213e104','2026-07-02T12:00:00',300,300),
('9b5220ba-e204-5e8f-b9d9-a20f719d8ed1','c25b858b-a362-5550-8ebd-d95c828187f7','2026-07-02T12:00:00',294,300)
ON CONFLICT (id) DO NOTHING;
INSERT INTO slo_burn_alerts (id,tenant_id,slo_id,kind,short_window_min,long_window_min,burn_threshold,state) VALUES
('148fbd35-04db-5d5c-9501-2c5c2171c795','06a270ba-09fc-7752-8000-0b10a0c66562','162ddd7d-307c-56cb-9b2c-fce5a213e104','fast_burn',5,60,14.4,'ok'),
('9b82ef68-c137-5ada-b408-3c8eeba1b17d','06a270ba-09fc-7752-8000-0b10a0c66562','162ddd7d-307c-56cb-9b2c-fce5a213e104','slow_burn',30,360,6.0,'ok'),
('136ac14f-a0c2-559a-9720-6a5bd751d7fe','06a270ba-09fc-7752-8000-0b10a0c66562','c25b858b-a362-5550-8ebd-d95c828187f7','fast_burn',5,60,14.4,'ok')
ON CONFLICT (id) DO NOTHING;
INSERT INTO user_department_assignments (user_id,department_id,is_primary) VALUES
('10149a68-a6be-5380-ad66-e55f26d6adac','abd04681-96f1-5e92-84b5-d875148f7526',true),
('61f83872-53ef-5718-8e6c-5ca46a3b14f4','abd04681-96f1-5e92-84b5-d875148f7526',true),
('fa4021fd-1b19-5f85-897f-ecfaa6cd0949','abd04681-96f1-5e92-84b5-d875148f7526',true),
('42649ec3-42f1-5ec2-b238-8e5376c955db','abd04681-96f1-5e92-84b5-d875148f7526',true),
('211a6f18-896e-57a8-84de-e28594e57387','abd04681-96f1-5e92-84b5-d875148f7526',true),
('c4a01c6e-937e-56fd-bb75-bd2d038cb703','abd04681-96f1-5e92-84b5-d875148f7526',true),
('dcb5f61c-f1ad-533c-aeb7-e1c17090d269','abd04681-96f1-5e92-84b5-d875148f7526',true),
('f55f25bd-3523-5af2-850c-3c52812ccc28','abd04681-96f1-5e92-84b5-d875148f7526',true)
ON CONFLICT (user_id,department_id) DO NOTHING;
INSERT INTO sla_underpinning (id,parent_target_id,support_target_id) VALUES
('300fc16e-77e2-5a4e-aa31-944f17742499','2f39f18d-7200-516e-b480-5c139e9b2a3e','99ff7f1e-bf7a-56ca-a34f-8ed0df214456')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ai_sla_predictions (id,tenant_id,ticket_id,instance_id,breach_risk,reason,model_version,actual_breached) VALUES
('6aec1821-c907-531c-abd8-ba425287ec09','06a270ba-09fc-7752-8000-0b10a0c66562','fdca607f-f4e1-5427-9fa8-42456dc9a0aa','8d8466ad-d7e6-5b5f-9329-f155c44e5f45',0.82,'Critical priority, 68% of budget consumed, no first response yet.','heuristic-v1',NULL),
('a74949c5-5170-55f3-a810-de55de2b5bfb','06a270ba-09fc-7752-8000-0b10a0c66562','46ff3af3-249e-5795-b1be-d6df1670a3d1','9bc3a220-6533-5dee-a413-12b87b8ec4f8',0.95,'Resolution clock already exceeded; breached.','heuristic-v1',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_metrics_daily (id,tenant_id,date,dimension,opened_count,met_count,breached_count,total_count,p50_resolve_min,p90_resolve_min,p95_resolve_min,p99_resolve_min) VALUES
('1c7bf2df-0cd9-516f-b458-8f10c4f7e5a3','06a270ba-09fc-7752-8000-0b10a0c66562','2026-06-25','{}'::jsonb,7,7,0,7,180,420,540,690),
('6b79581a-5286-50f4-92f6-431e0e64517f','06a270ba-09fc-7752-8000-0b10a0c66562','2026-06-26','{}'::jsonb,6,5,1,6,180,420,540,690),
('f0f28cdf-8ee0-5855-991b-283ffc5b95e4','06a270ba-09fc-7752-8000-0b10a0c66562','2026-06-27','{}'::jsonb,8,8,0,8,180,420,540,690),
('9c005c0c-869c-5354-8b75-e6551b96cba2','06a270ba-09fc-7752-8000-0b10a0c66562','2026-06-28','{}'::jsonb,7,6,1,7,180,420,540,690),
('755d6fbe-4e0e-510c-8164-7e53f061e615','06a270ba-09fc-7752-8000-0b10a0c66562','2026-06-29','{}'::jsonb,6,6,0,6,180,420,540,690),
('4bf37b97-128a-53d2-8f5e-d66509b2ad52','06a270ba-09fc-7752-8000-0b10a0c66562','2026-06-30','{}'::jsonb,8,8,0,8,180,420,540,690),
('27151543-bebb-5869-a1c0-f2a328226212','06a270ba-09fc-7752-8000-0b10a0c66562','2026-07-01','{}'::jsonb,7,7,0,7,180,420,540,690)
ON CONFLICT (id) DO NOTHING;
INSERT INTO notifications (id,tenant_id,user_id,type,title,body,entity_type,entity_id,is_read) VALUES
('35e8abde-7d0b-5d3b-b7db-b80fc9c440c3','06a270ba-09fc-7752-8000-0b10a0c66562','c4a01c6e-937e-56fd-bb75-bd2d038cb703','ticket_updated','Ticket updated','Agent replied to ''Laptop won''t boot after update''.','ticket','b559c0d4-9d9c-58ba-a3e0-864eef361002',false),
('cea74148-72e6-5916-a2e8-7bfb3f83873a','06a270ba-09fc-7752-8000-0b10a0c66562','fa4021fd-1b19-5f85-897f-ecfaa6cd0949','ticket_assigned','Ticket assigned to you','''Printer on 2nd floor jamming'' was assigned to you.','ticket','5ca1c7a3-69c5-5c57-a3ae-5f781c7db572',true),
('6ea08ecf-9130-58c3-92aa-cd951b02c330','06a270ba-09fc-7752-8000-0b10a0c66562','211a6f18-896e-57a8-84de-e28594e57387','ticket_sla_warning','SLA at risk','''Office VPN down'' is at 75% of its resolution SLA.','ticket','fdca607f-f4e1-5427-9fa8-42456dc9a0aa',false),
('1cc4f17b-7917-5be4-a82f-bc77169086ef','06a270ba-09fc-7752-8000-0b10a0c66562','10149a68-a6be-5380-ad66-e55f26d6adac','ticket_sla_breached','SLA breached','''Intermittent packet loss on 3rd floor'' breached its SLA.','ticket','46ff3af3-249e-5795-b1be-d6df1670a3d1',false),
('edd55c93-c028-5e8b-9880-4629a9815c8d','06a270ba-09fc-7752-8000-0b10a0c66562','dcb5f61c-f1ad-533c-aeb7-e1c17090d269','kb_article_published','New help article','''Reset your email password'' was published.','kb_article','5e4cc5f0-0054-52e3-b462-6e2bfb0bdca9',true),
('e26a8915-6f44-5b12-8560-233e185721b0','06a270ba-09fc-7752-8000-0b10a0c66562','61f83872-53ef-5718-8e6c-5ca46a3b14f4','mention','You were mentioned','You were mentioned on the CRM upgrade change request.','ticket','6cd93bc6-5a42-53a6-9f92-35cd15f6960e',false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO notification_preferences (user_id,tenant_id,type,email_enabled,in_app_enabled) VALUES
('10149a68-a6be-5380-ad66-e55f26d6adac','06a270ba-09fc-7752-8000-0b10a0c66562','ticket_sla_breached',true,true),
('fa4021fd-1b19-5f85-897f-ecfaa6cd0949','06a270ba-09fc-7752-8000-0b10a0c66562','ticket_assigned',false,true)
ON CONFLICT (user_id,type) DO NOTHING;
INSERT INTO maintenance_windows (id,tenant_id,title,service_ids,start_at,end_at,suppress_alerts,created_by) VALUES
('ae299276-0ae0-519d-8192-6600dc2db861','06a270ba-09fc-7752-8000-0b10a0c66562','Web Platform DB upgrade',ARRAY['b59254e8-192d-57bc-bef2-d64dd5fd7a07']::uuid[],'2026-07-05T12:00:00','2026-07-05T14:00:00',true,'10149a68-a6be-5380-ad66-e55f26d6adac')
ON CONFLICT (id) DO NOTHING;
INSERT INTO status_page_config (id,tenant_id,slug,is_public,branding) VALUES
('cd4181b9-40b8-52d2-9ed0-7112e738727e','06a270ba-09fc-7752-8000-0b10a0c66562','blue-status',true,'{"title": "Blue Status", "primary": "#0f766e"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO status_page_subscriptions (id,tenant_id,channel,value,service_ids) VALUES
('4cecb182-9b6e-50ee-9c22-bfc273880cdf','06a270ba-09fc-7752-8000-0b10a0c66562','email','ops-updates@blue.demo',ARRAY['f1852f0e-5b89-5e63-9360-8f99f62496f0','b59254e8-192d-57bc-bef2-d64dd5fd7a07']::uuid[]),
('f46a9b1f-eb8d-57a5-9507-6cc6bbc50636','06a270ba-09fc-7752-8000-0b10a0c66562','email','status-watch@blue.demo',NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO workflows (id,tenant_id,name,trigger,conditions,actions,is_active) VALUES
('fcd0ead9-6d35-5fd7-9998-7b346b3e7c0d','06a270ba-09fc-7752-8000-0b10a0c66562','Notify leadership on SEV1','incident_declared','{"severity": "SEV1"}'::jsonb,'[{"type": "post_incident_status_update", "audience": "stakeholder", "body": "Leadership notified; response underway."}]'::jsonb,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO schedule_overrides (id,schedule_id,user_id,start_at,end_at,origin,created_by) VALUES
('57a5b125-ede1-5ff6-999f-0551d9c4518c','030f251b-a92e-5179-973c-752768ad5b75','211a6f18-896e-57a8-84de-e28594e57387','2026-07-03T12:00:00','2026-07-05T12:00:00','manual','10149a68-a6be-5380-ad66-e55f26d6adac')
ON CONFLICT (id) DO NOTHING;
INSERT INTO alert_routing_rules (id,tenant_id,position,conditions,service_id,severity_id) VALUES
('6e19ac6b-ae5c-58c6-b52e-ebef32ddba29','06a270ba-09fc-7752-8000-0b10a0c66562',1,'{"source": "monitor"}'::jsonb,'f1852f0e-5b89-5e63-9360-8f99f62496f0','5c5beeec-26ad-5957-82f0-0d4d65566527')
ON CONFLICT (id) DO NOTHING;
INSERT INTO heartbeats (id,tenant_id,service_id,name,interval_sec,last_ping_at,ping_token) VALUES
('9eacc36a-e1a8-526d-a0cf-e35e3262e952','06a270ba-09fc-7752-8000-0b10a0c66562','f1852f0e-5b89-5e63-9360-8f99f62496f0','Payments nightly batch',300,'2026-07-02T11:00:00','demo-blue-hb1')
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_article_feedback (id,article_id,user_id,is_helpful,comment) VALUES
('57392be5-a598-5a81-9727-ab111e04b50f','d2e1745e-2f21-5983-93e9-fed59d982127','c4a01c6e-937e-56fd-bb75-bd2d038cb703',true,'Clear steps, connected first try.'),
('c82bb240-f9ab-525b-bc3c-821e23e28ca8','5e4cc5f0-0054-52e3-b462-6e2bfb0bdca9','dcb5f61c-f1ad-533c-aeb7-e1c17090d269',true,NULL),
('faba8b53-8914-55be-bdd5-aed49bbbc1fd','6aa0338a-7ae9-5d71-83c5-7077179f570a','f55f25bd-3523-5af2-850c-3c52812ccc28',false,'Tray 2 didn''t apply to my model.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_article_tag_assignments (article_id,tag_id) VALUES
('d2e1745e-2f21-5983-93e9-fed59d982127','b829bc0b-7ae5-5714-b7c2-c950d1b891b6'),
('5e4cc5f0-0054-52e3-b462-6e2bfb0bdca9','359c1e4a-3695-5983-8c81-d66b19d3414d'),
('6aa0338a-7ae9-5d71-83c5-7077179f570a','c86c3675-09e3-56ac-8a50-bbb1cfd0e8e1')
ON CONFLICT (article_id,tag_id) DO NOTHING;
INSERT INTO ticket_kb_links (ticket_id,article_id,linked_by,is_suggested) VALUES
('8beb07a5-8ed7-5d36-9f69-6ae7c97856e1','d2e1745e-2f21-5983-93e9-fed59d982127','42649ec3-42f1-5ec2-b238-8e5376c955db',false),
('5ca1c7a3-69c5-5c57-a3ae-5f781c7db572','b7653a90-0695-52fd-b0d4-1bff21ae3845',NULL,true)
ON CONFLICT (ticket_id,article_id) DO NOTHING;
INSERT INTO ticket_approvals (id,ticket_id,requested_by,approver_id,status,comment) VALUES
('73e43e93-e3e9-556c-b188-fd957406bfea','6cd93bc6-5a42-53a6-9f92-35cd15f6960e','61f83872-53ef-5718-8e6c-5ca46a3b14f4','10149a68-a6be-5380-ad66-e55f26d6adac','pending','CRM v12 upgrade — needs change-manager sign-off.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_escalations (id,ticket_id,escalated_by,escalated_to,reason) VALUES
('4c2a45c3-afcc-5219-87c3-06fefc844e94','fdca607f-f4e1-5427-9fa8-42456dc9a0aa','211a6f18-896e-57a8-84de-e28594e57387','10149a68-a6be-5380-ad66-e55f26d6adac','Core VPN concentrator unreachable; needs infra lead.')
ON CONFLICT (id) DO NOTHING;

-- ===== TENANT piq =====
INSERT INTO sli_sources (id,tenant_id,name,type,config,is_active) VALUES
('bc06e5c4-fc6a-5f79-9e77-c90ff60fa776','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Internal uptime','internal_metric','{"metric": "uptime"}'::jsonb,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO slo_objectives (id,tenant_id,service_id,sli_source_id,name,objective_type,target_pct,"window",is_active) VALUES
('90196487-08e7-5c29-84ec-5b3ac05705d5','7862dc84-72d6-40a9-b2b1-c7c7896bc148','2b1e0ca4-ef22-55d8-994c-8849003e4070','bc06e5c4-fc6a-5f79-9e77-c90ff60fa776','Payments API availability','availability',99.9,'rolling_28d',true),
('1ac063c9-9dda-517a-86e3-897cea838db3','7862dc84-72d6-40a9-b2b1-c7c7896bc148','f211d896-be23-534a-9aaa-a991e72d180e','bc06e5c4-fc6a-5f79-9e77-c90ff60fa776','Web Platform availability','availability',99.5,'rolling_28d',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO slo_measurements (id,slo_id,bucket_start,good_count,total_count) VALUES
('b8fb1337-516b-51af-95ac-7b714f5d0b74','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-04T00:00:00',1440,1440),
('45b9b854-b42b-5b66-af8c-1c9326db1a2c','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-04T00:00:00',1440,1440),
('c1043184-eb72-5bed-97d3-90b7e3164435','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-05T00:00:00',1440,1440),
('8f3bba8c-a311-58e2-b4fd-a35a058b2f21','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-05T00:00:00',1440,1440),
('c1db4375-5ba2-5fc8-add8-b36de15e5e6b','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-06T00:00:00',1440,1440),
('54c89f65-c9cc-5ff1-86a6-9ee7e2287d9d','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-06T00:00:00',1440,1440),
('7a80abb4-64c6-5f39-846e-706c3efe432e','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-07T00:00:00',1440,1440),
('b2fe1ab8-13b1-5207-99f2-3c40722ff412','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-07T00:00:00',1440,1440),
('d94fea42-50fc-50bd-b89d-253827717505','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-08T00:00:00',1440,1440),
('ef649e5c-0dd2-5334-b59d-eb00ec3e7b1c','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-08T00:00:00',1440,1440),
('7eb7010a-8580-59ea-a6e9-6d8a988b6258','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-09T00:00:00',1440,1440),
('6b2c42f0-a87b-5953-9e20-3e65bfad0e44','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-09T00:00:00',1440,1440),
('e1e9f231-f3e2-52e7-ac50-8f3ef50506bf','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-10T00:00:00',1440,1440),
('b95200a2-b5e0-5e6c-977f-60b013b4acf7','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-10T00:00:00',1440,1440),
('ac4137b9-22a0-5d55-a919-618aea22e64b','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-11T00:00:00',1440,1440),
('7e308dfa-929d-53c8-8519-e1a02aa0fd0f','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-11T00:00:00',1440,1440),
('610de9e0-5d68-5679-9cec-9026651aa3d7','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-12T00:00:00',1440,1440),
('b6a0cc02-a6c3-5256-89d8-2cf55e53a69b','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-12T00:00:00',1440,1440),
('830e4460-5ed7-5f3d-8448-1c8e06fcf891','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-13T00:00:00',1440,1440),
('3b70a7c9-0ee7-58d1-b2f0-9876ba41987c','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-13T00:00:00',1440,1440),
('03c07421-cc46-5ce4-90b4-a7cdf08566e0','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-14T00:00:00',1440,1440),
('1b79dbae-1d07-55e7-a09f-5617fc95602b','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-14T00:00:00',1440,1440),
('ce41407a-ae23-54c9-ac2b-44aab3c428fb','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-15T00:00:00',1440,1440),
('9485b04f-22ad-5860-bd49-309bb43c8de3','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-15T00:00:00',1440,1440),
('5656b13d-fa35-5f48-a948-54c39af38ce2','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-16T00:00:00',1440,1440),
('96a21cdf-78b8-5692-9871-1bf36330936b','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-16T00:00:00',1440,1440),
('de88f3a2-c003-57b7-bd65-2a0240970466','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-17T00:00:00',1440,1440),
('f339ad07-d6e8-5749-93a0-6c32546e8d61','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-17T00:00:00',1440,1440),
('7df2accc-2600-53f8-832a-f1a8b60c1224','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-18T00:00:00',1440,1440),
('2405e60b-5c9b-5f53-8b7b-a78c30cdc38d','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-18T00:00:00',1440,1440),
('cb5bfa00-af69-52e1-a0b6-5ba7d229dd5d','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-19T00:00:00',1440,1440),
('f4bbf324-c7ba-5e55-94fa-7ffa6e7485c9','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-19T00:00:00',1440,1440),
('71231608-4ba9-5550-afd5-47191c304209','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-20T00:00:00',1440,1440),
('bfb2b035-06ea-5162-9f7c-23186d9d615f','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-20T00:00:00',1440,1440),
('a9712c31-d44e-5d67-9279-1d0496555ef3','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-21T00:00:00',1440,1440),
('eaa825ad-a073-5179-9a53-0975b2a1afc6','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-21T00:00:00',1440,1440),
('e6d3cf77-c1b8-533e-903d-278c9b86b57c','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-22T00:00:00',1440,1440),
('66e85bab-eeb7-52fe-b3ea-6dd37da14cc9','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-22T00:00:00',1440,1440),
('e4ab4584-c7e0-5ca3-a782-23dc95bcd9d9','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-23T00:00:00',1440,1440),
('155f26b4-0edb-5969-82b8-f1f70fbbdc46','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-23T00:00:00',1440,1440),
('5d127723-d8fb-5a17-81bd-a08076f07960','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-24T00:00:00',1440,1440),
('ee73627c-374d-54e4-acd0-c94b26018f44','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-24T00:00:00',1440,1440),
('e6d937a1-c832-5383-8341-6e712bcc0c17','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-25T00:00:00',1440,1440),
('b88c3bb4-256e-516b-b824-c5f80a54ace6','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-25T00:00:00',1440,1440),
('d669e5a9-85d4-5d9f-a93c-8e0b65589a4f','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-26T00:00:00',1440,1440),
('d810a8bc-96a4-5367-a93c-cf610bc1a339','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-26T00:00:00',1440,1440),
('23e64745-2a79-55f4-9599-378e74e9c8ff','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-27T00:00:00',1440,1440),
('adec5964-ddc1-54c1-9c8c-1d884044c039','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-27T00:00:00',1440,1440),
('87431735-8867-589b-8067-715b695e2612','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-28T00:00:00',1440,1440),
('ead56545-a6eb-583b-b883-a57bd1783b63','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-28T00:00:00',1440,1440),
('3e58cad5-d9a3-517b-930b-3a27275536db','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-29T00:00:00',1416,1440),
('56bf18f2-688e-5064-8dbf-33649c7609f8','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-29T00:00:00',1440,1440),
('29eebbd9-4a34-5fd4-854f-3ed1de35a4ec','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-06-30T00:00:00',1440,1440),
('2b01a59a-d0f5-5df8-ae04-9d6278b01c90','1ac063c9-9dda-517a-86e3-897cea838db3','2026-06-30T00:00:00',1310,1440),
('a2fedfb8-1223-52ea-b1e4-d758474c7b23','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-07-01T00:00:00',1440,1440),
('7b1e3015-45b0-52e5-b753-c5985399a590','1ac063c9-9dda-517a-86e3-897cea838db3','2026-07-01T00:00:00',1310,1440),
('e0239a4c-f2af-51f5-91df-ec04b4bb964c','90196487-08e7-5c29-84ec-5b3ac05705d5','2026-07-02T12:00:00',300,300),
('4d3cf785-4905-5189-a2a3-5f5025ded0be','1ac063c9-9dda-517a-86e3-897cea838db3','2026-07-02T12:00:00',294,300)
ON CONFLICT (id) DO NOTHING;
INSERT INTO slo_burn_alerts (id,tenant_id,slo_id,kind,short_window_min,long_window_min,burn_threshold,state) VALUES
('0ada442b-3638-590a-8c0d-2d6d3764a527','7862dc84-72d6-40a9-b2b1-c7c7896bc148','90196487-08e7-5c29-84ec-5b3ac05705d5','fast_burn',5,60,14.4,'ok'),
('c9c37b1b-64d4-55db-b1e2-327a32194c02','7862dc84-72d6-40a9-b2b1-c7c7896bc148','90196487-08e7-5c29-84ec-5b3ac05705d5','slow_burn',30,360,6.0,'ok'),
('687b7b07-b86c-53a3-88a3-d652cf4b0152','7862dc84-72d6-40a9-b2b1-c7c7896bc148','1ac063c9-9dda-517a-86e3-897cea838db3','fast_burn',5,60,14.4,'ok')
ON CONFLICT (id) DO NOTHING;
INSERT INTO user_department_assignments (user_id,department_id,is_primary) VALUES
('82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','8aa752af-92dd-5584-8e0e-abf4a230ba8d',true),
('6eb4bcd6-944f-5c20-90a5-0c9af16e2601','8aa752af-92dd-5584-8e0e-abf4a230ba8d',true),
('30be9e37-c91f-537d-895c-3656a0c3c353','8aa752af-92dd-5584-8e0e-abf4a230ba8d',true),
('5420160e-f427-53bb-9bf8-a23ced907ba4','8aa752af-92dd-5584-8e0e-abf4a230ba8d',true),
('95196733-d13c-59f3-8fcd-e713c5d325fe','8aa752af-92dd-5584-8e0e-abf4a230ba8d',true),
('0a063b29-68a4-5172-91f6-7fbc1e3ee2d6','8aa752af-92dd-5584-8e0e-abf4a230ba8d',true),
('6d596769-c2cc-5494-979f-f1ec86dce78a','8aa752af-92dd-5584-8e0e-abf4a230ba8d',true),
('232b0f85-e9dd-540c-8a48-6c70af135963','8aa752af-92dd-5584-8e0e-abf4a230ba8d',true)
ON CONFLICT (user_id,department_id) DO NOTHING;
INSERT INTO sla_underpinning (id,parent_target_id,support_target_id) VALUES
('62fbbd5e-4493-5f42-b315-c97cb88113ab','2b7434c2-fc5a-5c3f-a91d-4489b9011ad9','ce0ff332-cbb1-5a99-b696-da2715dff1ba')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ai_sla_predictions (id,tenant_id,ticket_id,instance_id,breach_risk,reason,model_version,actual_breached) VALUES
('7478f77d-3f21-5453-95bd-2873e83e91ba','7862dc84-72d6-40a9-b2b1-c7c7896bc148','2a7e4be0-cd95-5e84-ba23-6761ec90df56','e03ab28a-4e6c-5ac5-8570-5dc8571a3178',0.82,'Critical priority, 68% of budget consumed, no first response yet.','heuristic-v1',NULL),
('8ed74510-3a90-53b7-b156-c7801c3d4237','7862dc84-72d6-40a9-b2b1-c7c7896bc148','47c4fafd-dda8-5b69-8649-eca39f82e0af','53cc86b1-bf0d-5919-ae3f-64275c9d5734',0.95,'Resolution clock already exceeded; breached.','heuristic-v1',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_metrics_daily (id,tenant_id,date,dimension,opened_count,met_count,breached_count,total_count,p50_resolve_min,p90_resolve_min,p95_resolve_min,p99_resolve_min) VALUES
('7aaa9713-1254-5dcf-a8a1-94b133b6c64f','7862dc84-72d6-40a9-b2b1-c7c7896bc148','2026-06-25','{}'::jsonb,7,7,0,7,180,420,540,690),
('55bac3a0-ef0c-550c-ac28-9168dbed3396','7862dc84-72d6-40a9-b2b1-c7c7896bc148','2026-06-26','{}'::jsonb,6,5,1,6,180,420,540,690),
('2d35296f-8d58-50a7-9be1-99af38913924','7862dc84-72d6-40a9-b2b1-c7c7896bc148','2026-06-27','{}'::jsonb,8,8,0,8,180,420,540,690),
('a1d83d4c-c8e9-5d65-819b-fb5f75099bcd','7862dc84-72d6-40a9-b2b1-c7c7896bc148','2026-06-28','{}'::jsonb,7,6,1,7,180,420,540,690),
('bf4efb25-4f13-5480-8e6a-1ba67c4964c2','7862dc84-72d6-40a9-b2b1-c7c7896bc148','2026-06-29','{}'::jsonb,6,6,0,6,180,420,540,690),
('7f5452b4-c4b5-5b18-9007-0f11628cb8d9','7862dc84-72d6-40a9-b2b1-c7c7896bc148','2026-06-30','{}'::jsonb,8,8,0,8,180,420,540,690),
('fea9dcce-b51b-5977-bb55-3e64623bdd1a','7862dc84-72d6-40a9-b2b1-c7c7896bc148','2026-07-01','{}'::jsonb,7,7,0,7,180,420,540,690)
ON CONFLICT (id) DO NOTHING;
INSERT INTO notifications (id,tenant_id,user_id,type,title,body,entity_type,entity_id,is_read) VALUES
('63804b29-d44a-503b-a4c4-6d1f09ebae44','7862dc84-72d6-40a9-b2b1-c7c7896bc148','0a063b29-68a4-5172-91f6-7fbc1e3ee2d6','ticket_updated','Ticket updated','Agent replied to ''Laptop won''t boot after update''.','ticket','dbaa5a10-bba0-5c94-9cd8-6946dda2800d',false),
('78197941-627e-545e-a41b-e970f468dabb','7862dc84-72d6-40a9-b2b1-c7c7896bc148','30be9e37-c91f-537d-895c-3656a0c3c353','ticket_assigned','Ticket assigned to you','''Printer on 2nd floor jamming'' was assigned to you.','ticket','88e3d683-4479-54cb-a29c-347c6c5fdcf4',true),
('79828442-75f2-5eee-92fd-dbbd5bc58378','7862dc84-72d6-40a9-b2b1-c7c7896bc148','95196733-d13c-59f3-8fcd-e713c5d325fe','ticket_sla_warning','SLA at risk','''Office VPN down'' is at 75% of its resolution SLA.','ticket','2a7e4be0-cd95-5e84-ba23-6761ec90df56',false),
('0eb3afa4-344a-5300-b4f0-f6676dc09037','7862dc84-72d6-40a9-b2b1-c7c7896bc148','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','ticket_sla_breached','SLA breached','''Intermittent packet loss on 3rd floor'' breached its SLA.','ticket','47c4fafd-dda8-5b69-8649-eca39f82e0af',false),
('d5dcde26-aa8e-5722-bf24-aa258dd3c408','7862dc84-72d6-40a9-b2b1-c7c7896bc148','6d596769-c2cc-5494-979f-f1ec86dce78a','kb_article_published','New help article','''Reset your email password'' was published.','kb_article','ad122de1-816b-59e8-a316-a9e10bef373e',true),
('7db6cf99-749e-5fb0-be53-247105ec967e','7862dc84-72d6-40a9-b2b1-c7c7896bc148','6eb4bcd6-944f-5c20-90a5-0c9af16e2601','mention','You were mentioned','You were mentioned on the CRM upgrade change request.','ticket','6a4ac366-ba61-5818-b061-8129e3112335',false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO notification_preferences (user_id,tenant_id,type,email_enabled,in_app_enabled) VALUES
('82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','7862dc84-72d6-40a9-b2b1-c7c7896bc148','ticket_sla_breached',true,true),
('30be9e37-c91f-537d-895c-3656a0c3c353','7862dc84-72d6-40a9-b2b1-c7c7896bc148','ticket_assigned',false,true)
ON CONFLICT (user_id,type) DO NOTHING;
INSERT INTO maintenance_windows (id,tenant_id,title,service_ids,start_at,end_at,suppress_alerts,created_by) VALUES
('14f4585f-c765-52ce-9bb4-1eefed39621d','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Web Platform DB upgrade',ARRAY['f211d896-be23-534a-9aaa-a991e72d180e']::uuid[],'2026-07-05T12:00:00','2026-07-05T14:00:00',true,'82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049')
ON CONFLICT (id) DO NOTHING;
INSERT INTO status_page_config (id,tenant_id,slug,is_public,branding) VALUES
('a04f4b6e-ecf0-5ab4-b927-c18a4cd27f57','7862dc84-72d6-40a9-b2b1-c7c7896bc148','piq-status',true,'{"title": "Piq Status", "primary": "#0f766e"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO status_page_subscriptions (id,tenant_id,channel,value,service_ids) VALUES
('009453a6-3f70-5b1e-8e20-b1bd59a23e71','7862dc84-72d6-40a9-b2b1-c7c7896bc148','email','ops-updates@piq.demo',ARRAY['2b1e0ca4-ef22-55d8-994c-8849003e4070','f211d896-be23-534a-9aaa-a991e72d180e']::uuid[]),
('01d913e4-08e5-5b58-9a86-01b11084c9f9','7862dc84-72d6-40a9-b2b1-c7c7896bc148','email','status-watch@piq.demo',NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO workflows (id,tenant_id,name,trigger,conditions,actions,is_active) VALUES
('bb28dc5c-18ee-566a-b890-ea9f1af7a864','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Notify leadership on SEV1','incident_declared','{"severity": "SEV1"}'::jsonb,'[{"type": "post_incident_status_update", "audience": "stakeholder", "body": "Leadership notified; response underway."}]'::jsonb,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO schedule_overrides (id,schedule_id,user_id,start_at,end_at,origin,created_by) VALUES
('cad06e88-7714-51ce-b9d4-2095e7dc19b9','7b3723bd-ed76-53a4-8d17-abc758bdbe62','95196733-d13c-59f3-8fcd-e713c5d325fe','2026-07-03T12:00:00','2026-07-05T12:00:00','manual','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049')
ON CONFLICT (id) DO NOTHING;
INSERT INTO alert_routing_rules (id,tenant_id,position,conditions,service_id,severity_id) VALUES
('5e54ffc3-796f-54e8-92ec-ef418900bcfb','7862dc84-72d6-40a9-b2b1-c7c7896bc148',1,'{"source": "monitor"}'::jsonb,'2b1e0ca4-ef22-55d8-994c-8849003e4070','e02b4e58-bbec-5d94-9ef6-40c530cb53da')
ON CONFLICT (id) DO NOTHING;
INSERT INTO heartbeats (id,tenant_id,service_id,name,interval_sec,last_ping_at,ping_token) VALUES
('ca6422d5-174e-5c49-8ac7-270dad93f4fc','7862dc84-72d6-40a9-b2b1-c7c7896bc148','2b1e0ca4-ef22-55d8-994c-8849003e4070','Payments nightly batch',300,'2026-07-02T11:00:00','demo-piq-hb1')
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_article_feedback (id,article_id,user_id,is_helpful,comment) VALUES
('456f44d8-d8c3-55aa-8ae8-6cefb51b4f73','c3937703-9bae-51fb-9587-bd97014ae90a','0a063b29-68a4-5172-91f6-7fbc1e3ee2d6',true,'Clear steps, connected first try.'),
('e56de45b-e916-5fef-bac5-94008ac4961d','ad122de1-816b-59e8-a316-a9e10bef373e','6d596769-c2cc-5494-979f-f1ec86dce78a',true,NULL),
('8737d686-81d1-5cf2-b287-836a0ee51822','1e7add1a-d2ae-577b-9f14-e0f9d129aeea','232b0f85-e9dd-540c-8a48-6c70af135963',false,'Tray 2 didn''t apply to my model.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_article_tag_assignments (article_id,tag_id) VALUES
('c3937703-9bae-51fb-9587-bd97014ae90a','b8a35572-9dbb-5970-8017-db27f03f4d5d'),
('ad122de1-816b-59e8-a316-a9e10bef373e','7b968841-ac69-56ca-bc33-e8b54ffe14e8'),
('1e7add1a-d2ae-577b-9f14-e0f9d129aeea','731ca325-975f-532a-b1b2-289094db7373')
ON CONFLICT (article_id,tag_id) DO NOTHING;
INSERT INTO ticket_kb_links (ticket_id,article_id,linked_by,is_suggested) VALUES
('d9611611-f119-54d9-85da-e026eda11ff7','c3937703-9bae-51fb-9587-bd97014ae90a','5420160e-f427-53bb-9bf8-a23ced907ba4',false),
('88e3d683-4479-54cb-a29c-347c6c5fdcf4','9a7dfa0b-a73b-57b3-b171-0ff93f558fcb',NULL,true)
ON CONFLICT (ticket_id,article_id) DO NOTHING;
INSERT INTO ticket_approvals (id,ticket_id,requested_by,approver_id,status,comment) VALUES
('39abdd20-f216-5cf2-9c70-3e5b7d631a05','6a4ac366-ba61-5818-b061-8129e3112335','6eb4bcd6-944f-5c20-90a5-0c9af16e2601','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','pending','CRM v12 upgrade — needs change-manager sign-off.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_escalations (id,ticket_id,escalated_by,escalated_to,reason) VALUES
('f2cb743a-cfde-5e5f-9859-98f5b974a4b2','2a7e4be0-cd95-5e84-ba23-6761ec90df56','95196733-d13c-59f3-8fcd-e713c5d325fe','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','Core VPN concentrator unreachable; needs infra lead.')
ON CONFLICT (id) DO NOTHING;

-- ===== TENANT acme =====
INSERT INTO sli_sources (id,tenant_id,name,type,config,is_active) VALUES
('9e85b362-0498-5b28-9ad9-d54cdc663b77','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Internal uptime','internal_metric','{"metric": "uptime"}'::jsonb,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO slo_objectives (id,tenant_id,service_id,sli_source_id,name,objective_type,target_pct,"window",is_active) VALUES
('dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','56cc885c-37d4-5dc6-900d-1a7a6defec8b','19e4074d-63fa-5967-87fe-b8cccfd53448','9e85b362-0498-5b28-9ad9-d54cdc663b77','Payments API availability','availability',99.9,'rolling_28d',true),
('eebff49d-139a-5d31-916e-850b158f404f','56cc885c-37d4-5dc6-900d-1a7a6defec8b','4da0b040-cfc1-5dfd-bdbf-965c031aef39','9e85b362-0498-5b28-9ad9-d54cdc663b77','Web Platform availability','availability',99.5,'rolling_28d',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO slo_measurements (id,slo_id,bucket_start,good_count,total_count) VALUES
('6f13d1b1-267f-5daa-a5a7-a49b242946f3','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-04T00:00:00',1440,1440),
('9855a5c3-9fc6-5405-b1b6-193ae6ed418d','eebff49d-139a-5d31-916e-850b158f404f','2026-06-04T00:00:00',1440,1440),
('4a477fd1-414c-50eb-be0e-fc0734c1cee9','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-05T00:00:00',1440,1440),
('f5850551-075a-5dad-a964-f81ba744c5c4','eebff49d-139a-5d31-916e-850b158f404f','2026-06-05T00:00:00',1440,1440),
('afa3e18a-64f8-50c7-b507-632aea4554cf','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-06T00:00:00',1440,1440),
('e8e6fbdb-b7de-5421-a038-21ac68231432','eebff49d-139a-5d31-916e-850b158f404f','2026-06-06T00:00:00',1440,1440),
('e4393d34-3fe1-51b6-88d3-9c620aae5755','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-07T00:00:00',1440,1440),
('ccefbd38-b69b-5d32-9bd3-b4b63bcf1847','eebff49d-139a-5d31-916e-850b158f404f','2026-06-07T00:00:00',1440,1440),
('77c46899-e7c6-5f6c-b308-26365e3af3b6','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-08T00:00:00',1440,1440),
('b21c36fa-4196-5632-9fb1-17b48fa7cd55','eebff49d-139a-5d31-916e-850b158f404f','2026-06-08T00:00:00',1440,1440),
('aab699a6-40bb-54da-87cb-9784fc7f6397','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-09T00:00:00',1440,1440),
('7ae0f402-e110-54e1-8571-72c544420b6b','eebff49d-139a-5d31-916e-850b158f404f','2026-06-09T00:00:00',1440,1440),
('ea637406-022f-5c21-a31c-015fb0aecec8','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-10T00:00:00',1440,1440),
('162d6302-23da-5a71-ad3a-996b582a91e7','eebff49d-139a-5d31-916e-850b158f404f','2026-06-10T00:00:00',1440,1440),
('d1ac7d27-868d-5f34-99d4-49ede1b33fa8','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-11T00:00:00',1440,1440),
('89bcbfb3-a1f0-5997-9252-eab4d98e21ee','eebff49d-139a-5d31-916e-850b158f404f','2026-06-11T00:00:00',1440,1440),
('42ab5bc1-aa35-536c-90ef-ce25f9d101fd','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-12T00:00:00',1440,1440),
('55d138e1-b2ad-5984-b7e5-bffd540a2a1f','eebff49d-139a-5d31-916e-850b158f404f','2026-06-12T00:00:00',1440,1440),
('411c815d-36a3-5d81-809e-9f19293c3135','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-13T00:00:00',1440,1440),
('591f88ca-7246-5578-8311-ebeab9e1b650','eebff49d-139a-5d31-916e-850b158f404f','2026-06-13T00:00:00',1440,1440),
('2dc9f826-cf23-58e4-9ea9-d6dfc2058227','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-14T00:00:00',1440,1440),
('55f5fc37-8dd2-5997-8211-d24d8129dc18','eebff49d-139a-5d31-916e-850b158f404f','2026-06-14T00:00:00',1440,1440),
('75114293-68f9-5dae-9cb4-e4cc54050906','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-15T00:00:00',1440,1440),
('8fa9c3af-9aa1-57f3-ad22-c0992353ecbc','eebff49d-139a-5d31-916e-850b158f404f','2026-06-15T00:00:00',1440,1440),
('1144959c-40f6-5562-9ad7-a396bb5a3cf2','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-16T00:00:00',1440,1440),
('fca4520e-844d-54cc-ab12-0551b6d0f773','eebff49d-139a-5d31-916e-850b158f404f','2026-06-16T00:00:00',1440,1440),
('f87ad53d-b1dd-5940-a67e-82347b2171ae','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-17T00:00:00',1440,1440),
('c56fc805-c4fb-574b-9d33-10fc2852b53e','eebff49d-139a-5d31-916e-850b158f404f','2026-06-17T00:00:00',1440,1440),
('0033373f-71c2-5b61-9ad8-86847fd9a7fb','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-18T00:00:00',1440,1440),
('2ae32dde-678f-581a-9ea9-2c7382f1eddc','eebff49d-139a-5d31-916e-850b158f404f','2026-06-18T00:00:00',1440,1440),
('83ba6751-b520-56fe-90f1-47457971313d','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-19T00:00:00',1440,1440),
('3822fc22-3de5-5c6a-9e17-fab5879e17ee','eebff49d-139a-5d31-916e-850b158f404f','2026-06-19T00:00:00',1440,1440),
('5cd5548e-d604-5dd7-b3cd-91c090b09a03','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-20T00:00:00',1440,1440),
('7cffb77a-d64a-5ed9-b5a1-9d397711a55b','eebff49d-139a-5d31-916e-850b158f404f','2026-06-20T00:00:00',1440,1440),
('cf3b046c-a0cb-59f6-a535-63b4aec7bae5','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-21T00:00:00',1440,1440),
('6c581ff7-49c0-5c12-b301-e9c477bdabdb','eebff49d-139a-5d31-916e-850b158f404f','2026-06-21T00:00:00',1440,1440),
('28495491-cc87-595c-ac91-74956f909602','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-22T00:00:00',1440,1440),
('94ce3e3d-b0da-5f19-bbf1-5cfe10da74c8','eebff49d-139a-5d31-916e-850b158f404f','2026-06-22T00:00:00',1440,1440),
('2305ee6e-e779-594c-8680-9a7b41111a2a','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-23T00:00:00',1440,1440),
('a3b7153c-472c-5cea-80ba-fb7bed978e92','eebff49d-139a-5d31-916e-850b158f404f','2026-06-23T00:00:00',1440,1440),
('05f2d2a8-5d79-5ee0-9d8d-e270b6df415c','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-24T00:00:00',1440,1440),
('d16d23e3-ac4b-5468-8243-537f7fa31f9d','eebff49d-139a-5d31-916e-850b158f404f','2026-06-24T00:00:00',1440,1440),
('ac086385-d429-5165-aa19-871c89e9ad35','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-25T00:00:00',1440,1440),
('3f8de8c5-7807-5a72-be50-ad256f7a2ec9','eebff49d-139a-5d31-916e-850b158f404f','2026-06-25T00:00:00',1440,1440),
('d337ad87-3080-5bbe-a796-ab2f23e12eeb','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-26T00:00:00',1440,1440),
('5b242192-8aa4-5e4d-b19a-0356d73b06e6','eebff49d-139a-5d31-916e-850b158f404f','2026-06-26T00:00:00',1440,1440),
('edeadf96-60bf-59d6-8f66-47bf46bfa690','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-27T00:00:00',1440,1440),
('f520e7a3-61dc-5f70-ac4d-c82f4d14d757','eebff49d-139a-5d31-916e-850b158f404f','2026-06-27T00:00:00',1440,1440),
('f0006034-e7f2-5fca-b954-f0fc7956c765','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-28T00:00:00',1440,1440),
('e9d7200e-1e5b-5983-9830-188b549264d4','eebff49d-139a-5d31-916e-850b158f404f','2026-06-28T00:00:00',1440,1440),
('7b5f5704-d8b8-50e3-836d-aec6c8e564b0','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-29T00:00:00',1416,1440),
('27d59096-db01-59a7-b4eb-f3b76b8b17a2','eebff49d-139a-5d31-916e-850b158f404f','2026-06-29T00:00:00',1440,1440),
('5a162d78-bb28-594c-b4e9-eec5d39ac502','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-06-30T00:00:00',1440,1440),
('13848616-5bb4-5114-8cbf-60056c1e107d','eebff49d-139a-5d31-916e-850b158f404f','2026-06-30T00:00:00',1310,1440),
('4b3fa073-6c2b-56d4-b67a-46b4d02f0650','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-07-01T00:00:00',1440,1440),
('3695bd53-5b56-5916-8805-b8b1d04751a9','eebff49d-139a-5d31-916e-850b158f404f','2026-07-01T00:00:00',1310,1440),
('bc5adeca-9727-5bf9-bef6-0299ab4df1f8','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','2026-07-02T12:00:00',300,300),
('54bfeaad-2ad1-5398-9d8c-ce30a48f6210','eebff49d-139a-5d31-916e-850b158f404f','2026-07-02T12:00:00',294,300)
ON CONFLICT (id) DO NOTHING;
INSERT INTO slo_burn_alerts (id,tenant_id,slo_id,kind,short_window_min,long_window_min,burn_threshold,state) VALUES
('f1117d74-d981-5120-8912-34276c66546c','56cc885c-37d4-5dc6-900d-1a7a6defec8b','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','fast_burn',5,60,14.4,'ok'),
('6d2fddd2-11e3-5f1a-b197-b45d33f95b0e','56cc885c-37d4-5dc6-900d-1a7a6defec8b','dd9d6372-69ea-5ab7-b2c2-51fcf5922e43','slow_burn',30,360,6.0,'ok'),
('361e3b9a-f6cf-52e0-a516-55e9a2c954b1','56cc885c-37d4-5dc6-900d-1a7a6defec8b','eebff49d-139a-5d31-916e-850b158f404f','fast_burn',5,60,14.4,'ok')
ON CONFLICT (id) DO NOTHING;
INSERT INTO user_department_assignments (user_id,department_id,is_primary) VALUES
('6da32b93-6f3d-5f80-b6e7-69cba3f13e38','7ffd830b-4e1f-5067-94ce-9d6d79daafd7',true),
('4a46dc4a-6050-522b-aab9-0a8cdd200c80','7ffd830b-4e1f-5067-94ce-9d6d79daafd7',true),
('5073456e-2932-5df4-b218-9ce4e34553f1','7ffd830b-4e1f-5067-94ce-9d6d79daafd7',true),
('83a1c32e-2426-52b4-b62a-8e16ebdea66b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7',true),
('ba390f71-e0c1-5cb8-8993-20574d961dac','7ffd830b-4e1f-5067-94ce-9d6d79daafd7',true),
('3e74b653-ba7f-5124-a06c-248e31ae2786','7ffd830b-4e1f-5067-94ce-9d6d79daafd7',true),
('cad34ad2-3796-524a-b2ea-319baacdd3a1','7ffd830b-4e1f-5067-94ce-9d6d79daafd7',true),
('89338c6c-3002-5ce5-9c11-46cba66b5fd5','7ffd830b-4e1f-5067-94ce-9d6d79daafd7',true)
ON CONFLICT (user_id,department_id) DO NOTHING;
INSERT INTO sla_underpinning (id,parent_target_id,support_target_id) VALUES
('13e755c2-7961-533a-94ef-d3625e1eaec1','2b3a00b6-8486-5037-865b-e19cc9c48ea2','a35bc6a5-f5cc-5606-afb4-198bf1af3cc9')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ai_sla_predictions (id,tenant_id,ticket_id,instance_id,breach_risk,reason,model_version,actual_breached) VALUES
('e2d1e817-fd05-5665-8bea-9e3398a32a54','56cc885c-37d4-5dc6-900d-1a7a6defec8b','8afeb429-1916-51da-985c-4af3d5c8c987','c59af7df-5831-59a4-9e33-1206d327640d',0.82,'Critical priority, 68% of budget consumed, no first response yet.','heuristic-v1',NULL),
('79699f07-7aa1-59e4-b20b-25ff43dbf3e3','56cc885c-37d4-5dc6-900d-1a7a6defec8b','ce332e2b-8000-566b-9564-7870a5e7a4c6','b3dd16ce-3f1b-5e34-a35c-d8324c8abfcf',0.95,'Resolution clock already exceeded; breached.','heuristic-v1',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_metrics_daily (id,tenant_id,date,dimension,opened_count,met_count,breached_count,total_count,p50_resolve_min,p90_resolve_min,p95_resolve_min,p99_resolve_min) VALUES
('ee4f15e1-7cda-587a-86d6-768b4000e8a8','56cc885c-37d4-5dc6-900d-1a7a6defec8b','2026-06-25','{}'::jsonb,7,7,0,7,180,420,540,690),
('a671bd46-4f1b-5411-a5c4-60ad8d5a5abf','56cc885c-37d4-5dc6-900d-1a7a6defec8b','2026-06-26','{}'::jsonb,6,5,1,6,180,420,540,690),
('360d1a40-ca39-562f-b3e9-790a40a89782','56cc885c-37d4-5dc6-900d-1a7a6defec8b','2026-06-27','{}'::jsonb,8,8,0,8,180,420,540,690),
('160cf642-c393-5ee8-a595-de81b207959c','56cc885c-37d4-5dc6-900d-1a7a6defec8b','2026-06-28','{}'::jsonb,7,6,1,7,180,420,540,690),
('71aeb360-6702-55cd-9d60-87a18dcd0e6b','56cc885c-37d4-5dc6-900d-1a7a6defec8b','2026-06-29','{}'::jsonb,6,6,0,6,180,420,540,690),
('f34d10f5-074c-5d0d-ab85-180e847a8b2a','56cc885c-37d4-5dc6-900d-1a7a6defec8b','2026-06-30','{}'::jsonb,8,8,0,8,180,420,540,690),
('ed26ed41-236d-566e-8d73-63f0b078f270','56cc885c-37d4-5dc6-900d-1a7a6defec8b','2026-07-01','{}'::jsonb,7,7,0,7,180,420,540,690)
ON CONFLICT (id) DO NOTHING;
INSERT INTO notifications (id,tenant_id,user_id,type,title,body,entity_type,entity_id,is_read) VALUES
('415b48a2-3f5c-5b93-86e7-62fa6c3eecb1','56cc885c-37d4-5dc6-900d-1a7a6defec8b','3e74b653-ba7f-5124-a06c-248e31ae2786','ticket_updated','Ticket updated','Agent replied to ''Laptop won''t boot after update''.','ticket','277bcad4-4122-5cdf-8267-a2e181cef3e2',false),
('f6bdc3ba-59a1-5a2b-992e-8526e4425968','56cc885c-37d4-5dc6-900d-1a7a6defec8b','5073456e-2932-5df4-b218-9ce4e34553f1','ticket_assigned','Ticket assigned to you','''Printer on 2nd floor jamming'' was assigned to you.','ticket','64ba53e8-3096-581c-966d-4d75f253cf1c',true),
('dfe88dd7-c7c8-54cf-92b2-b9ab02a10319','56cc885c-37d4-5dc6-900d-1a7a6defec8b','ba390f71-e0c1-5cb8-8993-20574d961dac','ticket_sla_warning','SLA at risk','''Office VPN down'' is at 75% of its resolution SLA.','ticket','8afeb429-1916-51da-985c-4af3d5c8c987',false),
('fe4dae48-5943-57d5-b88f-0bff03ee1049','56cc885c-37d4-5dc6-900d-1a7a6defec8b','6da32b93-6f3d-5f80-b6e7-69cba3f13e38','ticket_sla_breached','SLA breached','''Intermittent packet loss on 3rd floor'' breached its SLA.','ticket','ce332e2b-8000-566b-9564-7870a5e7a4c6',false),
('bb6e5f56-8c0b-5f8f-912b-0d1a25baa849','56cc885c-37d4-5dc6-900d-1a7a6defec8b','cad34ad2-3796-524a-b2ea-319baacdd3a1','kb_article_published','New help article','''Reset your email password'' was published.','kb_article','cec037a4-eb70-5479-adad-449597b80283',true),
('6df2b5f8-a52f-569b-af4e-4ee2030c4daa','56cc885c-37d4-5dc6-900d-1a7a6defec8b','4a46dc4a-6050-522b-aab9-0a8cdd200c80','mention','You were mentioned','You were mentioned on the CRM upgrade change request.','ticket','dd8bb97d-a2da-57ce-b2b2-f12e5b9a1855',false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO notification_preferences (user_id,tenant_id,type,email_enabled,in_app_enabled) VALUES
('6da32b93-6f3d-5f80-b6e7-69cba3f13e38','56cc885c-37d4-5dc6-900d-1a7a6defec8b','ticket_sla_breached',true,true),
('5073456e-2932-5df4-b218-9ce4e34553f1','56cc885c-37d4-5dc6-900d-1a7a6defec8b','ticket_assigned',false,true)
ON CONFLICT (user_id,type) DO NOTHING;
INSERT INTO maintenance_windows (id,tenant_id,title,service_ids,start_at,end_at,suppress_alerts,created_by) VALUES
('578dd8af-f783-5cc7-87cc-935ff74c6872','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Web Platform DB upgrade',ARRAY['4da0b040-cfc1-5dfd-bdbf-965c031aef39']::uuid[],'2026-07-05T12:00:00','2026-07-05T14:00:00',true,'6da32b93-6f3d-5f80-b6e7-69cba3f13e38')
ON CONFLICT (id) DO NOTHING;
INSERT INTO status_page_config (id,tenant_id,slug,is_public,branding) VALUES
('2a486548-8ec7-591a-955d-cf37c4a8063a','56cc885c-37d4-5dc6-900d-1a7a6defec8b','acme-status',true,'{"title": "Acme Status", "primary": "#0f766e"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO status_page_subscriptions (id,tenant_id,channel,value,service_ids) VALUES
('228a3f6e-a85b-524a-afd7-044609e85cd8','56cc885c-37d4-5dc6-900d-1a7a6defec8b','email','ops-updates@acme.demo',ARRAY['19e4074d-63fa-5967-87fe-b8cccfd53448','4da0b040-cfc1-5dfd-bdbf-965c031aef39']::uuid[]),
('d578ae75-4486-5f6e-8334-b0dd09fabc14','56cc885c-37d4-5dc6-900d-1a7a6defec8b','email','status-watch@acme.demo',NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO workflows (id,tenant_id,name,trigger,conditions,actions,is_active) VALUES
('f80040ed-18b3-5d40-9f1b-b98b48ec1abb','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Notify leadership on SEV1','incident_declared','{"severity": "SEV1"}'::jsonb,'[{"type": "post_incident_status_update", "audience": "stakeholder", "body": "Leadership notified; response underway."}]'::jsonb,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO schedule_overrides (id,schedule_id,user_id,start_at,end_at,origin,created_by) VALUES
('adbbfe99-2d3d-594b-b080-85ea646e3ac5','ebeeba7e-e1d3-5253-befe-f313af073e40','ba390f71-e0c1-5cb8-8993-20574d961dac','2026-07-03T12:00:00','2026-07-05T12:00:00','manual','6da32b93-6f3d-5f80-b6e7-69cba3f13e38')
ON CONFLICT (id) DO NOTHING;
INSERT INTO alert_routing_rules (id,tenant_id,position,conditions,service_id,severity_id) VALUES
('f02cb891-29a9-5a79-85ed-1f760a32fadc','56cc885c-37d4-5dc6-900d-1a7a6defec8b',1,'{"source": "monitor"}'::jsonb,'19e4074d-63fa-5967-87fe-b8cccfd53448','8c64e1ba-2222-59b6-9e39-e6a0421b554f')
ON CONFLICT (id) DO NOTHING;
INSERT INTO heartbeats (id,tenant_id,service_id,name,interval_sec,last_ping_at,ping_token) VALUES
('fb317883-b464-54ab-96c3-51f38602271c','56cc885c-37d4-5dc6-900d-1a7a6defec8b','19e4074d-63fa-5967-87fe-b8cccfd53448','Payments nightly batch',300,'2026-07-02T11:00:00','demo-acme-hb1')
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_article_feedback (id,article_id,user_id,is_helpful,comment) VALUES
('cee31196-c6c9-5f55-b24f-0ecbbd61e30a','da916263-bf7e-5bb6-80e1-f3ceee8f1b28','3e74b653-ba7f-5124-a06c-248e31ae2786',true,'Clear steps, connected first try.'),
('be9480d4-e563-59e5-858f-95c2602d2cd5','cec037a4-eb70-5479-adad-449597b80283','cad34ad2-3796-524a-b2ea-319baacdd3a1',true,NULL),
('6cc9442e-d42a-57eb-a250-d2fd8dfca5fb','7d1b8d6f-e20b-52aa-8546-6fe054e06fe2','89338c6c-3002-5ce5-9c11-46cba66b5fd5',false,'Tray 2 didn''t apply to my model.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_article_tag_assignments (article_id,tag_id) VALUES
('da916263-bf7e-5bb6-80e1-f3ceee8f1b28','d6bf9d5c-97bd-5052-a06f-85d271f15ebd'),
('cec037a4-eb70-5479-adad-449597b80283','ebd18311-5c68-5fb6-af98-65572e379bb4'),
('7d1b8d6f-e20b-52aa-8546-6fe054e06fe2','5a9b596b-a31b-5739-9037-4157ba3af90c')
ON CONFLICT (article_id,tag_id) DO NOTHING;
INSERT INTO ticket_kb_links (ticket_id,article_id,linked_by,is_suggested) VALUES
('bfe16b83-a679-5fae-a799-bd4cff3ceaf6','da916263-bf7e-5bb6-80e1-f3ceee8f1b28','83a1c32e-2426-52b4-b62a-8e16ebdea66b',false),
('64ba53e8-3096-581c-966d-4d75f253cf1c','0d8ca246-aa68-53ff-bcf4-db3c4c386ba0',NULL,true)
ON CONFLICT (ticket_id,article_id) DO NOTHING;
INSERT INTO ticket_approvals (id,ticket_id,requested_by,approver_id,status,comment) VALUES
('119c8d87-fc6e-5ae9-bca7-88d602ff1f17','dd8bb97d-a2da-57ce-b2b2-f12e5b9a1855','4a46dc4a-6050-522b-aab9-0a8cdd200c80','6da32b93-6f3d-5f80-b6e7-69cba3f13e38','pending','CRM v12 upgrade — needs change-manager sign-off.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_escalations (id,ticket_id,escalated_by,escalated_to,reason) VALUES
('e7f56123-0927-5865-921b-450625e27186','8afeb429-1916-51da-985c-4af3d5c8c987','ba390f71-e0c1-5cb8-8993-20574d961dac','6da32b93-6f3d-5f80-b6e7-69cba3f13e38','Core VPN concentrator unreachable; needs infra lead.')
ON CONFLICT (id) DO NOTHING;
COMMIT;
