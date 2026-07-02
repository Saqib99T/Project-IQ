-- PIQ demo seed for itsm_db (generated). Idempotent via ON CONFLICT DO NOTHING.
SET app.bypass_rls = 'on';
BEGIN;

-- ===== TENANT: Blue Team (06a270ba-09fc-7752-8000-0b10a0c66562) =====
INSERT INTO users (id,iam_user_id,tenant_id,email,first_name,last_name,is_active,metadata,iam_roles,last_seen_at) VALUES
('10149a68-a6be-5380-ad66-e55f26d6adac','demo-blue-mgr','06a270ba-09fc-7752-8000-0b10a0c66562','morgan.avery@blue.demo','Morgan','Avery',true,'{"seed": "piq-demo"}'::jsonb,'["manager"]'::jsonb,'2026-07-01T12:00:00'),
('61f83872-53ef-5718-8e6c-5ca46a3b14f4','demo-blue-lead','06a270ba-09fc-7752-8000-0b10a0c66562','riley.chen@blue.demo','Riley','Chen',true,'{"seed": "piq-demo"}'::jsonb,'["team_lead"]'::jsonb,'2026-07-01T12:00:00'),
('fa4021fd-1b19-5f85-897f-ecfaa6cd0949','demo-blue-ag1','06a270ba-09fc-7752-8000-0b10a0c66562','jordan.patel@blue.demo','Jordan','Patel',true,'{"seed": "piq-demo"}'::jsonb,'["agent"]'::jsonb,'2026-07-01T12:00:00'),
('42649ec3-42f1-5ec2-b238-8e5376c955db','demo-blue-ag2','06a270ba-09fc-7752-8000-0b10a0c66562','sam.nguyen@blue.demo','Sam','Nguyen',true,'{"seed": "piq-demo"}'::jsonb,'["agent"]'::jsonb,'2026-07-01T12:00:00'),
('211a6f18-896e-57a8-84de-e28594e57387','demo-blue-ag3','06a270ba-09fc-7752-8000-0b10a0c66562','taylor.okafor@blue.demo','Taylor','Okafor',true,'{"seed": "piq-demo"}'::jsonb,'["agent"]'::jsonb,'2026-07-01T12:00:00'),
('c4a01c6e-937e-56fd-bb75-bd2d038cb703','demo-blue-eu1','06a270ba-09fc-7752-8000-0b10a0c66562','casey.brooks@blue.demo','Casey','Brooks',true,'{"seed": "piq-demo"}'::jsonb,'["end_user"]'::jsonb,'2026-07-01T12:00:00'),
('dcb5f61c-f1ad-533c-aeb7-e1c17090d269','demo-blue-eu2','06a270ba-09fc-7752-8000-0b10a0c66562','devin.flores@blue.demo','Devin','Flores',true,'{"seed": "piq-demo"}'::jsonb,'["end_user"]'::jsonb,'2026-07-01T12:00:00'),
('f55f25bd-3523-5af2-850c-3c52812ccc28','demo-blue-eu3','06a270ba-09fc-7752-8000-0b10a0c66562','alex.romano@blue.demo','Alex','Romano',true,'{"seed": "piq-demo"}'::jsonb,'["end_user"]'::jsonb,'2026-07-01T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO user_itsm_roles (user_id,role_id,tenant_id) VALUES
('10149a68-a6be-5380-ad66-e55f26d6adac','302afd7f-8c70-47e3-96f7-f2942652f8f3','06a270ba-09fc-7752-8000-0b10a0c66562'),
('61f83872-53ef-5718-8e6c-5ca46a3b14f4','e16363a0-d237-4b7d-b19d-305a7d85afa6','06a270ba-09fc-7752-8000-0b10a0c66562'),
('fa4021fd-1b19-5f85-897f-ecfaa6cd0949','1da49bee-2bfc-4c49-92f8-4819fe966f5b','06a270ba-09fc-7752-8000-0b10a0c66562'),
('42649ec3-42f1-5ec2-b238-8e5376c955db','1da49bee-2bfc-4c49-92f8-4819fe966f5b','06a270ba-09fc-7752-8000-0b10a0c66562'),
('211a6f18-896e-57a8-84de-e28594e57387','1da49bee-2bfc-4c49-92f8-4819fe966f5b','06a270ba-09fc-7752-8000-0b10a0c66562'),
('c4a01c6e-937e-56fd-bb75-bd2d038cb703','52dd610c-24f8-47ed-8b6a-84181200955b','06a270ba-09fc-7752-8000-0b10a0c66562'),
('dcb5f61c-f1ad-533c-aeb7-e1c17090d269','52dd610c-24f8-47ed-8b6a-84181200955b','06a270ba-09fc-7752-8000-0b10a0c66562'),
('f55f25bd-3523-5af2-850c-3c52812ccc28','52dd610c-24f8-47ed-8b6a-84181200955b','06a270ba-09fc-7752-8000-0b10a0c66562')
ON CONFLICT (user_id,role_id) DO NOTHING;
INSERT INTO departments (id,tenant_id,name,description,is_active) VALUES
('abd04681-96f1-5e92-84b5-d875148f7526','06a270ba-09fc-7752-8000-0b10a0c66562','IT','Information Technology',true),
('419eeb67-7472-5901-a7df-d37966e3bb8c','06a270ba-09fc-7752-8000-0b10a0c66562','Operations','Business Operations',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id,tenant_id,name,description,lead_id) VALUES
('e2275d5a-6111-5d56-9ca3-3b1ecb0f0936','06a270ba-09fc-7752-8000-0b10a0c66562','Service Desk','First-line support','61f83872-53ef-5718-8e6c-5ca46a3b14f4'),
('0d9630c6-6659-5bfe-8201-72f054986bd8','06a270ba-09fc-7752-8000-0b10a0c66562','Infrastructure','Servers, network & cloud','10149a68-a6be-5380-ad66-e55f26d6adac')
ON CONFLICT (id) DO NOTHING;
INSERT INTO team_members (team_id,user_id) VALUES
('e2275d5a-6111-5d56-9ca3-3b1ecb0f0936','fa4021fd-1b19-5f85-897f-ecfaa6cd0949'),
('e2275d5a-6111-5d56-9ca3-3b1ecb0f0936','42649ec3-42f1-5ec2-b238-8e5376c955db'),
('e2275d5a-6111-5d56-9ca3-3b1ecb0f0936','61f83872-53ef-5718-8e6c-5ca46a3b14f4'),
('0d9630c6-6659-5bfe-8201-72f054986bd8','211a6f18-896e-57a8-84de-e28594e57387'),
('0d9630c6-6659-5bfe-8201-72f054986bd8','10149a68-a6be-5380-ad66-e55f26d6adac')
ON CONFLICT (team_id,user_id) DO NOTHING;
INSERT INTO coverage_windows (id,tenant_id,name,timezone,is_247,work_days,windows) VALUES
('bae819f6-29c1-5be3-8328-267338d6d9a7','06a270ba-09fc-7752-8000-0b10a0c66562','24x7','UTC',true,ARRAY[1,2,3,4,5,6,7],NULL),
('714a2087-d3ef-536c-8783-02931bac3547','06a270ba-09fc-7752-8000-0b10a0c66562','Business Hours (Mon-Fri 9-6)','UTC',false,ARRAY[1,2,3,4,5],'[{"day": 1, "start": "09:00", "end": "18:00"}, {"day": 2, "start": "09:00", "end": "18:00"}, {"day": 3, "start": "09:00", "end": "18:00"}, {"day": 4, "start": "09:00", "end": "18:00"}, {"day": 5, "start": "09:00", "end": "18:00"}]'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_agreements (id,tenant_id,name,kind,description,owner_team_id,is_active) VALUES
('a6117548-a9e8-5ac2-996d-635f47157ea5','06a270ba-09fc-7752-8000-0b10a0c66562','Standard Support SLA','sla','Default customer SLA','e2275d5a-6111-5d56-9ca3-3b1ecb0f0936',true),
('27fd7062-5ecc-5af2-b11a-1bf14a5eda4d','06a270ba-09fc-7752-8000-0b10a0c66562','Premium SLA','sla','Priority customers','e2275d5a-6111-5d56-9ca3-3b1ecb0f0936',true),
('31471574-e085-56a0-ae95-35f7ad286d9e','06a270ba-09fc-7752-8000-0b10a0c66562','Infrastructure OLA','ola','Internal infra underpinning','0d9630c6-6659-5bfe-8201-72f054986bd8',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_targets (id,tenant_id,agreement_id,metric,duration_minutes,coverage_window_id,applies_priority,warn_thresholds_pct) VALUES
('370c1861-6d6e-5ae2-a9f6-d2bbfd322f56','06a270ba-09fc-7752-8000-0b10a0c66562','a6117548-a9e8-5ac2-996d-635f47157ea5','first_response',60,'714a2087-d3ef-536c-8783-02931bac3547','high',ARRAY[50,75,90]),
('2f39f18d-7200-516e-b480-5c139e9b2a3e','06a270ba-09fc-7752-8000-0b10a0c66562','a6117548-a9e8-5ac2-996d-635f47157ea5','resolution',480,'714a2087-d3ef-536c-8783-02931bac3547',NULL,ARRAY[50,75,90]),
('8e956c14-942b-55f9-8941-6682b8e3afd5','06a270ba-09fc-7752-8000-0b10a0c66562','27fd7062-5ecc-5af2-b11a-1bf14a5eda4d','first_response',15,'bae819f6-29c1-5be3-8328-267338d6d9a7','critical',ARRAY[50,75,90]),
('cd29f1bb-4321-5e30-bd2e-08559f9e8779','06a270ba-09fc-7752-8000-0b10a0c66562','27fd7062-5ecc-5af2-b11a-1bf14a5eda4d','resolution',240,'bae819f6-29c1-5be3-8328-267338d6d9a7',NULL,ARRAY[50,75,90]),
('99ff7f1e-bf7a-56ca-a34f-8ed0df214456','06a270ba-09fc-7752-8000-0b10a0c66562','31471574-e085-56a0-ae95-35f7ad286d9e','time_to_mitigate',120,'bae819f6-29c1-5be3-8328-267338d6d9a7',NULL,ARRAY[50,90])
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_rules (id,tenant_id,position,conditions,agreement_id,is_active) VALUES
('c244df68-3fe5-5540-9927-0168aadfc890','06a270ba-09fc-7752-8000-0b10a0c66562',1,'{"priority": ["critical"]}'::jsonb,'27fd7062-5ecc-5af2-b11a-1bf14a5eda4d',true),
('1ec3621c-b8db-5b50-bfe3-28c26b3b30ba','06a270ba-09fc-7752-8000-0b10a0c66562',2,'{}'::jsonb,'a6117548-a9e8-5ac2-996d-635f47157ea5',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_categories (id,tenant_id,name,is_active,default_team_id) VALUES
('d8790e47-f0fd-54d7-b1a6-ceacf7dd8ff7','06a270ba-09fc-7752-8000-0b10a0c66562','Hardware',true,'e2275d5a-6111-5d56-9ca3-3b1ecb0f0936'),
('97767cc7-8f1f-59a8-a5c8-9a149384c9b0','06a270ba-09fc-7752-8000-0b10a0c66562','Software',true,'e2275d5a-6111-5d56-9ca3-3b1ecb0f0936'),
('941fa9b8-7db0-5b24-88da-acfb753e1737','06a270ba-09fc-7752-8000-0b10a0c66562','Network',true,'0d9630c6-6659-5bfe-8201-72f054986bd8'),
('596d81ed-7886-508f-89c9-22840b7e08ab','06a270ba-09fc-7752-8000-0b10a0c66562','Access Request',true,'e2275d5a-6111-5d56-9ca3-3b1ecb0f0936')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_tags (id,tenant_id,name,color) VALUES
('db0d5860-98b7-5e6e-9291-2c33b81f5410','06a270ba-09fc-7752-8000-0b10a0c66562','vip','#e11d48'),
('0233256e-82fb-54d8-9af4-144b02fcb087','06a270ba-09fc-7752-8000-0b10a0c66562','recurring','#f59e0b'),
('b968bcc6-0fb8-5a26-ab99-aa8c4b031452','06a270ba-09fc-7752-8000-0b10a0c66562','hardware','#3b82f6'),
('ff904d6f-f16b-5abf-8f14-9114a37fd459','06a270ba-09fc-7752-8000-0b10a0c66562','urgent','#dc2626')
ON CONFLICT (tenant_id,name) DO NOTHING;
INSERT INTO tickets (id,ticket_number,tenant_id,department_id,type,status,priority,title,description,requester_id,assignee_id,team_id,category_id,sla_response_due,sla_resolve_due,sla_breached,resolved_at,closed_at,created_at,metadata) VALUES
('b559c0d4-9d9c-58ba-a3e0-864eef361002','90001','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','incident','in_progress','high','Laptop won''t boot after update','Laptop won''t boot after update. Reported by user; see comments for detail.','c4a01c6e-937e-56fd-bb75-bd2d038cb703','fa4021fd-1b19-5f85-897f-ecfaa6cd0949','e2275d5a-6111-5d56-9ca3-3b1ecb0f0936','d8790e47-f0fd-54d7-b1a6-ceacf7dd8ff7','2026-06-30T13:00:00','2026-06-30T20:00:00',false,NULL,NULL,'2026-06-30T12:00:00','{"seed": "piq-demo"}'::jsonb),
('fdca607f-f4e1-5427-9fa8-42456dc9a0aa','90002','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','incident','open','critical','Office VPN down for remote staff','Office VPN down for remote staff. Reported by user; see comments for detail.','dcb5f61c-f1ad-533c-aeb7-e1c17090d269','211a6f18-896e-57a8-84de-e28594e57387','0d9630c6-6659-5bfe-8201-72f054986bd8','941fa9b8-7db0-5b24-88da-acfb753e1737','2026-07-02T13:00:00','2026-07-02T20:00:00',false,NULL,NULL,'2026-07-02T12:00:00','{"seed": "piq-demo"}'::jsonb),
('bff84f9c-5615-5b9b-af03-5ca2087ecb5c','90003','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','service_request','open','medium','New starter access to shared drive','New starter access to shared drive. Reported by user; see comments for detail.','f55f25bd-3523-5af2-850c-3c52812ccc28','42649ec3-42f1-5ec2-b238-8e5376c955db','e2275d5a-6111-5d56-9ca3-3b1ecb0f0936','596d81ed-7886-508f-89c9-22840b7e08ab','2026-07-01T13:00:00','2026-07-01T20:00:00',false,NULL,NULL,'2026-07-01T12:00:00','{"seed": "piq-demo"}'::jsonb),
('5ca1c7a3-69c5-5c57-a3ae-5f781c7db572','90004','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','incident','resolved','medium','Outlook crashes when opening calendar','Outlook crashes when opening calendar. Reported by user; see comments for detail.','c4a01c6e-937e-56fd-bb75-bd2d038cb703','fa4021fd-1b19-5f85-897f-ecfaa6cd0949','e2275d5a-6111-5d56-9ca3-3b1ecb0f0936','97767cc7-8f1f-59a8-a5c8-9a149384c9b0','2026-06-26T13:00:00','2026-06-26T20:00:00',false,'2026-06-26T17:00:00',NULL,'2026-06-26T12:00:00','{"seed": "piq-demo"}'::jsonb),
('46ff3af3-249e-5795-b1be-d6df1670a3d1','90005','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','problem','in_progress','high','Intermittent packet loss on 3rd floor','Intermittent packet loss on 3rd floor. Reported by user; see comments for detail.','dcb5f61c-f1ad-533c-aeb7-e1c17090d269','211a6f18-896e-57a8-84de-e28594e57387','0d9630c6-6659-5bfe-8201-72f054986bd8','941fa9b8-7db0-5b24-88da-acfb753e1737','2026-06-28T13:00:00','2026-06-28T20:00:00',false,NULL,NULL,'2026-06-28T12:00:00','{"seed": "piq-demo"}'::jsonb),
('26a7e467-c1e5-5833-b38f-e64c347ccb86','90006','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','service_request','closed','low','Request second monitor','Request second monitor. Reported by user; see comments for detail.','f55f25bd-3523-5af2-850c-3c52812ccc28','42649ec3-42f1-5ec2-b238-8e5376c955db','e2275d5a-6111-5d56-9ca3-3b1ecb0f0936','d8790e47-f0fd-54d7-b1a6-ceacf7dd8ff7','2026-06-23T13:00:00','2026-06-23T20:00:00',false,'2026-06-23T17:00:00','2026-06-23T18:00:00','2026-06-23T12:00:00','{"seed": "piq-demo"}'::jsonb),
('6cd93bc6-5a42-53a6-9f92-35cd15f6960e','90007','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','change','pending_approval','medium','Upgrade CRM to v12 (change request)','Upgrade CRM to v12 (change request). Reported by user; see comments for detail.','61f83872-53ef-5718-8e6c-5ca46a3b14f4','10149a68-a6be-5380-ad66-e55f26d6adac','0d9630c6-6659-5bfe-8201-72f054986bd8','97767cc7-8f1f-59a8-a5c8-9a149384c9b0','2026-06-29T13:00:00','2026-06-29T20:00:00',false,NULL,NULL,'2026-06-29T12:00:00','{"seed": "piq-demo"}'::jsonb),
('811b272a-e228-5c49-91d4-f841e09cb985','90008','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','incident','pending','high','Payroll app slow at month end','Payroll app slow at month end. Reported by user; see comments for detail.','c4a01c6e-937e-56fd-bb75-bd2d038cb703','42649ec3-42f1-5ec2-b238-8e5376c955db','e2275d5a-6111-5d56-9ca3-3b1ecb0f0936','97767cc7-8f1f-59a8-a5c8-9a149384c9b0','2026-07-01T13:00:00','2026-07-01T20:00:00',false,NULL,NULL,'2026-07-01T12:00:00','{"seed": "piq-demo"}'::jsonb),
('f8c61aa1-5e2e-5529-a208-6a0ea774c04c','90009','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','incident','resolved','low','Printer on 2nd floor jamming','Printer on 2nd floor jamming. Reported by user; see comments for detail.','dcb5f61c-f1ad-533c-aeb7-e1c17090d269','fa4021fd-1b19-5f85-897f-ecfaa6cd0949','e2275d5a-6111-5d56-9ca3-3b1ecb0f0936','d8790e47-f0fd-54d7-b1a6-ceacf7dd8ff7','2026-06-25T13:00:00','2026-06-25T20:00:00',false,'2026-06-25T17:00:00',NULL,'2026-06-25T12:00:00','{"seed": "piq-demo"}'::jsonb),
('8beb07a5-8ed7-5d36-9f69-6ae7c97856e1','90010','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','service_request','open','medium','VPN access for contractor','VPN access for contractor. Reported by user; see comments for detail.','f55f25bd-3523-5af2-850c-3c52812ccc28','42649ec3-42f1-5ec2-b238-8e5376c955db','e2275d5a-6111-5d56-9ca3-3b1ecb0f0936','596d81ed-7886-508f-89c9-22840b7e08ab','2026-07-02T13:00:00','2026-07-02T20:00:00',false,NULL,NULL,'2026-07-02T12:00:00','{"seed": "piq-demo"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_comments (id,ticket_id,author_id,body,is_internal,created_at) VALUES
('d7af257c-5ebe-50dc-8e4b-7ffc09c5d83b','b559c0d4-9d9c-58ba-a3e0-864eef361002','fa4021fd-1b19-5f85-897f-ecfaa6cd0949','Confirmed the device is stuck on the update screen. Trying safe boot.',true,'2026-07-01T12:00:00'),
('6dab4a54-a36c-5d2d-9f09-8cdf69f1f690','b559c0d4-9d9c-58ba-a3e0-864eef361002','c4a01c6e-937e-56fd-bb75-bd2d038cb703','Thanks, let me know if you need me to bring it in.',false,'2026-07-01T12:00:00'),
('9ada6702-5b04-59b0-8b73-d9b1d01b73fb','fdca607f-f4e1-5427-9fa8-42456dc9a0aa','211a6f18-896e-57a8-84de-e28594e57387','Escalating to infra — core VPN concentrator is unreachable.',true,'2026-07-01T12:00:00'),
('5622340f-cf2d-541f-9aca-d84a30107146','5ca1c7a3-69c5-5c57-a3ae-5f781c7db572','fa4021fd-1b19-5f85-897f-ecfaa6cd0949','Rebuilt the Outlook profile; calendar opens normally now.',false,'2026-07-01T12:00:00'),
('0790f50e-7b67-549f-aed6-0728113b20d5','46ff3af3-249e-5795-b1be-d6df1670a3d1','211a6f18-896e-57a8-84de-e28594e57387','Captured pcap; suspecting a faulty switch port. Investigating.',true,'2026-07-01T12:00:00'),
('cc35b977-7d6a-5dc4-8815-7a2a595c2105','811b272a-e228-5c49-91d4-f841e09cb985','42649ec3-42f1-5ec2-b238-8e5376c955db','Reproduced the slowness; DB query plan regressed. Looping in infra.',true,'2026-07-01T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_history (id,ticket_id,actor_id,field_changed,old_value,new_value,changed_at) VALUES
('22c7d470-b8c2-529f-9cf8-b2d5791352f3','b559c0d4-9d9c-58ba-a3e0-864eef361002','fa4021fd-1b19-5f85-897f-ecfaa6cd0949','status','{"status": "open"}'::jsonb,'{"status": "in_progress"}'::jsonb,'2026-07-01T12:00:00'),
('019581db-9bb7-51e9-8be8-9203d24a27aa','5ca1c7a3-69c5-5c57-a3ae-5f781c7db572','fa4021fd-1b19-5f85-897f-ecfaa6cd0949','status','{"status": "open"}'::jsonb,'{"status": "in_progress"}'::jsonb,'2026-07-01T12:00:00'),
('33f5dc43-359d-5b1d-9ab5-4853ebe98276','46ff3af3-249e-5795-b1be-d6df1670a3d1','fa4021fd-1b19-5f85-897f-ecfaa6cd0949','status','{"status": "open"}'::jsonb,'{"status": "in_progress"}'::jsonb,'2026-07-01T12:00:00'),
('120f8ac2-fe67-5aad-b337-50e5edb0f264','f8c61aa1-5e2e-5529-a208-6a0ea774c04c','fa4021fd-1b19-5f85-897f-ecfaa6cd0949','status','{"status": "open"}'::jsonb,'{"status": "in_progress"}'::jsonb,'2026-07-01T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_tag_assignments (ticket_id,tag_id) VALUES
('b559c0d4-9d9c-58ba-a3e0-864eef361002','b968bcc6-0fb8-5a26-ab99-aa8c4b031452'),
('b559c0d4-9d9c-58ba-a3e0-864eef361002','ff904d6f-f16b-5abf-8f14-9114a37fd459'),
('fdca607f-f4e1-5427-9fa8-42456dc9a0aa','ff904d6f-f16b-5abf-8f14-9114a37fd459'),
('811b272a-e228-5c49-91d4-f841e09cb985','db0d5860-98b7-5e6e-9291-2c33b81f5410'),
('f8c61aa1-5e2e-5529-a208-6a0ea774c04c','0233256e-82fb-54d8-9af4-144b02fcb087'),
('46ff3af3-249e-5795-b1be-d6df1670a3d1','0233256e-82fb-54d8-9af4-144b02fcb087')
ON CONFLICT (ticket_id,tag_id) DO NOTHING;
INSERT INTO ticket_watchers (ticket_id,user_id) VALUES
('fdca607f-f4e1-5427-9fa8-42456dc9a0aa','10149a68-a6be-5380-ad66-e55f26d6adac'),
('6cd93bc6-5a42-53a6-9f92-35cd15f6960e','10149a68-a6be-5380-ad66-e55f26d6adac')
ON CONFLICT (ticket_id,user_id) DO NOTHING;
INSERT INTO sla_instances (id,tenant_id,ticket_id,target_id,due_at,status,breached_at,warned_pct,created_at) VALUES
('eccc4421-efcf-598d-9d14-25a9b5d81ec7','06a270ba-09fc-7752-8000-0b10a0c66562','b559c0d4-9d9c-58ba-a3e0-864eef361002','2f39f18d-7200-516e-b480-5c139e9b2a3e','2026-07-02T20:00:00','running',NULL,ARRAY[50,75],'2026-06-29T12:00:00'),
('8d8466ad-d7e6-5b5f-9329-f155c44e5f45','06a270ba-09fc-7752-8000-0b10a0c66562','fdca607f-f4e1-5427-9fa8-42456dc9a0aa','cd29f1bb-4321-5e30-bd2e-08559f9e8779','2026-07-02T20:00:00','running',NULL,ARRAY[50,75],'2026-06-29T12:00:00'),
('fb09bde3-3639-5be1-9746-aac0799704a8','06a270ba-09fc-7752-8000-0b10a0c66562','5ca1c7a3-69c5-5c57-a3ae-5f781c7db572','2f39f18d-7200-516e-b480-5c139e9b2a3e','2026-06-26T20:00:00','met',NULL,ARRAY[]::integer[],'2026-06-29T12:00:00'),
('9bc3a220-6533-5dee-a413-12b87b8ec4f8','06a270ba-09fc-7752-8000-0b10a0c66562','46ff3af3-249e-5795-b1be-d6df1670a3d1','2f39f18d-7200-516e-b480-5c139e9b2a3e','2026-06-28T20:00:00','breached','2026-06-28T21:00:00',ARRAY[50,75],'2026-06-29T12:00:00'),
('bac18394-90f8-580d-8872-9a2cf2d873a5','06a270ba-09fc-7752-8000-0b10a0c66562','811b272a-e228-5c49-91d4-f841e09cb985','370c1861-6d6e-5ae2-a9f6-d2bbfd322f56','2026-07-02T20:00:00','running',NULL,ARRAY[50,75],'2026-06-29T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_events (id,instance_id,event) VALUES
('93b7b8f6-e1ed-5729-aa97-c85c727020c3','eccc4421-efcf-598d-9d14-25a9b5d81ec7','started'),
('95a6b4c6-ae01-5702-bc45-894cf9ae69bc','eccc4421-efcf-598d-9d14-25a9b5d81ec7','warned'),
('4e55b2be-58dc-53f5-92a4-73e6c95b2126','8d8466ad-d7e6-5b5f-9329-f155c44e5f45','started'),
('c5988c63-b25d-5065-ada2-846fc94cc960','8d8466ad-d7e6-5b5f-9329-f155c44e5f45','warned'),
('73eae41c-eb5b-51ca-b440-fa786bd95025','fb09bde3-3639-5be1-9746-aac0799704a8','started'),
('e340793b-4eb2-566d-b834-f8a05f3fbe00','fb09bde3-3639-5be1-9746-aac0799704a8','warned'),
('65f26a6c-7759-5e3e-9786-7850414d3370','9bc3a220-6533-5dee-a413-12b87b8ec4f8','started'),
('2369cec1-1659-5546-ab39-1288d65dd8cc','9bc3a220-6533-5dee-a413-12b87b8ec4f8','warned'),
('3b57cdcb-e644-59e7-a444-422903ea71a8','bac18394-90f8-580d-8872-9a2cf2d873a5','started'),
('7548c351-fa25-53af-9695-80a958d13019','bac18394-90f8-580d-8872-9a2cf2d873a5','warned')
ON CONFLICT (id) DO NOTHING;
INSERT INTO severity_levels (id,tenant_id,name,rank,auto_page,required_roles) VALUES
('5d9152f5-4309-5bb0-bac7-2c9ced6f692c','06a270ba-09fc-7752-8000-0b10a0c66562','SEV1',1,true,ARRAY['ic','comms']::varchar[]),
('5c5beeec-26ad-5957-82f0-0d4d65566527','06a270ba-09fc-7752-8000-0b10a0c66562','SEV2',2,true,ARRAY['ic']::varchar[]),
('ad039688-3a32-58ac-b4c1-13b0e9f53c19','06a270ba-09fc-7752-8000-0b10a0c66562','SEV3',3,false,NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO schedules (id,tenant_id,name,team_id,timezone,rotation_type,rotation_length_hours,handoff_time,start_at,is_active) VALUES
('030f251b-a92e-5179-973c-752768ad5b75','06a270ba-09fc-7752-8000-0b10a0c66562','Primary On-Call Rotation','0d9630c6-6659-5bfe-8201-72f054986bd8','UTC','weekly',168,'10:00','2026-06-18T12:00:00',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO schedule_layers (id,schedule_id,layer_rank,participants) VALUES
('58ad5c73-291f-59dc-8baf-5924772912b6','030f251b-a92e-5179-973c-752768ad5b75',1,ARRAY['fa4021fd-1b19-5f85-897f-ecfaa6cd0949','42649ec3-42f1-5ec2-b238-8e5376c955db','211a6f18-896e-57a8-84de-e28594e57387']::uuid[])
ON CONFLICT (id) DO NOTHING;
INSERT INTO escalation_policies (id,tenant_id,name,repeat_count) VALUES
('f06c6b16-e1fd-5bf4-ab28-09ad8925f1f0','06a270ba-09fc-7752-8000-0b10a0c66562','Primary Escalation',1)
ON CONFLICT (id) DO NOTHING;
INSERT INTO escalation_steps (id,policy_id,position,target_type,target_id,timeout_minutes,notify_strategy) VALUES
('faa710ff-4ec0-554c-a22d-6a1eb20d0380','f06c6b16-e1fd-5bf4-ab28-09ad8925f1f0',1,'schedule','030f251b-a92e-5179-973c-752768ad5b75',15,'current_oncall'),
('cea2aea4-2d89-504d-8d32-bc020178f570','f06c6b16-e1fd-5bf4-ab28-09ad8925f1f0',2,'user','10149a68-a6be-5380-ad66-e55f26d6adac',30,'notify_all')
ON CONFLICT (id) DO NOTHING;
INSERT INTO oncall_services (id,tenant_id,name,description,escalation_policy_id,current_state,is_active) VALUES
('f1852f0e-5b89-5e63-9360-8f99f62496f0','06a270ba-09fc-7752-8000-0b10a0c66562','Payments API','Customer billing & payments','f06c6b16-e1fd-5bf4-ab28-09ad8925f1f0','operational',true),
('b59254e8-192d-57bc-bef2-d64dd5fd7a07','06a270ba-09fc-7752-8000-0b10a0c66562','Web Platform','Public web & portal','f06c6b16-e1fd-5bf4-ab28-09ad8925f1f0','operational',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO contact_methods (id,tenant_id,user_id,type,value,is_verified) VALUES
('ca36ce7c-98b2-57f8-80dd-39e6df09cf96','06a270ba-09fc-7752-8000-0b10a0c66562','10149a68-a6be-5380-ad66-e55f26d6adac','email','mgr@blue.demo',true),
('cc3b70e9-08d6-5c74-9cc5-adad874761d4','06a270ba-09fc-7752-8000-0b10a0c66562','fa4021fd-1b19-5f85-897f-ecfaa6cd0949','email','ag1@blue.demo',true),
('f342b6ea-b5a2-5e9f-a6f4-5d310517e5b7','06a270ba-09fc-7752-8000-0b10a0c66562','42649ec3-42f1-5ec2-b238-8e5376c955db','email','ag2@blue.demo',true),
('bb9c45e5-951d-56a1-9e04-520f2f29b17e','06a270ba-09fc-7752-8000-0b10a0c66562','211a6f18-896e-57a8-84de-e28594e57387','email','ag3@blue.demo',true),
('3d0459b3-d8c0-5adb-86a4-568058c50fb7','06a270ba-09fc-7752-8000-0b10a0c66562','10149a68-a6be-5380-ad66-e55f26d6adac','sms','+1-555-0100',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO alerts (id,tenant_id,service_id,source,dedup_key,title,payload,severity_id,status,occurrence_count,incident_id,acknowledged_at,resolved_at,created_at) VALUES
('f8b4493f-14ac-5f36-bf90-5c96be622bfc','06a270ba-09fc-7752-8000-0b10a0c66562','f1852f0e-5b89-5e63-9360-8f99f62496f0','monitor','blue-al1','payments p99 latency > 2s','{"seed": "piq-demo", "metric": "payments p99 latency > 2s"}'::jsonb,'5c5beeec-26ad-5957-82f0-0d4d65566527','open',1,NULL,NULL,NULL,'2026-07-01T11:00:00'),
('9906b76a-badf-52a4-8044-52bf845715eb','06a270ba-09fc-7752-8000-0b10a0c66562','b59254e8-192d-57bc-bef2-d64dd5fd7a07','prometheus','blue-al2','5xx error rate spike on web','{"seed": "piq-demo", "metric": "5xx error rate spike on web"}'::jsonb,'ad039688-3a32-58ac-b4c1-13b0e9f53c19','acknowledged',1,NULL,'2026-07-01T12:00:00',NULL,'2026-07-01T11:00:00'),
('d8b46981-2105-516e-b6e6-d1232d3e58ed','06a270ba-09fc-7752-8000-0b10a0c66562','f1852f0e-5b89-5e63-9360-8f99f62496f0','monitor','blue-al3','disk space low on db-primary','{"seed": "piq-demo", "metric": "disk space low on db-primary"}'::jsonb,'ad039688-3a32-58ac-b4c1-13b0e9f53c19','resolved',1,NULL,'2026-07-01T12:00:00','2026-07-01T14:00:00','2026-07-01T11:00:00'),
('9247e2ee-4fbe-59a0-8d29-ae57d4b3a5aa','06a270ba-09fc-7752-8000-0b10a0c66562','f1852f0e-5b89-5e63-9360-8f99f62496f0','prometheus','blue-al4','Payments API unavailable','{"seed": "piq-demo", "metric": "Payments API unavailable"}'::jsonb,'5c5beeec-26ad-5957-82f0-0d4d65566527','resolved',3,NULL,'2026-07-01T12:00:00','2026-07-01T14:00:00','2026-07-01T11:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO incidents (id,tenant_id,incident_number,title,description,severity_id,status,declared_by,declared_at,mitigated_at,resolved_at,affected_service_ids,source_alert_id) VALUES
('60abf60b-0389-5bb4-8f47-eb3348210c2a','06a270ba-09fc-7752-8000-0b10a0c66562','IR-2026-90001','Payments API outage','Payments API returned 503 for ~40 min affecting checkout.','5c5beeec-26ad-5957-82f0-0d4d65566527','resolved','10149a68-a6be-5380-ad66-e55f26d6adac','2026-06-27T12:00:00','2026-06-27T13:00:00','2026-06-27T14:00:00',ARRAY['f1852f0e-5b89-5e63-9360-8f99f62496f0']::uuid[],'9247e2ee-4fbe-59a0-8d29-ae57d4b3a5aa'),
('977ccc2b-5084-546c-9240-52f5666fd276','06a270ba-09fc-7752-8000-0b10a0c66562','IR-2026-90002','Elevated web error rate','Investigating a rise in 5xx responses on the web platform.','5d9152f5-4309-5bb0-bac7-2c9ced6f692c','investigating','61f83872-53ef-5718-8e6c-5ca46a3b14f4','2026-07-02T09:00:00',NULL,NULL,ARRAY['b59254e8-192d-57bc-bef2-d64dd5fd7a07']::uuid[],NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO incident_roles (id,incident_id,role,user_id) VALUES
('0a3f0bd2-355c-597f-bd37-54798e02355d','60abf60b-0389-5bb4-8f47-eb3348210c2a','ic','10149a68-a6be-5380-ad66-e55f26d6adac'),
('d63690b2-1b9e-5078-958e-6b3c0802730f','60abf60b-0389-5bb4-8f47-eb3348210c2a','comms','61f83872-53ef-5718-8e6c-5ca46a3b14f4'),
('6f9cb8b8-f5ef-5cfd-b8df-789e781d3698','60abf60b-0389-5bb4-8f47-eb3348210c2a','ops','fa4021fd-1b19-5f85-897f-ecfaa6cd0949'),
('f632e049-132d-533b-ba26-814dd8493170','60abf60b-0389-5bb4-8f47-eb3348210c2a','scribe','42649ec3-42f1-5ec2-b238-8e5376c955db'),
('fe2276d9-3b8b-545f-b081-b55829ecb5df','977ccc2b-5084-546c-9240-52f5666fd276','ic','61f83872-53ef-5718-8e6c-5ca46a3b14f4')
ON CONFLICT (id) DO NOTHING;
INSERT INTO incident_timeline (id,incident_id,actor_id,event_type,data,pinned,at) VALUES
('af399c62-88bb-5577-99e3-ad2443f6d696','60abf60b-0389-5bb4-8f47-eb3348210c2a','10149a68-a6be-5380-ad66-e55f26d6adac','declared','{"severity": "SEV2"}'::jsonb,true,'2026-06-27T12:00:00'),
('a657cc32-61b6-5581-8bd8-6d137e69f2a9','60abf60b-0389-5bb4-8f47-eb3348210c2a','10149a68-a6be-5380-ad66-e55f26d6adac','status_changed','{"to": "investigating"}'::jsonb,false,'2026-06-27T22:00:00'),
('fe0bd0c2-5dd6-517c-8824-be3fd2f47b09','60abf60b-0389-5bb4-8f47-eb3348210c2a','10149a68-a6be-5380-ad66-e55f26d6adac','status_changed','{"to": "monitoring"}'::jsonb,false,'2026-06-30T00:00:00'),
('44c3b196-788e-51d3-b618-f35743fed3b8','60abf60b-0389-5bb4-8f47-eb3348210c2a','10149a68-a6be-5380-ad66-e55f26d6adac','status_changed','{"to": "resolved"}'::jsonb,false,'2026-07-02T12:00:00'),
('88804d2f-0a05-59ad-9141-afda926e8a8a','977ccc2b-5084-546c-9240-52f5666fd276','10149a68-a6be-5380-ad66-e55f26d6adac','declared','{"severity": "SEV1"}'::jsonb,true,'2026-07-02T09:00:00'),
('e77a0f1c-ae3c-5686-beed-1af3038c07a2','977ccc2b-5084-546c-9240-52f5666fd276','10149a68-a6be-5380-ad66-e55f26d6adac','status_changed','{"to": "investigating"}'::jsonb,false,'2026-07-02T10:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO incident_status_updates (id,incident_id,body) VALUES
('f1872cef-0565-5774-ad70-d32e3c6b4965','60abf60b-0389-5bb4-8f47-eb3348210c2a','We identified a failed deploy and rolled back. Monitoring recovery.'),
('886685ce-736f-5432-99c9-9341519474c2','60abf60b-0389-5bb4-8f47-eb3348210c2a','Payments fully restored. Retrospective to follow.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO incident_retrospectives (id,incident_id,summary,contributing_factors,impact,status,published_at) VALUES
('5cd3e5c9-7f93-530c-9ea5-5708211baa72','60abf60b-0389-5bb4-8f47-eb3348210c2a','A bad config deploy took Payments API offline for ~40 minutes.','Missing canary stage; alert routing delayed by 5 min.','~1,200 failed checkouts; est. revenue impact moderate.','published','2026-06-28T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO retro_action_items (id,retro_id,description) VALUES
('b9dec5bd-1073-55b3-8610-bbf6fb117aa5','5cd3e5c9-7f93-530c-9ea5-5708211baa72','Add canary stage to payments deploy pipeline.'),
('ce3180ae-e98f-5acf-b8b1-ae3c41bdccc7','5cd3e5c9-7f93-530c-9ea5-5708211baa72','Tune alert routing to page IC within 60s.')
ON CONFLICT (id) DO NOTHING;
UPDATE alerts SET incident_id='60abf60b-0389-5bb4-8f47-eb3348210c2a' WHERE id='9247e2ee-4fbe-59a0-8d29-ae57d4b3a5aa';
INSERT INTO kb_spaces (id,tenant_id,name,description,slug,scope,is_public,is_active) VALUES
('411f6536-8d9f-56b3-bc68-7f43c92f4853','06a270ba-09fc-7752-8000-0b10a0c66562','IT Knowledge Base','Self-service help articles','blue-it-kb','tenant_wide',false,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_categories (id,space_id,name,display_order,is_active) VALUES
('1a957f56-3a5a-5f36-b0d5-398d0569d0c5','411f6536-8d9f-56b3-bc68-7f43c92f4853','How-To',1,true),
('2739f8c3-0984-54fc-b14a-e539d3988817','411f6536-8d9f-56b3-bc68-7f43c92f4853','Troubleshooting',2,true),
('770ec299-5a45-59e1-bf5e-b39ad48a5fc9','411f6536-8d9f-56b3-bc68-7f43c92f4853','Policies',3,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_tags (id,tenant_id,name) VALUES
('b829bc0b-7ae5-5714-b7c2-c950d1b891b6','06a270ba-09fc-7752-8000-0b10a0c66562','vpn'),
('359c1e4a-3695-5983-8c81-d66b19d3414d','06a270ba-09fc-7752-8000-0b10a0c66562','email'),
('c86c3675-09e3-56ac-8a50-bbb1cfd0e8e1','06a270ba-09fc-7752-8000-0b10a0c66562','printer')
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_articles (id,tenant_id,space_id,category_id,title,slug,body,excerpt,status,visibility,author_id,version,view_count,helpful_count,published_at,metadata) VALUES
('d2e1745e-2f21-5983-93e9-fed59d982127','06a270ba-09fc-7752-8000-0b10a0c66562','411f6536-8d9f-56b3-bc68-7f43c92f4853','1a957f56-3a5a-5f36-b0d5-398d0569d0c5','How to connect to the corporate VPN','blue-a1','Step 1: Install the VPN client. Step 2: Sign in with SSO. Step 3: Select the nearest gateway and connect.','Step 1: Install the VPN client. Step 2: Sign in with SSO. Step 3: Select the nea','published','internal','fa4021fd-1b19-5f85-897f-ecfaa6cd0949',1,142,30,'2026-06-22T12:00:00','{"seed": "piq-demo"}'::jsonb),
('5e4cc5f0-0054-52e3-b462-6e2bfb0bdca9','06a270ba-09fc-7752-8000-0b10a0c66562','411f6536-8d9f-56b3-bc68-7f43c92f4853','1a957f56-3a5a-5f36-b0d5-398d0569d0c5','Reset your email password','blue-a2','Use the self-service portal at /reset, verify via SMS, then set a new password meeting the policy.','Use the self-service portal at /reset, verify via SMS, then set a new password m','published','public','fa4021fd-1b19-5f85-897f-ecfaa6cd0949',1,310,88,'2026-06-22T12:00:00','{"seed": "piq-demo"}'::jsonb),
('6aa0338a-7ae9-5d71-83c5-7077179f570a','06a270ba-09fc-7752-8000-0b10a0c66562','411f6536-8d9f-56b3-bc68-7f43c92f4853','2739f8c3-0984-54fc-b14a-e539d3988817','Fixing a paper jam on floor printers','blue-a3','Open tray 2, remove jammed sheet gently, close, then resume the print job from the panel.','Open tray 2, remove jammed sheet gently, close, then resume the print job from t','published','internal','fa4021fd-1b19-5f85-897f-ecfaa6cd0949',1,58,12,'2026-06-22T12:00:00','{"seed": "piq-demo"}'::jsonb),
('b7653a90-0695-52fd-b0d4-1bff21ae3845','06a270ba-09fc-7752-8000-0b10a0c66562','411f6536-8d9f-56b3-bc68-7f43c92f4853','2739f8c3-0984-54fc-b14a-e539d3988817','Troubleshooting Outlook calendar crashes','blue-a4','Rebuild the Outlook profile, clear the calendar cache, and re-sync. Escalate if OST is corrupt.','Rebuild the Outlook profile, clear the calendar cache, and re-sync. Escalate if ','published','agents_only','fa4021fd-1b19-5f85-897f-ecfaa6cd0949',1,21,5,'2026-06-22T12:00:00','{"seed": "piq-demo"}'::jsonb),
('81c81957-0f07-503b-9d66-a5ef5a25107f','06a270ba-09fc-7752-8000-0b10a0c66562','411f6536-8d9f-56b3-bc68-7f43c92f4853','770ec299-5a45-59e1-bf5e-b39ad48a5fc9','Acceptable Use Policy','blue-a5','Company devices are for business use. Do not install unapproved software. Report incidents to IT.','Company devices are for business use. Do not install unapproved software. Report','draft','internal','fa4021fd-1b19-5f85-897f-ecfaa6cd0949',1,4,0,NULL,'{"seed": "piq-demo"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO asset_categories (id,tenant_id,name,is_active) VALUES
('f6282b7d-d357-50dd-82f0-a2606eeb2412','06a270ba-09fc-7752-8000-0b10a0c66562','Hardware',true),
('1cc9eeb5-0f3f-5c50-b5cd-897127e1aea3','06a270ba-09fc-7752-8000-0b10a0c66562','Software',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO asset_types (id,tenant_id,category_id,name) VALUES
('9c66b7c6-d762-5ecc-95c6-b11f1f1c97a6','06a270ba-09fc-7752-8000-0b10a0c66562','f6282b7d-d357-50dd-82f0-a2606eeb2412','Laptop'),
('0b4b0c63-b08c-54d5-84a5-00614802ba23','06a270ba-09fc-7752-8000-0b10a0c66562','f6282b7d-d357-50dd-82f0-a2606eeb2412','Server'),
('e97565d4-d53b-5477-b7ad-ebdc17d4e373','06a270ba-09fc-7752-8000-0b10a0c66562','1cc9eeb5-0f3f-5c50-b5cd-897127e1aea3','SaaS License')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vendors (id,tenant_id,name,contact_email,website,is_active) VALUES
('dd14cfbe-c00a-561e-ae2e-deb8e52265b0','06a270ba-09fc-7752-8000-0b10a0c66562','Dell Technologies','support@dell.demo','https://dell.demo',true),
('e45a54f1-90f3-59c1-9780-7588e7f2fbae','06a270ba-09fc-7752-8000-0b10a0c66562','Atlassian','support@atlassian.demo','https://atlassian.demo',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO assets (id,asset_tag,tenant_id,department_id,type_id,name,status,condition,serial_number,manufacturer,vendor_id,purchase_date,purchase_cost,warranty_expiry_date,assigned_to,assigned_at,metadata) VALUES
('d835ee5b-195f-5966-8c85-ba34583e62e1','AST-BLUE-001','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','9c66b7c6-d762-5ecc-95c6-b11f1f1c97a6','Latitude 7440 - Casey','in_use','good','SN-LAT-0001','Dell','dd14cfbe-c00a-561e-ae2e-deb8e52265b0','2025-01-15',1450.0,'2028-01-15','c4a01c6e-937e-56fd-bb75-bd2d038cb703','2026-06-02T12:00:00','{"seed": "piq-demo"}'::jsonb),
('7df36152-54b0-560e-9cbc-889e4fdc5dc8','AST-BLUE-002','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','9c66b7c6-d762-5ecc-95c6-b11f1f1c97a6','Latitude 7440 - Devin','in_use','good','SN-LAT-0002','Dell','dd14cfbe-c00a-561e-ae2e-deb8e52265b0','2025-01-15',1450.0,'2028-01-15','dcb5f61c-f1ad-533c-aeb7-e1c17090d269','2026-06-02T12:00:00','{"seed": "piq-demo"}'::jsonb),
('d9b0ecd6-72a8-5546-b52b-690f862c4001','AST-BLUE-003','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','9c66b7c6-d762-5ecc-95c6-b11f1f1c97a6','Latitude 5540 - Spare','in_stock','new','SN-LAT-0003','Dell','dd14cfbe-c00a-561e-ae2e-deb8e52265b0','2025-01-15',1450.0,'2028-01-15',NULL,NULL,'{"seed": "piq-demo"}'::jsonb),
('dfbfa7b0-f190-5857-8f89-9b6d0356c21b','AST-BLUE-004','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','0b4b0c63-b08c-54d5-84a5-00614802ba23','db-primary','in_use','good','SN-SRV-1001','Dell','dd14cfbe-c00a-561e-ae2e-deb8e52265b0','2025-01-15',8200.0,'2028-01-15',NULL,NULL,'{"seed": "piq-demo"}'::jsonb),
('4d074b9a-4d63-5e79-8dd4-3640fd0f5ad3','AST-BLUE-005','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','0b4b0c63-b08c-54d5-84a5-00614802ba23','web-01','in_use','good','SN-SRV-1002','Dell','dd14cfbe-c00a-561e-ae2e-deb8e52265b0','2025-01-15',8200.0,'2028-01-15',NULL,NULL,'{"seed": "piq-demo"}'::jsonb),
('7f5c6461-69ab-5c43-8c4c-bec11ec4feef','AST-BLUE-006','06a270ba-09fc-7752-8000-0b10a0c66562','abd04681-96f1-5e92-84b5-d875148f7526','e97565d4-d53b-5477-b7ad-ebdc17d4e373','Jira Software (50 seats)','in_use','new',NULL,'Atlassian','e45a54f1-90f3-59c1-9780-7588e7f2fbae','2025-01-15',5000.0,'2028-01-15',NULL,NULL,'{"seed": "piq-demo"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO asset_relationships (id,tenant_id,source_asset_id,target_asset_id,relationship_type,created_by) VALUES
('3141c177-8c05-54b3-98f9-326ac8ceb0c9','06a270ba-09fc-7752-8000-0b10a0c66562','7f5c6461-69ab-5c43-8c4c-bec11ec4feef','4d074b9a-4d63-5e79-8dd4-3640fd0f5ad3','runs_on','10149a68-a6be-5380-ad66-e55f26d6adac'),
('4479d5b4-1f17-5052-aaab-8360b587776d','06a270ba-09fc-7752-8000-0b10a0c66562','dfbfa7b0-f190-5857-8f89-9b6d0356c21b','4d074b9a-4d63-5e79-8dd4-3640fd0f5ad3','connected_to','10149a68-a6be-5380-ad66-e55f26d6adac')
ON CONFLICT (id) DO NOTHING;

-- ===== TENANT: PIQ-Client (7862dc84-72d6-40a9-b2b1-c7c7896bc148) =====
INSERT INTO users (id,iam_user_id,tenant_id,email,first_name,last_name,is_active,metadata,iam_roles,last_seen_at) VALUES
('82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','demo-piq-mgr','7862dc84-72d6-40a9-b2b1-c7c7896bc148','morgan.avery@piq.demo','Morgan','Avery',true,'{"seed": "piq-demo"}'::jsonb,'["manager"]'::jsonb,'2026-07-01T12:00:00'),
('6eb4bcd6-944f-5c20-90a5-0c9af16e2601','demo-piq-lead','7862dc84-72d6-40a9-b2b1-c7c7896bc148','riley.chen@piq.demo','Riley','Chen',true,'{"seed": "piq-demo"}'::jsonb,'["team_lead"]'::jsonb,'2026-07-01T12:00:00'),
('30be9e37-c91f-537d-895c-3656a0c3c353','demo-piq-ag1','7862dc84-72d6-40a9-b2b1-c7c7896bc148','jordan.patel@piq.demo','Jordan','Patel',true,'{"seed": "piq-demo"}'::jsonb,'["agent"]'::jsonb,'2026-07-01T12:00:00'),
('5420160e-f427-53bb-9bf8-a23ced907ba4','demo-piq-ag2','7862dc84-72d6-40a9-b2b1-c7c7896bc148','sam.nguyen@piq.demo','Sam','Nguyen',true,'{"seed": "piq-demo"}'::jsonb,'["agent"]'::jsonb,'2026-07-01T12:00:00'),
('95196733-d13c-59f3-8fcd-e713c5d325fe','demo-piq-ag3','7862dc84-72d6-40a9-b2b1-c7c7896bc148','taylor.okafor@piq.demo','Taylor','Okafor',true,'{"seed": "piq-demo"}'::jsonb,'["agent"]'::jsonb,'2026-07-01T12:00:00'),
('0a063b29-68a4-5172-91f6-7fbc1e3ee2d6','demo-piq-eu1','7862dc84-72d6-40a9-b2b1-c7c7896bc148','casey.brooks@piq.demo','Casey','Brooks',true,'{"seed": "piq-demo"}'::jsonb,'["end_user"]'::jsonb,'2026-07-01T12:00:00'),
('6d596769-c2cc-5494-979f-f1ec86dce78a','demo-piq-eu2','7862dc84-72d6-40a9-b2b1-c7c7896bc148','devin.flores@piq.demo','Devin','Flores',true,'{"seed": "piq-demo"}'::jsonb,'["end_user"]'::jsonb,'2026-07-01T12:00:00'),
('232b0f85-e9dd-540c-8a48-6c70af135963','demo-piq-eu3','7862dc84-72d6-40a9-b2b1-c7c7896bc148','alex.romano@piq.demo','Alex','Romano',true,'{"seed": "piq-demo"}'::jsonb,'["end_user"]'::jsonb,'2026-07-01T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO user_itsm_roles (user_id,role_id,tenant_id) VALUES
('82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','302afd7f-8c70-47e3-96f7-f2942652f8f3','7862dc84-72d6-40a9-b2b1-c7c7896bc148'),
('6eb4bcd6-944f-5c20-90a5-0c9af16e2601','e16363a0-d237-4b7d-b19d-305a7d85afa6','7862dc84-72d6-40a9-b2b1-c7c7896bc148'),
('30be9e37-c91f-537d-895c-3656a0c3c353','1da49bee-2bfc-4c49-92f8-4819fe966f5b','7862dc84-72d6-40a9-b2b1-c7c7896bc148'),
('5420160e-f427-53bb-9bf8-a23ced907ba4','1da49bee-2bfc-4c49-92f8-4819fe966f5b','7862dc84-72d6-40a9-b2b1-c7c7896bc148'),
('95196733-d13c-59f3-8fcd-e713c5d325fe','1da49bee-2bfc-4c49-92f8-4819fe966f5b','7862dc84-72d6-40a9-b2b1-c7c7896bc148'),
('0a063b29-68a4-5172-91f6-7fbc1e3ee2d6','52dd610c-24f8-47ed-8b6a-84181200955b','7862dc84-72d6-40a9-b2b1-c7c7896bc148'),
('6d596769-c2cc-5494-979f-f1ec86dce78a','52dd610c-24f8-47ed-8b6a-84181200955b','7862dc84-72d6-40a9-b2b1-c7c7896bc148'),
('232b0f85-e9dd-540c-8a48-6c70af135963','52dd610c-24f8-47ed-8b6a-84181200955b','7862dc84-72d6-40a9-b2b1-c7c7896bc148')
ON CONFLICT (user_id,role_id) DO NOTHING;
INSERT INTO departments (id,tenant_id,name,description,is_active) VALUES
('8aa752af-92dd-5584-8e0e-abf4a230ba8d','7862dc84-72d6-40a9-b2b1-c7c7896bc148','IT','Information Technology',true),
('412f3f0b-014c-55a3-a606-07e0960bede2','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Operations','Business Operations',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id,tenant_id,name,description,lead_id) VALUES
('b36bddda-9ebf-5cbc-b5bd-79af898fb4df','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Service Desk','First-line support','6eb4bcd6-944f-5c20-90a5-0c9af16e2601'),
('f301105e-96ff-5a0b-8543-883f155dfec3','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Infrastructure','Servers, network & cloud','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049')
ON CONFLICT (id) DO NOTHING;
INSERT INTO team_members (team_id,user_id) VALUES
('b36bddda-9ebf-5cbc-b5bd-79af898fb4df','30be9e37-c91f-537d-895c-3656a0c3c353'),
('b36bddda-9ebf-5cbc-b5bd-79af898fb4df','5420160e-f427-53bb-9bf8-a23ced907ba4'),
('b36bddda-9ebf-5cbc-b5bd-79af898fb4df','6eb4bcd6-944f-5c20-90a5-0c9af16e2601'),
('f301105e-96ff-5a0b-8543-883f155dfec3','95196733-d13c-59f3-8fcd-e713c5d325fe'),
('f301105e-96ff-5a0b-8543-883f155dfec3','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049')
ON CONFLICT (team_id,user_id) DO NOTHING;
INSERT INTO coverage_windows (id,tenant_id,name,timezone,is_247,work_days,windows) VALUES
('0c4ab3d7-1a0b-5a77-9bc7-7c207a73d08b','7862dc84-72d6-40a9-b2b1-c7c7896bc148','24x7','UTC',true,ARRAY[1,2,3,4,5,6,7],NULL),
('d649bf47-eb9c-5799-90a4-ce393a97b57c','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Business Hours (Mon-Fri 9-6)','UTC',false,ARRAY[1,2,3,4,5],'[{"day": 1, "start": "09:00", "end": "18:00"}, {"day": 2, "start": "09:00", "end": "18:00"}, {"day": 3, "start": "09:00", "end": "18:00"}, {"day": 4, "start": "09:00", "end": "18:00"}, {"day": 5, "start": "09:00", "end": "18:00"}]'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_agreements (id,tenant_id,name,kind,description,owner_team_id,is_active) VALUES
('cb03a313-a706-586a-9314-7bcd0961d256','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Standard Support SLA','sla','Default customer SLA','b36bddda-9ebf-5cbc-b5bd-79af898fb4df',true),
('56c35810-0366-5f43-b1f0-caf9a4c38029','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Premium SLA','sla','Priority customers','b36bddda-9ebf-5cbc-b5bd-79af898fb4df',true),
('64e395b1-249f-5c00-a0b5-2be326fd9ba6','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Infrastructure OLA','ola','Internal infra underpinning','f301105e-96ff-5a0b-8543-883f155dfec3',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_targets (id,tenant_id,agreement_id,metric,duration_minutes,coverage_window_id,applies_priority,warn_thresholds_pct) VALUES
('7aa2cf26-02a7-58c2-8aac-981e11f020bd','7862dc84-72d6-40a9-b2b1-c7c7896bc148','cb03a313-a706-586a-9314-7bcd0961d256','first_response',60,'d649bf47-eb9c-5799-90a4-ce393a97b57c','high',ARRAY[50,75,90]),
('2b7434c2-fc5a-5c3f-a91d-4489b9011ad9','7862dc84-72d6-40a9-b2b1-c7c7896bc148','cb03a313-a706-586a-9314-7bcd0961d256','resolution',480,'d649bf47-eb9c-5799-90a4-ce393a97b57c',NULL,ARRAY[50,75,90]),
('c1c7c450-a61e-5824-8ad8-959ceea9bb8c','7862dc84-72d6-40a9-b2b1-c7c7896bc148','56c35810-0366-5f43-b1f0-caf9a4c38029','first_response',15,'0c4ab3d7-1a0b-5a77-9bc7-7c207a73d08b','critical',ARRAY[50,75,90]),
('9133daa2-2888-5d90-9536-0dd1591354a6','7862dc84-72d6-40a9-b2b1-c7c7896bc148','56c35810-0366-5f43-b1f0-caf9a4c38029','resolution',240,'0c4ab3d7-1a0b-5a77-9bc7-7c207a73d08b',NULL,ARRAY[50,75,90]),
('ce0ff332-cbb1-5a99-b696-da2715dff1ba','7862dc84-72d6-40a9-b2b1-c7c7896bc148','64e395b1-249f-5c00-a0b5-2be326fd9ba6','time_to_mitigate',120,'0c4ab3d7-1a0b-5a77-9bc7-7c207a73d08b',NULL,ARRAY[50,90])
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_rules (id,tenant_id,position,conditions,agreement_id,is_active) VALUES
('f238464a-f95e-58fa-97c5-dbec8b6cc8a4','7862dc84-72d6-40a9-b2b1-c7c7896bc148',1,'{"priority": ["critical"]}'::jsonb,'56c35810-0366-5f43-b1f0-caf9a4c38029',true),
('5c20a07c-2eb4-5073-be91-c86bedd7aeb0','7862dc84-72d6-40a9-b2b1-c7c7896bc148',2,'{}'::jsonb,'cb03a313-a706-586a-9314-7bcd0961d256',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_categories (id,tenant_id,name,is_active,default_team_id) VALUES
('575ca45c-24c1-5250-8896-73e523a8d5fc','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Hardware',true,'b36bddda-9ebf-5cbc-b5bd-79af898fb4df'),
('06e522d7-3548-5b9e-bbc7-fed89e0996a6','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Software',true,'b36bddda-9ebf-5cbc-b5bd-79af898fb4df'),
('978a1a08-ed7b-584e-ae72-fb5a6f59b06d','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Network',true,'f301105e-96ff-5a0b-8543-883f155dfec3'),
('fd4bb660-15ae-5dde-ab99-5dd7c20a104e','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Access Request',true,'b36bddda-9ebf-5cbc-b5bd-79af898fb4df')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_tags (id,tenant_id,name,color) VALUES
('c065baee-d07e-5909-8281-19870ec29a39','7862dc84-72d6-40a9-b2b1-c7c7896bc148','vip','#e11d48'),
('2fb0786e-5d75-58e5-9179-860b201fb690','7862dc84-72d6-40a9-b2b1-c7c7896bc148','recurring','#f59e0b'),
('64bc1216-43e7-5029-8b7e-4e4462090665','7862dc84-72d6-40a9-b2b1-c7c7896bc148','hardware','#3b82f6'),
('3d6090b8-1282-5215-a792-71d661a41505','7862dc84-72d6-40a9-b2b1-c7c7896bc148','urgent','#dc2626')
ON CONFLICT (tenant_id,name) DO NOTHING;
INSERT INTO tickets (id,ticket_number,tenant_id,department_id,type,status,priority,title,description,requester_id,assignee_id,team_id,category_id,sla_response_due,sla_resolve_due,sla_breached,resolved_at,closed_at,created_at,metadata) VALUES
('dbaa5a10-bba0-5c94-9cd8-6946dda2800d','90011','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','incident','in_progress','high','Laptop won''t boot after update','Laptop won''t boot after update. Reported by user; see comments for detail.','0a063b29-68a4-5172-91f6-7fbc1e3ee2d6','30be9e37-c91f-537d-895c-3656a0c3c353','b36bddda-9ebf-5cbc-b5bd-79af898fb4df','575ca45c-24c1-5250-8896-73e523a8d5fc','2026-06-30T13:00:00','2026-06-30T20:00:00',false,NULL,NULL,'2026-06-30T12:00:00','{"seed": "piq-demo"}'::jsonb),
('2a7e4be0-cd95-5e84-ba23-6761ec90df56','90012','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','incident','open','critical','Office VPN down for remote staff','Office VPN down for remote staff. Reported by user; see comments for detail.','6d596769-c2cc-5494-979f-f1ec86dce78a','95196733-d13c-59f3-8fcd-e713c5d325fe','f301105e-96ff-5a0b-8543-883f155dfec3','978a1a08-ed7b-584e-ae72-fb5a6f59b06d','2026-07-02T13:00:00','2026-07-02T20:00:00',false,NULL,NULL,'2026-07-02T12:00:00','{"seed": "piq-demo"}'::jsonb),
('9cc7dbaa-e3ad-587e-b9c0-ce5247c057c0','90013','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','service_request','open','medium','New starter access to shared drive','New starter access to shared drive. Reported by user; see comments for detail.','232b0f85-e9dd-540c-8a48-6c70af135963','5420160e-f427-53bb-9bf8-a23ced907ba4','b36bddda-9ebf-5cbc-b5bd-79af898fb4df','fd4bb660-15ae-5dde-ab99-5dd7c20a104e','2026-07-01T13:00:00','2026-07-01T20:00:00',false,NULL,NULL,'2026-07-01T12:00:00','{"seed": "piq-demo"}'::jsonb),
('88e3d683-4479-54cb-a29c-347c6c5fdcf4','90014','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','incident','resolved','medium','Outlook crashes when opening calendar','Outlook crashes when opening calendar. Reported by user; see comments for detail.','0a063b29-68a4-5172-91f6-7fbc1e3ee2d6','30be9e37-c91f-537d-895c-3656a0c3c353','b36bddda-9ebf-5cbc-b5bd-79af898fb4df','06e522d7-3548-5b9e-bbc7-fed89e0996a6','2026-06-26T13:00:00','2026-06-26T20:00:00',false,'2026-06-26T17:00:00',NULL,'2026-06-26T12:00:00','{"seed": "piq-demo"}'::jsonb),
('47c4fafd-dda8-5b69-8649-eca39f82e0af','90015','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','problem','in_progress','high','Intermittent packet loss on 3rd floor','Intermittent packet loss on 3rd floor. Reported by user; see comments for detail.','6d596769-c2cc-5494-979f-f1ec86dce78a','95196733-d13c-59f3-8fcd-e713c5d325fe','f301105e-96ff-5a0b-8543-883f155dfec3','978a1a08-ed7b-584e-ae72-fb5a6f59b06d','2026-06-28T13:00:00','2026-06-28T20:00:00',false,NULL,NULL,'2026-06-28T12:00:00','{"seed": "piq-demo"}'::jsonb),
('d4ee6711-6989-54af-8f7f-924a7310f37c','90016','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','service_request','closed','low','Request second monitor','Request second monitor. Reported by user; see comments for detail.','232b0f85-e9dd-540c-8a48-6c70af135963','5420160e-f427-53bb-9bf8-a23ced907ba4','b36bddda-9ebf-5cbc-b5bd-79af898fb4df','575ca45c-24c1-5250-8896-73e523a8d5fc','2026-06-23T13:00:00','2026-06-23T20:00:00',false,'2026-06-23T17:00:00','2026-06-23T18:00:00','2026-06-23T12:00:00','{"seed": "piq-demo"}'::jsonb),
('6a4ac366-ba61-5818-b061-8129e3112335','90017','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','change','pending_approval','medium','Upgrade CRM to v12 (change request)','Upgrade CRM to v12 (change request). Reported by user; see comments for detail.','6eb4bcd6-944f-5c20-90a5-0c9af16e2601','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','f301105e-96ff-5a0b-8543-883f155dfec3','06e522d7-3548-5b9e-bbc7-fed89e0996a6','2026-06-29T13:00:00','2026-06-29T20:00:00',false,NULL,NULL,'2026-06-29T12:00:00','{"seed": "piq-demo"}'::jsonb),
('d6799ea6-4fad-5dce-a102-15696825b082','90018','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','incident','pending','high','Payroll app slow at month end','Payroll app slow at month end. Reported by user; see comments for detail.','0a063b29-68a4-5172-91f6-7fbc1e3ee2d6','5420160e-f427-53bb-9bf8-a23ced907ba4','b36bddda-9ebf-5cbc-b5bd-79af898fb4df','06e522d7-3548-5b9e-bbc7-fed89e0996a6','2026-07-01T13:00:00','2026-07-01T20:00:00',false,NULL,NULL,'2026-07-01T12:00:00','{"seed": "piq-demo"}'::jsonb),
('52f2b6b7-dae1-5037-8677-73eae9ffaa63','90019','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','incident','resolved','low','Printer on 2nd floor jamming','Printer on 2nd floor jamming. Reported by user; see comments for detail.','6d596769-c2cc-5494-979f-f1ec86dce78a','30be9e37-c91f-537d-895c-3656a0c3c353','b36bddda-9ebf-5cbc-b5bd-79af898fb4df','575ca45c-24c1-5250-8896-73e523a8d5fc','2026-06-25T13:00:00','2026-06-25T20:00:00',false,'2026-06-25T17:00:00',NULL,'2026-06-25T12:00:00','{"seed": "piq-demo"}'::jsonb),
('d9611611-f119-54d9-85da-e026eda11ff7','90020','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','service_request','open','medium','VPN access for contractor','VPN access for contractor. Reported by user; see comments for detail.','232b0f85-e9dd-540c-8a48-6c70af135963','5420160e-f427-53bb-9bf8-a23ced907ba4','b36bddda-9ebf-5cbc-b5bd-79af898fb4df','fd4bb660-15ae-5dde-ab99-5dd7c20a104e','2026-07-02T13:00:00','2026-07-02T20:00:00',false,NULL,NULL,'2026-07-02T12:00:00','{"seed": "piq-demo"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_comments (id,ticket_id,author_id,body,is_internal,created_at) VALUES
('b42977b1-7531-50c3-bfc5-c5e466286f26','dbaa5a10-bba0-5c94-9cd8-6946dda2800d','30be9e37-c91f-537d-895c-3656a0c3c353','Confirmed the device is stuck on the update screen. Trying safe boot.',true,'2026-07-01T12:00:00'),
('2b89b79e-79d1-598c-abd5-4cf78b5cccae','dbaa5a10-bba0-5c94-9cd8-6946dda2800d','0a063b29-68a4-5172-91f6-7fbc1e3ee2d6','Thanks, let me know if you need me to bring it in.',false,'2026-07-01T12:00:00'),
('0e3346ca-c30b-5c4f-b2b5-67a4a6720991','2a7e4be0-cd95-5e84-ba23-6761ec90df56','95196733-d13c-59f3-8fcd-e713c5d325fe','Escalating to infra — core VPN concentrator is unreachable.',true,'2026-07-01T12:00:00'),
('6a893d48-edde-5cb4-870d-ad489ee60b53','88e3d683-4479-54cb-a29c-347c6c5fdcf4','30be9e37-c91f-537d-895c-3656a0c3c353','Rebuilt the Outlook profile; calendar opens normally now.',false,'2026-07-01T12:00:00'),
('0cf4aac4-cd6e-5930-88ff-5a4438852392','47c4fafd-dda8-5b69-8649-eca39f82e0af','95196733-d13c-59f3-8fcd-e713c5d325fe','Captured pcap; suspecting a faulty switch port. Investigating.',true,'2026-07-01T12:00:00'),
('c8c8805f-b93c-5948-a0e2-bed6e592afcd','d6799ea6-4fad-5dce-a102-15696825b082','5420160e-f427-53bb-9bf8-a23ced907ba4','Reproduced the slowness; DB query plan regressed. Looping in infra.',true,'2026-07-01T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_history (id,ticket_id,actor_id,field_changed,old_value,new_value,changed_at) VALUES
('c0a739f8-29ed-5172-a248-0a5900e07817','dbaa5a10-bba0-5c94-9cd8-6946dda2800d','30be9e37-c91f-537d-895c-3656a0c3c353','status','{"status": "open"}'::jsonb,'{"status": "in_progress"}'::jsonb,'2026-07-01T12:00:00'),
('5d15c62c-12be-50c9-a74f-0ddb8a3b45ae','88e3d683-4479-54cb-a29c-347c6c5fdcf4','30be9e37-c91f-537d-895c-3656a0c3c353','status','{"status": "open"}'::jsonb,'{"status": "in_progress"}'::jsonb,'2026-07-01T12:00:00'),
('3163c5bd-a115-5a81-8ad6-51c7e38d4762','47c4fafd-dda8-5b69-8649-eca39f82e0af','30be9e37-c91f-537d-895c-3656a0c3c353','status','{"status": "open"}'::jsonb,'{"status": "in_progress"}'::jsonb,'2026-07-01T12:00:00'),
('01701625-2ab7-58b8-afcf-05e42d635571','52f2b6b7-dae1-5037-8677-73eae9ffaa63','30be9e37-c91f-537d-895c-3656a0c3c353','status','{"status": "open"}'::jsonb,'{"status": "in_progress"}'::jsonb,'2026-07-01T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_tag_assignments (ticket_id,tag_id) VALUES
('dbaa5a10-bba0-5c94-9cd8-6946dda2800d','64bc1216-43e7-5029-8b7e-4e4462090665'),
('dbaa5a10-bba0-5c94-9cd8-6946dda2800d','3d6090b8-1282-5215-a792-71d661a41505'),
('2a7e4be0-cd95-5e84-ba23-6761ec90df56','3d6090b8-1282-5215-a792-71d661a41505'),
('d6799ea6-4fad-5dce-a102-15696825b082','c065baee-d07e-5909-8281-19870ec29a39'),
('52f2b6b7-dae1-5037-8677-73eae9ffaa63','2fb0786e-5d75-58e5-9179-860b201fb690'),
('47c4fafd-dda8-5b69-8649-eca39f82e0af','2fb0786e-5d75-58e5-9179-860b201fb690')
ON CONFLICT (ticket_id,tag_id) DO NOTHING;
INSERT INTO ticket_watchers (ticket_id,user_id) VALUES
('2a7e4be0-cd95-5e84-ba23-6761ec90df56','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049'),
('6a4ac366-ba61-5818-b061-8129e3112335','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049')
ON CONFLICT (ticket_id,user_id) DO NOTHING;
INSERT INTO sla_instances (id,tenant_id,ticket_id,target_id,due_at,status,breached_at,warned_pct,created_at) VALUES
('8ddfc962-fcd2-55fd-8c31-175c2470815b','7862dc84-72d6-40a9-b2b1-c7c7896bc148','dbaa5a10-bba0-5c94-9cd8-6946dda2800d','2b7434c2-fc5a-5c3f-a91d-4489b9011ad9','2026-07-02T20:00:00','running',NULL,ARRAY[50,75],'2026-06-29T12:00:00'),
('e03ab28a-4e6c-5ac5-8570-5dc8571a3178','7862dc84-72d6-40a9-b2b1-c7c7896bc148','2a7e4be0-cd95-5e84-ba23-6761ec90df56','9133daa2-2888-5d90-9536-0dd1591354a6','2026-07-02T20:00:00','running',NULL,ARRAY[50,75],'2026-06-29T12:00:00'),
('2f17d99e-07cb-54ec-932b-f74922db39d7','7862dc84-72d6-40a9-b2b1-c7c7896bc148','88e3d683-4479-54cb-a29c-347c6c5fdcf4','2b7434c2-fc5a-5c3f-a91d-4489b9011ad9','2026-06-26T20:00:00','met',NULL,ARRAY[]::integer[],'2026-06-29T12:00:00'),
('53cc86b1-bf0d-5919-ae3f-64275c9d5734','7862dc84-72d6-40a9-b2b1-c7c7896bc148','47c4fafd-dda8-5b69-8649-eca39f82e0af','2b7434c2-fc5a-5c3f-a91d-4489b9011ad9','2026-06-28T20:00:00','breached','2026-06-28T21:00:00',ARRAY[50,75],'2026-06-29T12:00:00'),
('8637973f-0454-5a5e-bd5f-af64e29cbce8','7862dc84-72d6-40a9-b2b1-c7c7896bc148','d6799ea6-4fad-5dce-a102-15696825b082','7aa2cf26-02a7-58c2-8aac-981e11f020bd','2026-07-02T20:00:00','running',NULL,ARRAY[50,75],'2026-06-29T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_events (id,instance_id,event) VALUES
('dacb0e84-1d2a-5005-af40-388bbb49bda5','8ddfc962-fcd2-55fd-8c31-175c2470815b','started'),
('7d509ca5-23d2-530f-b79b-98329ee201fa','8ddfc962-fcd2-55fd-8c31-175c2470815b','warned'),
('ca51fbb0-3ec8-5ad9-8501-75c080c24b50','e03ab28a-4e6c-5ac5-8570-5dc8571a3178','started'),
('c930d6c5-38b2-5fcf-9ea8-c92741df0cfe','e03ab28a-4e6c-5ac5-8570-5dc8571a3178','warned'),
('e33260f2-c050-5d2a-8d62-341d8ca50c61','2f17d99e-07cb-54ec-932b-f74922db39d7','started'),
('e3d8a9a6-999b-541a-b45b-f23f4de2093c','2f17d99e-07cb-54ec-932b-f74922db39d7','warned'),
('ce2146db-767b-56d9-b787-0a01261fef16','53cc86b1-bf0d-5919-ae3f-64275c9d5734','started'),
('30444f4c-3397-534d-a2fc-d9d346625f2b','53cc86b1-bf0d-5919-ae3f-64275c9d5734','warned'),
('d140f85e-f030-59f9-9762-72b0ff9c2a60','8637973f-0454-5a5e-bd5f-af64e29cbce8','started'),
('0c34c03b-355d-5706-b1bd-087399073def','8637973f-0454-5a5e-bd5f-af64e29cbce8','warned')
ON CONFLICT (id) DO NOTHING;
INSERT INTO severity_levels (id,tenant_id,name,rank,auto_page,required_roles) VALUES
('be414578-792c-542b-b63c-9066f8dcee99','7862dc84-72d6-40a9-b2b1-c7c7896bc148','SEV1',1,true,ARRAY['ic','comms']::varchar[]),
('e02b4e58-bbec-5d94-9ef6-40c530cb53da','7862dc84-72d6-40a9-b2b1-c7c7896bc148','SEV2',2,true,ARRAY['ic']::varchar[]),
('f2b0065d-a787-5ec0-b12b-d156b49b239a','7862dc84-72d6-40a9-b2b1-c7c7896bc148','SEV3',3,false,NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO schedules (id,tenant_id,name,team_id,timezone,rotation_type,rotation_length_hours,handoff_time,start_at,is_active) VALUES
('7b3723bd-ed76-53a4-8d17-abc758bdbe62','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Primary On-Call Rotation','f301105e-96ff-5a0b-8543-883f155dfec3','UTC','weekly',168,'10:00','2026-06-18T12:00:00',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO schedule_layers (id,schedule_id,layer_rank,participants) VALUES
('37a2f77f-eccd-5818-b001-a6ee1c7f013a','7b3723bd-ed76-53a4-8d17-abc758bdbe62',1,ARRAY['30be9e37-c91f-537d-895c-3656a0c3c353','5420160e-f427-53bb-9bf8-a23ced907ba4','95196733-d13c-59f3-8fcd-e713c5d325fe']::uuid[])
ON CONFLICT (id) DO NOTHING;
INSERT INTO escalation_policies (id,tenant_id,name,repeat_count) VALUES
('77f5872d-ac96-5c5b-81d9-0c268173eddc','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Primary Escalation',1)
ON CONFLICT (id) DO NOTHING;
INSERT INTO escalation_steps (id,policy_id,position,target_type,target_id,timeout_minutes,notify_strategy) VALUES
('095600a6-8626-5c41-860b-1baff0eff861','77f5872d-ac96-5c5b-81d9-0c268173eddc',1,'schedule','7b3723bd-ed76-53a4-8d17-abc758bdbe62',15,'current_oncall'),
('3a496be9-5b70-58b8-8c50-a6d7bd331d45','77f5872d-ac96-5c5b-81d9-0c268173eddc',2,'user','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049',30,'notify_all')
ON CONFLICT (id) DO NOTHING;
INSERT INTO oncall_services (id,tenant_id,name,description,escalation_policy_id,current_state,is_active) VALUES
('2b1e0ca4-ef22-55d8-994c-8849003e4070','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Payments API','Customer billing & payments','77f5872d-ac96-5c5b-81d9-0c268173eddc','operational',true),
('f211d896-be23-534a-9aaa-a991e72d180e','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Web Platform','Public web & portal','77f5872d-ac96-5c5b-81d9-0c268173eddc','operational',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO contact_methods (id,tenant_id,user_id,type,value,is_verified) VALUES
('12f15be7-3ebc-518a-a694-59f1f1b177b5','7862dc84-72d6-40a9-b2b1-c7c7896bc148','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','email','mgr@piq.demo',true),
('2dd09223-8c38-5c42-9a1a-05877be9c619','7862dc84-72d6-40a9-b2b1-c7c7896bc148','30be9e37-c91f-537d-895c-3656a0c3c353','email','ag1@piq.demo',true),
('b0ebfd95-2969-50a4-ab50-3b58fbc753e7','7862dc84-72d6-40a9-b2b1-c7c7896bc148','5420160e-f427-53bb-9bf8-a23ced907ba4','email','ag2@piq.demo',true),
('2c76be42-eb06-5d86-b548-6ee8fe493580','7862dc84-72d6-40a9-b2b1-c7c7896bc148','95196733-d13c-59f3-8fcd-e713c5d325fe','email','ag3@piq.demo',true),
('cc8841f2-a269-5fff-a7cd-7afee8d3d221','7862dc84-72d6-40a9-b2b1-c7c7896bc148','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','sms','+1-555-0100',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO alerts (id,tenant_id,service_id,source,dedup_key,title,payload,severity_id,status,occurrence_count,incident_id,acknowledged_at,resolved_at,created_at) VALUES
('6b23ddab-0e33-5543-8492-ce65918d1a53','7862dc84-72d6-40a9-b2b1-c7c7896bc148','2b1e0ca4-ef22-55d8-994c-8849003e4070','monitor','piq-al1','payments p99 latency > 2s','{"seed": "piq-demo", "metric": "payments p99 latency > 2s"}'::jsonb,'e02b4e58-bbec-5d94-9ef6-40c530cb53da','open',1,NULL,NULL,NULL,'2026-07-01T11:00:00'),
('e26a010b-3216-599d-a6e8-90a4a399991a','7862dc84-72d6-40a9-b2b1-c7c7896bc148','f211d896-be23-534a-9aaa-a991e72d180e','prometheus','piq-al2','5xx error rate spike on web','{"seed": "piq-demo", "metric": "5xx error rate spike on web"}'::jsonb,'f2b0065d-a787-5ec0-b12b-d156b49b239a','acknowledged',1,NULL,'2026-07-01T12:00:00',NULL,'2026-07-01T11:00:00'),
('7e06fcab-bbd2-50da-9f9a-37c626ac2789','7862dc84-72d6-40a9-b2b1-c7c7896bc148','2b1e0ca4-ef22-55d8-994c-8849003e4070','monitor','piq-al3','disk space low on db-primary','{"seed": "piq-demo", "metric": "disk space low on db-primary"}'::jsonb,'f2b0065d-a787-5ec0-b12b-d156b49b239a','resolved',1,NULL,'2026-07-01T12:00:00','2026-07-01T14:00:00','2026-07-01T11:00:00'),
('d563261c-64fb-5471-a96c-437ba345ae6a','7862dc84-72d6-40a9-b2b1-c7c7896bc148','2b1e0ca4-ef22-55d8-994c-8849003e4070','prometheus','piq-al4','Payments API unavailable','{"seed": "piq-demo", "metric": "Payments API unavailable"}'::jsonb,'e02b4e58-bbec-5d94-9ef6-40c530cb53da','resolved',3,NULL,'2026-07-01T12:00:00','2026-07-01T14:00:00','2026-07-01T11:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO incidents (id,tenant_id,incident_number,title,description,severity_id,status,declared_by,declared_at,mitigated_at,resolved_at,affected_service_ids,source_alert_id) VALUES
('a2aa2d56-4304-5e5e-8b1a-0c60effeb1aa','7862dc84-72d6-40a9-b2b1-c7c7896bc148','IR-2026-90003','Payments API outage','Payments API returned 503 for ~40 min affecting checkout.','e02b4e58-bbec-5d94-9ef6-40c530cb53da','resolved','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','2026-06-27T12:00:00','2026-06-27T13:00:00','2026-06-27T14:00:00',ARRAY['2b1e0ca4-ef22-55d8-994c-8849003e4070']::uuid[],'d563261c-64fb-5471-a96c-437ba345ae6a'),
('bea17389-1a68-5a9f-acd0-e768722742f3','7862dc84-72d6-40a9-b2b1-c7c7896bc148','IR-2026-90004','Elevated web error rate','Investigating a rise in 5xx responses on the web platform.','be414578-792c-542b-b63c-9066f8dcee99','investigating','6eb4bcd6-944f-5c20-90a5-0c9af16e2601','2026-07-02T09:00:00',NULL,NULL,ARRAY['f211d896-be23-534a-9aaa-a991e72d180e']::uuid[],NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO incident_roles (id,incident_id,role,user_id) VALUES
('c0bb9ffd-7b49-5c12-9bf5-2129a30d207d','a2aa2d56-4304-5e5e-8b1a-0c60effeb1aa','ic','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049'),
('57a79d3e-3ae1-585e-bc2e-a5743e3354ac','a2aa2d56-4304-5e5e-8b1a-0c60effeb1aa','comms','6eb4bcd6-944f-5c20-90a5-0c9af16e2601'),
('f0dd0aeb-0f6b-5548-b0e6-7072a304664d','a2aa2d56-4304-5e5e-8b1a-0c60effeb1aa','ops','30be9e37-c91f-537d-895c-3656a0c3c353'),
('65bfe891-6bc8-5923-8916-dcbe5e398cc1','a2aa2d56-4304-5e5e-8b1a-0c60effeb1aa','scribe','5420160e-f427-53bb-9bf8-a23ced907ba4'),
('ef36939d-0954-5074-b83c-fbd5be4d7baa','bea17389-1a68-5a9f-acd0-e768722742f3','ic','6eb4bcd6-944f-5c20-90a5-0c9af16e2601')
ON CONFLICT (id) DO NOTHING;
INSERT INTO incident_timeline (id,incident_id,actor_id,event_type,data,pinned,at) VALUES
('a6e1c4b3-ca63-5cab-af63-04cbaa7fdf3d','a2aa2d56-4304-5e5e-8b1a-0c60effeb1aa','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','declared','{"severity": "SEV2"}'::jsonb,true,'2026-06-27T12:00:00'),
('602b47d5-6150-5a03-ac67-563c2109d054','a2aa2d56-4304-5e5e-8b1a-0c60effeb1aa','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','status_changed','{"to": "investigating"}'::jsonb,false,'2026-06-27T22:00:00'),
('9d3f1fe5-5971-5777-9711-0b92a2099eb3','a2aa2d56-4304-5e5e-8b1a-0c60effeb1aa','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','status_changed','{"to": "monitoring"}'::jsonb,false,'2026-06-30T00:00:00'),
('3b004e9a-7fdf-57d7-ad8f-50e6978a7691','a2aa2d56-4304-5e5e-8b1a-0c60effeb1aa','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','status_changed','{"to": "resolved"}'::jsonb,false,'2026-07-02T12:00:00'),
('85c49c65-97bf-55f5-aaf4-1869e64b06df','bea17389-1a68-5a9f-acd0-e768722742f3','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','declared','{"severity": "SEV1"}'::jsonb,true,'2026-07-02T09:00:00'),
('ad1c326a-88e8-5714-ba3c-ba5b41a74fa3','bea17389-1a68-5a9f-acd0-e768722742f3','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049','status_changed','{"to": "investigating"}'::jsonb,false,'2026-07-02T10:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO incident_status_updates (id,incident_id,body) VALUES
('1d8e952f-0a35-5258-ba3a-d99dbeb79f01','a2aa2d56-4304-5e5e-8b1a-0c60effeb1aa','We identified a failed deploy and rolled back. Monitoring recovery.'),
('70cd23dc-4c33-59f2-b0c6-d65b834b6842','a2aa2d56-4304-5e5e-8b1a-0c60effeb1aa','Payments fully restored. Retrospective to follow.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO incident_retrospectives (id,incident_id,summary,contributing_factors,impact,status,published_at) VALUES
('ee98f3e1-d85f-5e21-b675-60a9aa040540','a2aa2d56-4304-5e5e-8b1a-0c60effeb1aa','A bad config deploy took Payments API offline for ~40 minutes.','Missing canary stage; alert routing delayed by 5 min.','~1,200 failed checkouts; est. revenue impact moderate.','published','2026-06-28T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO retro_action_items (id,retro_id,description) VALUES
('28d5f4b6-5958-5d14-a0b6-673bfa7db487','ee98f3e1-d85f-5e21-b675-60a9aa040540','Add canary stage to payments deploy pipeline.'),
('260dddb6-e7fd-5f2a-af63-5f1333814224','ee98f3e1-d85f-5e21-b675-60a9aa040540','Tune alert routing to page IC within 60s.')
ON CONFLICT (id) DO NOTHING;
UPDATE alerts SET incident_id='a2aa2d56-4304-5e5e-8b1a-0c60effeb1aa' WHERE id='d563261c-64fb-5471-a96c-437ba345ae6a';
INSERT INTO kb_spaces (id,tenant_id,name,description,slug,scope,is_public,is_active) VALUES
('0d707078-26ee-5840-9e20-89e68ecdbc44','7862dc84-72d6-40a9-b2b1-c7c7896bc148','IT Knowledge Base','Self-service help articles','piq-it-kb','tenant_wide',false,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_categories (id,space_id,name,display_order,is_active) VALUES
('c9393fa5-f2d4-5b3b-a4e1-98eafe18358e','0d707078-26ee-5840-9e20-89e68ecdbc44','How-To',1,true),
('3fe2af99-da32-5c87-a5cb-2d0f0109513c','0d707078-26ee-5840-9e20-89e68ecdbc44','Troubleshooting',2,true),
('c07ae167-eb27-59dd-83a2-35bb048cede4','0d707078-26ee-5840-9e20-89e68ecdbc44','Policies',3,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_tags (id,tenant_id,name) VALUES
('b8a35572-9dbb-5970-8017-db27f03f4d5d','7862dc84-72d6-40a9-b2b1-c7c7896bc148','vpn'),
('7b968841-ac69-56ca-bc33-e8b54ffe14e8','7862dc84-72d6-40a9-b2b1-c7c7896bc148','email'),
('731ca325-975f-532a-b1b2-289094db7373','7862dc84-72d6-40a9-b2b1-c7c7896bc148','printer')
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_articles (id,tenant_id,space_id,category_id,title,slug,body,excerpt,status,visibility,author_id,version,view_count,helpful_count,published_at,metadata) VALUES
('c3937703-9bae-51fb-9587-bd97014ae90a','7862dc84-72d6-40a9-b2b1-c7c7896bc148','0d707078-26ee-5840-9e20-89e68ecdbc44','c9393fa5-f2d4-5b3b-a4e1-98eafe18358e','How to connect to the corporate VPN','piq-a1','Step 1: Install the VPN client. Step 2: Sign in with SSO. Step 3: Select the nearest gateway and connect.','Step 1: Install the VPN client. Step 2: Sign in with SSO. Step 3: Select the nea','published','internal','30be9e37-c91f-537d-895c-3656a0c3c353',1,142,30,'2026-06-22T12:00:00','{"seed": "piq-demo"}'::jsonb),
('ad122de1-816b-59e8-a316-a9e10bef373e','7862dc84-72d6-40a9-b2b1-c7c7896bc148','0d707078-26ee-5840-9e20-89e68ecdbc44','c9393fa5-f2d4-5b3b-a4e1-98eafe18358e','Reset your email password','piq-a2','Use the self-service portal at /reset, verify via SMS, then set a new password meeting the policy.','Use the self-service portal at /reset, verify via SMS, then set a new password m','published','public','30be9e37-c91f-537d-895c-3656a0c3c353',1,310,88,'2026-06-22T12:00:00','{"seed": "piq-demo"}'::jsonb),
('1e7add1a-d2ae-577b-9f14-e0f9d129aeea','7862dc84-72d6-40a9-b2b1-c7c7896bc148','0d707078-26ee-5840-9e20-89e68ecdbc44','3fe2af99-da32-5c87-a5cb-2d0f0109513c','Fixing a paper jam on floor printers','piq-a3','Open tray 2, remove jammed sheet gently, close, then resume the print job from the panel.','Open tray 2, remove jammed sheet gently, close, then resume the print job from t','published','internal','30be9e37-c91f-537d-895c-3656a0c3c353',1,58,12,'2026-06-22T12:00:00','{"seed": "piq-demo"}'::jsonb),
('9a7dfa0b-a73b-57b3-b171-0ff93f558fcb','7862dc84-72d6-40a9-b2b1-c7c7896bc148','0d707078-26ee-5840-9e20-89e68ecdbc44','3fe2af99-da32-5c87-a5cb-2d0f0109513c','Troubleshooting Outlook calendar crashes','piq-a4','Rebuild the Outlook profile, clear the calendar cache, and re-sync. Escalate if OST is corrupt.','Rebuild the Outlook profile, clear the calendar cache, and re-sync. Escalate if ','published','agents_only','30be9e37-c91f-537d-895c-3656a0c3c353',1,21,5,'2026-06-22T12:00:00','{"seed": "piq-demo"}'::jsonb),
('2a2d40bd-ac0a-5061-b99e-ee5b9ff4e0a0','7862dc84-72d6-40a9-b2b1-c7c7896bc148','0d707078-26ee-5840-9e20-89e68ecdbc44','c07ae167-eb27-59dd-83a2-35bb048cede4','Acceptable Use Policy','piq-a5','Company devices are for business use. Do not install unapproved software. Report incidents to IT.','Company devices are for business use. Do not install unapproved software. Report','draft','internal','30be9e37-c91f-537d-895c-3656a0c3c353',1,4,0,NULL,'{"seed": "piq-demo"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO asset_categories (id,tenant_id,name,is_active) VALUES
('91f5503e-e184-5b7f-a5b5-a6f5eecded8b','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Hardware',true),
('1a0a16aa-b585-5214-99d0-967158f244ab','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Software',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO asset_types (id,tenant_id,category_id,name) VALUES
('114121ac-73d7-5b81-af7d-e824c52f4911','7862dc84-72d6-40a9-b2b1-c7c7896bc148','91f5503e-e184-5b7f-a5b5-a6f5eecded8b','Laptop'),
('4c326014-c49f-5ccc-a19f-21d1c3aae37f','7862dc84-72d6-40a9-b2b1-c7c7896bc148','91f5503e-e184-5b7f-a5b5-a6f5eecded8b','Server'),
('f9d74a98-d2f7-510f-862e-c9bf0dd2fa76','7862dc84-72d6-40a9-b2b1-c7c7896bc148','1a0a16aa-b585-5214-99d0-967158f244ab','SaaS License')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vendors (id,tenant_id,name,contact_email,website,is_active) VALUES
('a2b33904-3301-50b0-89ed-32f5dfbe0ed9','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Dell Technologies','support@dell.demo','https://dell.demo',true),
('4ea73c30-88a6-5c15-a130-063e6d6a7213','7862dc84-72d6-40a9-b2b1-c7c7896bc148','Atlassian','support@atlassian.demo','https://atlassian.demo',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO assets (id,asset_tag,tenant_id,department_id,type_id,name,status,condition,serial_number,manufacturer,vendor_id,purchase_date,purchase_cost,warranty_expiry_date,assigned_to,assigned_at,metadata) VALUES
('347448df-e5f0-5e18-889d-308cb06f613e','AST-PIQ-001','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','114121ac-73d7-5b81-af7d-e824c52f4911','Latitude 7440 - Casey','in_use','good','SN-LAT-0001','Dell','a2b33904-3301-50b0-89ed-32f5dfbe0ed9','2025-01-15',1450.0,'2028-01-15','0a063b29-68a4-5172-91f6-7fbc1e3ee2d6','2026-06-02T12:00:00','{"seed": "piq-demo"}'::jsonb),
('0e988597-ed11-5d72-8d7d-9057671bab1e','AST-PIQ-002','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','114121ac-73d7-5b81-af7d-e824c52f4911','Latitude 7440 - Devin','in_use','good','SN-LAT-0002','Dell','a2b33904-3301-50b0-89ed-32f5dfbe0ed9','2025-01-15',1450.0,'2028-01-15','6d596769-c2cc-5494-979f-f1ec86dce78a','2026-06-02T12:00:00','{"seed": "piq-demo"}'::jsonb),
('d09c23ad-4774-5487-ab1c-c63033bdcb71','AST-PIQ-003','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','114121ac-73d7-5b81-af7d-e824c52f4911','Latitude 5540 - Spare','in_stock','new','SN-LAT-0003','Dell','a2b33904-3301-50b0-89ed-32f5dfbe0ed9','2025-01-15',1450.0,'2028-01-15',NULL,NULL,'{"seed": "piq-demo"}'::jsonb),
('45e1649b-e324-52c9-bf3d-e2f873330b4d','AST-PIQ-004','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','4c326014-c49f-5ccc-a19f-21d1c3aae37f','db-primary','in_use','good','SN-SRV-1001','Dell','a2b33904-3301-50b0-89ed-32f5dfbe0ed9','2025-01-15',8200.0,'2028-01-15',NULL,NULL,'{"seed": "piq-demo"}'::jsonb),
('7a087ea6-25f8-5a3b-b802-b320cad9ebca','AST-PIQ-005','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','4c326014-c49f-5ccc-a19f-21d1c3aae37f','web-01','in_use','good','SN-SRV-1002','Dell','a2b33904-3301-50b0-89ed-32f5dfbe0ed9','2025-01-15',8200.0,'2028-01-15',NULL,NULL,'{"seed": "piq-demo"}'::jsonb),
('876e4175-ec3a-5429-b826-96b9728f6059','AST-PIQ-006','7862dc84-72d6-40a9-b2b1-c7c7896bc148','8aa752af-92dd-5584-8e0e-abf4a230ba8d','f9d74a98-d2f7-510f-862e-c9bf0dd2fa76','Jira Software (50 seats)','in_use','new',NULL,'Atlassian','4ea73c30-88a6-5c15-a130-063e6d6a7213','2025-01-15',5000.0,'2028-01-15',NULL,NULL,'{"seed": "piq-demo"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO asset_relationships (id,tenant_id,source_asset_id,target_asset_id,relationship_type,created_by) VALUES
('afe231d8-96dc-5ac0-b32b-756a0bbc328d','7862dc84-72d6-40a9-b2b1-c7c7896bc148','876e4175-ec3a-5429-b826-96b9728f6059','7a087ea6-25f8-5a3b-b802-b320cad9ebca','runs_on','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049'),
('112dfd62-0069-5750-943f-a3ff0909a6cd','7862dc84-72d6-40a9-b2b1-c7c7896bc148','45e1649b-e324-52c9-bf3d-e2f873330b4d','7a087ea6-25f8-5a3b-b802-b320cad9ebca','connected_to','82ce8a8d-1bb9-5b4c-bea8-3e2d9c93b049')
ON CONFLICT (id) DO NOTHING;

-- ===== TENANT: Acme Corp (56cc885c-37d4-5dc6-900d-1a7a6defec8b) =====
INSERT INTO tenants (id,iam_org_id,name,slug,is_active,settings) VALUES
('56cc885c-37d4-5dc6-900d-1a7a6defec8b','demo-acme-org','Acme Corp','acme-corp',true,'{"seed": "piq-demo"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id,iam_user_id,tenant_id,email,first_name,last_name,is_active,metadata,iam_roles,last_seen_at) VALUES
('6da32b93-6f3d-5f80-b6e7-69cba3f13e38','demo-acme-mgr','56cc885c-37d4-5dc6-900d-1a7a6defec8b','morgan.avery@acme.demo','Morgan','Avery',true,'{"seed": "piq-demo"}'::jsonb,'["manager"]'::jsonb,'2026-07-01T12:00:00'),
('4a46dc4a-6050-522b-aab9-0a8cdd200c80','demo-acme-lead','56cc885c-37d4-5dc6-900d-1a7a6defec8b','riley.chen@acme.demo','Riley','Chen',true,'{"seed": "piq-demo"}'::jsonb,'["team_lead"]'::jsonb,'2026-07-01T12:00:00'),
('5073456e-2932-5df4-b218-9ce4e34553f1','demo-acme-ag1','56cc885c-37d4-5dc6-900d-1a7a6defec8b','jordan.patel@acme.demo','Jordan','Patel',true,'{"seed": "piq-demo"}'::jsonb,'["agent"]'::jsonb,'2026-07-01T12:00:00'),
('83a1c32e-2426-52b4-b62a-8e16ebdea66b','demo-acme-ag2','56cc885c-37d4-5dc6-900d-1a7a6defec8b','sam.nguyen@acme.demo','Sam','Nguyen',true,'{"seed": "piq-demo"}'::jsonb,'["agent"]'::jsonb,'2026-07-01T12:00:00'),
('ba390f71-e0c1-5cb8-8993-20574d961dac','demo-acme-ag3','56cc885c-37d4-5dc6-900d-1a7a6defec8b','taylor.okafor@acme.demo','Taylor','Okafor',true,'{"seed": "piq-demo"}'::jsonb,'["agent"]'::jsonb,'2026-07-01T12:00:00'),
('3e74b653-ba7f-5124-a06c-248e31ae2786','demo-acme-eu1','56cc885c-37d4-5dc6-900d-1a7a6defec8b','casey.brooks@acme.demo','Casey','Brooks',true,'{"seed": "piq-demo"}'::jsonb,'["end_user"]'::jsonb,'2026-07-01T12:00:00'),
('cad34ad2-3796-524a-b2ea-319baacdd3a1','demo-acme-eu2','56cc885c-37d4-5dc6-900d-1a7a6defec8b','devin.flores@acme.demo','Devin','Flores',true,'{"seed": "piq-demo"}'::jsonb,'["end_user"]'::jsonb,'2026-07-01T12:00:00'),
('89338c6c-3002-5ce5-9c11-46cba66b5fd5','demo-acme-eu3','56cc885c-37d4-5dc6-900d-1a7a6defec8b','alex.romano@acme.demo','Alex','Romano',true,'{"seed": "piq-demo"}'::jsonb,'["end_user"]'::jsonb,'2026-07-01T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO user_itsm_roles (user_id,role_id,tenant_id) VALUES
('6da32b93-6f3d-5f80-b6e7-69cba3f13e38','302afd7f-8c70-47e3-96f7-f2942652f8f3','56cc885c-37d4-5dc6-900d-1a7a6defec8b'),
('4a46dc4a-6050-522b-aab9-0a8cdd200c80','e16363a0-d237-4b7d-b19d-305a7d85afa6','56cc885c-37d4-5dc6-900d-1a7a6defec8b'),
('5073456e-2932-5df4-b218-9ce4e34553f1','1da49bee-2bfc-4c49-92f8-4819fe966f5b','56cc885c-37d4-5dc6-900d-1a7a6defec8b'),
('83a1c32e-2426-52b4-b62a-8e16ebdea66b','1da49bee-2bfc-4c49-92f8-4819fe966f5b','56cc885c-37d4-5dc6-900d-1a7a6defec8b'),
('ba390f71-e0c1-5cb8-8993-20574d961dac','1da49bee-2bfc-4c49-92f8-4819fe966f5b','56cc885c-37d4-5dc6-900d-1a7a6defec8b'),
('3e74b653-ba7f-5124-a06c-248e31ae2786','52dd610c-24f8-47ed-8b6a-84181200955b','56cc885c-37d4-5dc6-900d-1a7a6defec8b'),
('cad34ad2-3796-524a-b2ea-319baacdd3a1','52dd610c-24f8-47ed-8b6a-84181200955b','56cc885c-37d4-5dc6-900d-1a7a6defec8b'),
('89338c6c-3002-5ce5-9c11-46cba66b5fd5','52dd610c-24f8-47ed-8b6a-84181200955b','56cc885c-37d4-5dc6-900d-1a7a6defec8b')
ON CONFLICT (user_id,role_id) DO NOTHING;
INSERT INTO departments (id,tenant_id,name,description,is_active) VALUES
('7ffd830b-4e1f-5067-94ce-9d6d79daafd7','56cc885c-37d4-5dc6-900d-1a7a6defec8b','IT','Information Technology',true),
('4182cf39-e941-546f-ab6a-1a23e3e08395','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Operations','Business Operations',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id,tenant_id,name,description,lead_id) VALUES
('2ea7b010-acd1-57c8-b1ab-31a7302bac98','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Service Desk','First-line support','4a46dc4a-6050-522b-aab9-0a8cdd200c80'),
('b3db1fc9-30e0-51f3-bfe8-1acbee2fb127','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Infrastructure','Servers, network & cloud','6da32b93-6f3d-5f80-b6e7-69cba3f13e38')
ON CONFLICT (id) DO NOTHING;
INSERT INTO team_members (team_id,user_id) VALUES
('2ea7b010-acd1-57c8-b1ab-31a7302bac98','5073456e-2932-5df4-b218-9ce4e34553f1'),
('2ea7b010-acd1-57c8-b1ab-31a7302bac98','83a1c32e-2426-52b4-b62a-8e16ebdea66b'),
('2ea7b010-acd1-57c8-b1ab-31a7302bac98','4a46dc4a-6050-522b-aab9-0a8cdd200c80'),
('b3db1fc9-30e0-51f3-bfe8-1acbee2fb127','ba390f71-e0c1-5cb8-8993-20574d961dac'),
('b3db1fc9-30e0-51f3-bfe8-1acbee2fb127','6da32b93-6f3d-5f80-b6e7-69cba3f13e38')
ON CONFLICT (team_id,user_id) DO NOTHING;
INSERT INTO coverage_windows (id,tenant_id,name,timezone,is_247,work_days,windows) VALUES
('b30c0cdf-3bb2-5fa9-95bb-9696331d7a27','56cc885c-37d4-5dc6-900d-1a7a6defec8b','24x7','UTC',true,ARRAY[1,2,3,4,5,6,7],NULL),
('f2e8c425-7b8a-5aac-b3cb-63bab7c6d542','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Business Hours (Mon-Fri 9-6)','UTC',false,ARRAY[1,2,3,4,5],'[{"day": 1, "start": "09:00", "end": "18:00"}, {"day": 2, "start": "09:00", "end": "18:00"}, {"day": 3, "start": "09:00", "end": "18:00"}, {"day": 4, "start": "09:00", "end": "18:00"}, {"day": 5, "start": "09:00", "end": "18:00"}]'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_agreements (id,tenant_id,name,kind,description,owner_team_id,is_active) VALUES
('34f26635-3832-50e3-8257-dc9968f8e8cd','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Standard Support SLA','sla','Default customer SLA','2ea7b010-acd1-57c8-b1ab-31a7302bac98',true),
('36fd8cd2-320c-57d9-877a-178d539abc19','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Premium SLA','sla','Priority customers','2ea7b010-acd1-57c8-b1ab-31a7302bac98',true),
('99e535bf-eb44-5ad8-9138-3a14a3838c92','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Infrastructure OLA','ola','Internal infra underpinning','b3db1fc9-30e0-51f3-bfe8-1acbee2fb127',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_targets (id,tenant_id,agreement_id,metric,duration_minutes,coverage_window_id,applies_priority,warn_thresholds_pct) VALUES
('759c83b6-4a5a-50c4-a954-b0ae07721a7d','56cc885c-37d4-5dc6-900d-1a7a6defec8b','34f26635-3832-50e3-8257-dc9968f8e8cd','first_response',60,'f2e8c425-7b8a-5aac-b3cb-63bab7c6d542','high',ARRAY[50,75,90]),
('2b3a00b6-8486-5037-865b-e19cc9c48ea2','56cc885c-37d4-5dc6-900d-1a7a6defec8b','34f26635-3832-50e3-8257-dc9968f8e8cd','resolution',480,'f2e8c425-7b8a-5aac-b3cb-63bab7c6d542',NULL,ARRAY[50,75,90]),
('03e4ae67-692f-5f32-99a7-7faa2de546d7','56cc885c-37d4-5dc6-900d-1a7a6defec8b','36fd8cd2-320c-57d9-877a-178d539abc19','first_response',15,'b30c0cdf-3bb2-5fa9-95bb-9696331d7a27','critical',ARRAY[50,75,90]),
('e52d403c-73c6-523a-8611-4747f45730d0','56cc885c-37d4-5dc6-900d-1a7a6defec8b','36fd8cd2-320c-57d9-877a-178d539abc19','resolution',240,'b30c0cdf-3bb2-5fa9-95bb-9696331d7a27',NULL,ARRAY[50,75,90]),
('a35bc6a5-f5cc-5606-afb4-198bf1af3cc9','56cc885c-37d4-5dc6-900d-1a7a6defec8b','99e535bf-eb44-5ad8-9138-3a14a3838c92','time_to_mitigate',120,'b30c0cdf-3bb2-5fa9-95bb-9696331d7a27',NULL,ARRAY[50,90])
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_rules (id,tenant_id,position,conditions,agreement_id,is_active) VALUES
('ae173a2c-34d5-5948-af68-69bb05b154a5','56cc885c-37d4-5dc6-900d-1a7a6defec8b',1,'{"priority": ["critical"]}'::jsonb,'36fd8cd2-320c-57d9-877a-178d539abc19',true),
('ee65d129-3291-56ed-bfb8-836d4035e563','56cc885c-37d4-5dc6-900d-1a7a6defec8b',2,'{}'::jsonb,'34f26635-3832-50e3-8257-dc9968f8e8cd',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_categories (id,tenant_id,name,is_active,default_team_id) VALUES
('2e927736-c6d7-5e18-93c9-4e9ba6107d60','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Hardware',true,'2ea7b010-acd1-57c8-b1ab-31a7302bac98'),
('05d5d5f2-6474-55e8-9f04-4e777b5d9ecd','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Software',true,'2ea7b010-acd1-57c8-b1ab-31a7302bac98'),
('87c0b6d4-272a-5ab3-9ee0-a9d6f2fcea7a','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Network',true,'b3db1fc9-30e0-51f3-bfe8-1acbee2fb127'),
('40b8d845-1180-5f3d-be02-d97bbd05e818','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Access Request',true,'2ea7b010-acd1-57c8-b1ab-31a7302bac98')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_tags (id,tenant_id,name,color) VALUES
('106a6b38-0102-5100-8ae2-9d94a11ba0b7','56cc885c-37d4-5dc6-900d-1a7a6defec8b','vip','#e11d48'),
('a93e6e60-5321-5225-8590-e03698a19c96','56cc885c-37d4-5dc6-900d-1a7a6defec8b','recurring','#f59e0b'),
('4aa69053-b151-5f83-8d12-dd8ab7fc6988','56cc885c-37d4-5dc6-900d-1a7a6defec8b','hardware','#3b82f6'),
('3bfc86a5-1ce7-52ed-9a75-d1bddd57744e','56cc885c-37d4-5dc6-900d-1a7a6defec8b','urgent','#dc2626')
ON CONFLICT (tenant_id,name) DO NOTHING;
INSERT INTO tickets (id,ticket_number,tenant_id,department_id,type,status,priority,title,description,requester_id,assignee_id,team_id,category_id,sla_response_due,sla_resolve_due,sla_breached,resolved_at,closed_at,created_at,metadata) VALUES
('277bcad4-4122-5cdf-8267-a2e181cef3e2','90021','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','incident','in_progress','high','Laptop won''t boot after update','Laptop won''t boot after update. Reported by user; see comments for detail.','3e74b653-ba7f-5124-a06c-248e31ae2786','5073456e-2932-5df4-b218-9ce4e34553f1','2ea7b010-acd1-57c8-b1ab-31a7302bac98','2e927736-c6d7-5e18-93c9-4e9ba6107d60','2026-06-30T13:00:00','2026-06-30T20:00:00',false,NULL,NULL,'2026-06-30T12:00:00','{"seed": "piq-demo"}'::jsonb),
('8afeb429-1916-51da-985c-4af3d5c8c987','90022','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','incident','open','critical','Office VPN down for remote staff','Office VPN down for remote staff. Reported by user; see comments for detail.','cad34ad2-3796-524a-b2ea-319baacdd3a1','ba390f71-e0c1-5cb8-8993-20574d961dac','b3db1fc9-30e0-51f3-bfe8-1acbee2fb127','87c0b6d4-272a-5ab3-9ee0-a9d6f2fcea7a','2026-07-02T13:00:00','2026-07-02T20:00:00',false,NULL,NULL,'2026-07-02T12:00:00','{"seed": "piq-demo"}'::jsonb),
('869726b4-71ee-59ab-b617-c1bf65b68d4d','90023','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','service_request','open','medium','New starter access to shared drive','New starter access to shared drive. Reported by user; see comments for detail.','89338c6c-3002-5ce5-9c11-46cba66b5fd5','83a1c32e-2426-52b4-b62a-8e16ebdea66b','2ea7b010-acd1-57c8-b1ab-31a7302bac98','40b8d845-1180-5f3d-be02-d97bbd05e818','2026-07-01T13:00:00','2026-07-01T20:00:00',false,NULL,NULL,'2026-07-01T12:00:00','{"seed": "piq-demo"}'::jsonb),
('64ba53e8-3096-581c-966d-4d75f253cf1c','90024','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','incident','resolved','medium','Outlook crashes when opening calendar','Outlook crashes when opening calendar. Reported by user; see comments for detail.','3e74b653-ba7f-5124-a06c-248e31ae2786','5073456e-2932-5df4-b218-9ce4e34553f1','2ea7b010-acd1-57c8-b1ab-31a7302bac98','05d5d5f2-6474-55e8-9f04-4e777b5d9ecd','2026-06-26T13:00:00','2026-06-26T20:00:00',false,'2026-06-26T17:00:00',NULL,'2026-06-26T12:00:00','{"seed": "piq-demo"}'::jsonb),
('ce332e2b-8000-566b-9564-7870a5e7a4c6','90025','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','problem','in_progress','high','Intermittent packet loss on 3rd floor','Intermittent packet loss on 3rd floor. Reported by user; see comments for detail.','cad34ad2-3796-524a-b2ea-319baacdd3a1','ba390f71-e0c1-5cb8-8993-20574d961dac','b3db1fc9-30e0-51f3-bfe8-1acbee2fb127','87c0b6d4-272a-5ab3-9ee0-a9d6f2fcea7a','2026-06-28T13:00:00','2026-06-28T20:00:00',false,NULL,NULL,'2026-06-28T12:00:00','{"seed": "piq-demo"}'::jsonb),
('cacfbe6c-6f1c-5c35-87ee-d286f1165b2d','90026','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','service_request','closed','low','Request second monitor','Request second monitor. Reported by user; see comments for detail.','89338c6c-3002-5ce5-9c11-46cba66b5fd5','83a1c32e-2426-52b4-b62a-8e16ebdea66b','2ea7b010-acd1-57c8-b1ab-31a7302bac98','2e927736-c6d7-5e18-93c9-4e9ba6107d60','2026-06-23T13:00:00','2026-06-23T20:00:00',false,'2026-06-23T17:00:00','2026-06-23T18:00:00','2026-06-23T12:00:00','{"seed": "piq-demo"}'::jsonb),
('dd8bb97d-a2da-57ce-b2b2-f12e5b9a1855','90027','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','change','pending_approval','medium','Upgrade CRM to v12 (change request)','Upgrade CRM to v12 (change request). Reported by user; see comments for detail.','4a46dc4a-6050-522b-aab9-0a8cdd200c80','6da32b93-6f3d-5f80-b6e7-69cba3f13e38','b3db1fc9-30e0-51f3-bfe8-1acbee2fb127','05d5d5f2-6474-55e8-9f04-4e777b5d9ecd','2026-06-29T13:00:00','2026-06-29T20:00:00',false,NULL,NULL,'2026-06-29T12:00:00','{"seed": "piq-demo"}'::jsonb),
('74c84679-ef15-5052-acea-a0e380615ef0','90028','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','incident','pending','high','Payroll app slow at month end','Payroll app slow at month end. Reported by user; see comments for detail.','3e74b653-ba7f-5124-a06c-248e31ae2786','83a1c32e-2426-52b4-b62a-8e16ebdea66b','2ea7b010-acd1-57c8-b1ab-31a7302bac98','05d5d5f2-6474-55e8-9f04-4e777b5d9ecd','2026-07-01T13:00:00','2026-07-01T20:00:00',false,NULL,NULL,'2026-07-01T12:00:00','{"seed": "piq-demo"}'::jsonb),
('3926cceb-dbd0-58ad-b134-e7baaa2460e1','90029','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','incident','resolved','low','Printer on 2nd floor jamming','Printer on 2nd floor jamming. Reported by user; see comments for detail.','cad34ad2-3796-524a-b2ea-319baacdd3a1','5073456e-2932-5df4-b218-9ce4e34553f1','2ea7b010-acd1-57c8-b1ab-31a7302bac98','2e927736-c6d7-5e18-93c9-4e9ba6107d60','2026-06-25T13:00:00','2026-06-25T20:00:00',false,'2026-06-25T17:00:00',NULL,'2026-06-25T12:00:00','{"seed": "piq-demo"}'::jsonb),
('bfe16b83-a679-5fae-a799-bd4cff3ceaf6','90030','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','service_request','open','medium','VPN access for contractor','VPN access for contractor. Reported by user; see comments for detail.','89338c6c-3002-5ce5-9c11-46cba66b5fd5','83a1c32e-2426-52b4-b62a-8e16ebdea66b','2ea7b010-acd1-57c8-b1ab-31a7302bac98','40b8d845-1180-5f3d-be02-d97bbd05e818','2026-07-02T13:00:00','2026-07-02T20:00:00',false,NULL,NULL,'2026-07-02T12:00:00','{"seed": "piq-demo"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_comments (id,ticket_id,author_id,body,is_internal,created_at) VALUES
('429c5b29-9263-540f-a92f-a9752a2ffc92','277bcad4-4122-5cdf-8267-a2e181cef3e2','5073456e-2932-5df4-b218-9ce4e34553f1','Confirmed the device is stuck on the update screen. Trying safe boot.',true,'2026-07-01T12:00:00'),
('a54803aa-d682-59eb-af6e-b9a3ee97a513','277bcad4-4122-5cdf-8267-a2e181cef3e2','3e74b653-ba7f-5124-a06c-248e31ae2786','Thanks, let me know if you need me to bring it in.',false,'2026-07-01T12:00:00'),
('76149cd4-0edf-54b5-b310-9ffd566bf006','8afeb429-1916-51da-985c-4af3d5c8c987','ba390f71-e0c1-5cb8-8993-20574d961dac','Escalating to infra — core VPN concentrator is unreachable.',true,'2026-07-01T12:00:00'),
('4fd56621-cc43-5b2a-9e90-8370cace1b1e','64ba53e8-3096-581c-966d-4d75f253cf1c','5073456e-2932-5df4-b218-9ce4e34553f1','Rebuilt the Outlook profile; calendar opens normally now.',false,'2026-07-01T12:00:00'),
('31e93fac-fa34-5d3f-9d20-b1c8440162f9','ce332e2b-8000-566b-9564-7870a5e7a4c6','ba390f71-e0c1-5cb8-8993-20574d961dac','Captured pcap; suspecting a faulty switch port. Investigating.',true,'2026-07-01T12:00:00'),
('b137eb09-4e1a-5be6-81cf-6e71f3a959b9','74c84679-ef15-5052-acea-a0e380615ef0','83a1c32e-2426-52b4-b62a-8e16ebdea66b','Reproduced the slowness; DB query plan regressed. Looping in infra.',true,'2026-07-01T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_history (id,ticket_id,actor_id,field_changed,old_value,new_value,changed_at) VALUES
('b0bae0ac-498c-526e-81a5-194d842da562','277bcad4-4122-5cdf-8267-a2e181cef3e2','5073456e-2932-5df4-b218-9ce4e34553f1','status','{"status": "open"}'::jsonb,'{"status": "in_progress"}'::jsonb,'2026-07-01T12:00:00'),
('21d11cd6-892b-578e-8211-4ea03c9fdb08','64ba53e8-3096-581c-966d-4d75f253cf1c','5073456e-2932-5df4-b218-9ce4e34553f1','status','{"status": "open"}'::jsonb,'{"status": "in_progress"}'::jsonb,'2026-07-01T12:00:00'),
('bf045757-f1fe-5d1b-807b-ae03bb99f204','ce332e2b-8000-566b-9564-7870a5e7a4c6','5073456e-2932-5df4-b218-9ce4e34553f1','status','{"status": "open"}'::jsonb,'{"status": "in_progress"}'::jsonb,'2026-07-01T12:00:00'),
('0f4d93bc-5af1-57b6-9aac-990a40a8f585','3926cceb-dbd0-58ad-b134-e7baaa2460e1','5073456e-2932-5df4-b218-9ce4e34553f1','status','{"status": "open"}'::jsonb,'{"status": "in_progress"}'::jsonb,'2026-07-01T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO ticket_tag_assignments (ticket_id,tag_id) VALUES
('277bcad4-4122-5cdf-8267-a2e181cef3e2','4aa69053-b151-5f83-8d12-dd8ab7fc6988'),
('277bcad4-4122-5cdf-8267-a2e181cef3e2','3bfc86a5-1ce7-52ed-9a75-d1bddd57744e'),
('8afeb429-1916-51da-985c-4af3d5c8c987','3bfc86a5-1ce7-52ed-9a75-d1bddd57744e'),
('74c84679-ef15-5052-acea-a0e380615ef0','106a6b38-0102-5100-8ae2-9d94a11ba0b7'),
('3926cceb-dbd0-58ad-b134-e7baaa2460e1','a93e6e60-5321-5225-8590-e03698a19c96'),
('ce332e2b-8000-566b-9564-7870a5e7a4c6','a93e6e60-5321-5225-8590-e03698a19c96')
ON CONFLICT (ticket_id,tag_id) DO NOTHING;
INSERT INTO ticket_watchers (ticket_id,user_id) VALUES
('8afeb429-1916-51da-985c-4af3d5c8c987','6da32b93-6f3d-5f80-b6e7-69cba3f13e38'),
('dd8bb97d-a2da-57ce-b2b2-f12e5b9a1855','6da32b93-6f3d-5f80-b6e7-69cba3f13e38')
ON CONFLICT (ticket_id,user_id) DO NOTHING;
INSERT INTO sla_instances (id,tenant_id,ticket_id,target_id,due_at,status,breached_at,warned_pct,created_at) VALUES
('c4d72e82-f3b0-57e2-b164-5a909938dde7','56cc885c-37d4-5dc6-900d-1a7a6defec8b','277bcad4-4122-5cdf-8267-a2e181cef3e2','2b3a00b6-8486-5037-865b-e19cc9c48ea2','2026-07-02T20:00:00','running',NULL,ARRAY[50,75],'2026-06-29T12:00:00'),
('c59af7df-5831-59a4-9e33-1206d327640d','56cc885c-37d4-5dc6-900d-1a7a6defec8b','8afeb429-1916-51da-985c-4af3d5c8c987','e52d403c-73c6-523a-8611-4747f45730d0','2026-07-02T20:00:00','running',NULL,ARRAY[50,75],'2026-06-29T12:00:00'),
('3bcc0192-c50a-57d8-8a01-ffb098835c26','56cc885c-37d4-5dc6-900d-1a7a6defec8b','64ba53e8-3096-581c-966d-4d75f253cf1c','2b3a00b6-8486-5037-865b-e19cc9c48ea2','2026-06-26T20:00:00','met',NULL,ARRAY[]::integer[],'2026-06-29T12:00:00'),
('b3dd16ce-3f1b-5e34-a35c-d8324c8abfcf','56cc885c-37d4-5dc6-900d-1a7a6defec8b','ce332e2b-8000-566b-9564-7870a5e7a4c6','2b3a00b6-8486-5037-865b-e19cc9c48ea2','2026-06-28T20:00:00','breached','2026-06-28T21:00:00',ARRAY[50,75],'2026-06-29T12:00:00'),
('4ed21aae-ea9c-52a6-bcfd-9b50910e3120','56cc885c-37d4-5dc6-900d-1a7a6defec8b','74c84679-ef15-5052-acea-a0e380615ef0','759c83b6-4a5a-50c4-a954-b0ae07721a7d','2026-07-02T20:00:00','running',NULL,ARRAY[50,75],'2026-06-29T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO sla_events (id,instance_id,event) VALUES
('74181500-c83e-5bc6-9e7e-4241285fc0e8','c4d72e82-f3b0-57e2-b164-5a909938dde7','started'),
('b823bd08-a991-520a-843e-8466909d94f9','c4d72e82-f3b0-57e2-b164-5a909938dde7','warned'),
('23dd9ed0-3afa-513e-acc2-d5b8127b230e','c59af7df-5831-59a4-9e33-1206d327640d','started'),
('6d8981cb-ab97-51d8-a513-048ca7abb95f','c59af7df-5831-59a4-9e33-1206d327640d','warned'),
('c99e8e36-c913-5062-b181-659071ef1c9a','3bcc0192-c50a-57d8-8a01-ffb098835c26','started'),
('2fabf6bf-0275-5a31-94d4-42f1fbe69c7e','3bcc0192-c50a-57d8-8a01-ffb098835c26','warned'),
('7dee4c81-8dae-5088-a890-7d5d70f2b765','b3dd16ce-3f1b-5e34-a35c-d8324c8abfcf','started'),
('83a5560d-8ed8-5864-aadc-b4058042febf','b3dd16ce-3f1b-5e34-a35c-d8324c8abfcf','warned'),
('a925a6b7-47f1-51c8-afb9-0bcf6d65e44b','4ed21aae-ea9c-52a6-bcfd-9b50910e3120','started'),
('d57bed49-2581-5458-af62-ad1356f83f7c','4ed21aae-ea9c-52a6-bcfd-9b50910e3120','warned')
ON CONFLICT (id) DO NOTHING;
INSERT INTO severity_levels (id,tenant_id,name,rank,auto_page,required_roles) VALUES
('ac172dd1-95e6-557d-a45d-ffbe061d1e65','56cc885c-37d4-5dc6-900d-1a7a6defec8b','SEV1',1,true,ARRAY['ic','comms']::varchar[]),
('8c64e1ba-2222-59b6-9e39-e6a0421b554f','56cc885c-37d4-5dc6-900d-1a7a6defec8b','SEV2',2,true,ARRAY['ic']::varchar[]),
('4c415461-ea50-55d8-9f6b-7f424fe29965','56cc885c-37d4-5dc6-900d-1a7a6defec8b','SEV3',3,false,NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO schedules (id,tenant_id,name,team_id,timezone,rotation_type,rotation_length_hours,handoff_time,start_at,is_active) VALUES
('ebeeba7e-e1d3-5253-befe-f313af073e40','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Primary On-Call Rotation','b3db1fc9-30e0-51f3-bfe8-1acbee2fb127','UTC','weekly',168,'10:00','2026-06-18T12:00:00',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO schedule_layers (id,schedule_id,layer_rank,participants) VALUES
('f45b1b14-c6be-573b-87a4-0bcfaeab04bd','ebeeba7e-e1d3-5253-befe-f313af073e40',1,ARRAY['5073456e-2932-5df4-b218-9ce4e34553f1','83a1c32e-2426-52b4-b62a-8e16ebdea66b','ba390f71-e0c1-5cb8-8993-20574d961dac']::uuid[])
ON CONFLICT (id) DO NOTHING;
INSERT INTO escalation_policies (id,tenant_id,name,repeat_count) VALUES
('fd591a57-26ad-595f-b77b-75f6f36b2393','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Primary Escalation',1)
ON CONFLICT (id) DO NOTHING;
INSERT INTO escalation_steps (id,policy_id,position,target_type,target_id,timeout_minutes,notify_strategy) VALUES
('59248599-02c3-5a9b-9564-cc0fa22894f3','fd591a57-26ad-595f-b77b-75f6f36b2393',1,'schedule','ebeeba7e-e1d3-5253-befe-f313af073e40',15,'current_oncall'),
('1f24f701-6ccc-53d0-a2ea-4dd2ffb23840','fd591a57-26ad-595f-b77b-75f6f36b2393',2,'user','6da32b93-6f3d-5f80-b6e7-69cba3f13e38',30,'notify_all')
ON CONFLICT (id) DO NOTHING;
INSERT INTO oncall_services (id,tenant_id,name,description,escalation_policy_id,current_state,is_active) VALUES
('19e4074d-63fa-5967-87fe-b8cccfd53448','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Payments API','Customer billing & payments','fd591a57-26ad-595f-b77b-75f6f36b2393','operational',true),
('4da0b040-cfc1-5dfd-bdbf-965c031aef39','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Web Platform','Public web & portal','fd591a57-26ad-595f-b77b-75f6f36b2393','operational',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO contact_methods (id,tenant_id,user_id,type,value,is_verified) VALUES
('c661602d-0cd6-56a0-ab85-24645c17af2f','56cc885c-37d4-5dc6-900d-1a7a6defec8b','6da32b93-6f3d-5f80-b6e7-69cba3f13e38','email','mgr@acme.demo',true),
('47889281-790f-5aab-90d6-051867a37216','56cc885c-37d4-5dc6-900d-1a7a6defec8b','5073456e-2932-5df4-b218-9ce4e34553f1','email','ag1@acme.demo',true),
('8ca2ca51-d7cf-5ea9-a552-51c225ebb26d','56cc885c-37d4-5dc6-900d-1a7a6defec8b','83a1c32e-2426-52b4-b62a-8e16ebdea66b','email','ag2@acme.demo',true),
('d022ff37-9623-52e1-bde4-c7ebad5cb529','56cc885c-37d4-5dc6-900d-1a7a6defec8b','ba390f71-e0c1-5cb8-8993-20574d961dac','email','ag3@acme.demo',true),
('f0ddf499-fd4e-5a94-a662-3d03126d2c0e','56cc885c-37d4-5dc6-900d-1a7a6defec8b','6da32b93-6f3d-5f80-b6e7-69cba3f13e38','sms','+1-555-0100',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO alerts (id,tenant_id,service_id,source,dedup_key,title,payload,severity_id,status,occurrence_count,incident_id,acknowledged_at,resolved_at,created_at) VALUES
('2fa5b204-86c0-50de-8938-e263383da693','56cc885c-37d4-5dc6-900d-1a7a6defec8b','19e4074d-63fa-5967-87fe-b8cccfd53448','monitor','acme-al1','payments p99 latency > 2s','{"seed": "piq-demo", "metric": "payments p99 latency > 2s"}'::jsonb,'8c64e1ba-2222-59b6-9e39-e6a0421b554f','open',1,NULL,NULL,NULL,'2026-07-01T11:00:00'),
('802a3fa2-366d-55ca-92de-5d9a3aa43310','56cc885c-37d4-5dc6-900d-1a7a6defec8b','4da0b040-cfc1-5dfd-bdbf-965c031aef39','prometheus','acme-al2','5xx error rate spike on web','{"seed": "piq-demo", "metric": "5xx error rate spike on web"}'::jsonb,'4c415461-ea50-55d8-9f6b-7f424fe29965','acknowledged',1,NULL,'2026-07-01T12:00:00',NULL,'2026-07-01T11:00:00'),
('c08abb1a-9374-51d8-94e4-5c730d19c388','56cc885c-37d4-5dc6-900d-1a7a6defec8b','19e4074d-63fa-5967-87fe-b8cccfd53448','monitor','acme-al3','disk space low on db-primary','{"seed": "piq-demo", "metric": "disk space low on db-primary"}'::jsonb,'4c415461-ea50-55d8-9f6b-7f424fe29965','resolved',1,NULL,'2026-07-01T12:00:00','2026-07-01T14:00:00','2026-07-01T11:00:00'),
('2508cec6-dfae-5876-8122-9ae3c10ac50d','56cc885c-37d4-5dc6-900d-1a7a6defec8b','19e4074d-63fa-5967-87fe-b8cccfd53448','prometheus','acme-al4','Payments API unavailable','{"seed": "piq-demo", "metric": "Payments API unavailable"}'::jsonb,'8c64e1ba-2222-59b6-9e39-e6a0421b554f','resolved',3,NULL,'2026-07-01T12:00:00','2026-07-01T14:00:00','2026-07-01T11:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO incidents (id,tenant_id,incident_number,title,description,severity_id,status,declared_by,declared_at,mitigated_at,resolved_at,affected_service_ids,source_alert_id) VALUES
('bb020389-1d00-534d-ae92-b06e5866d2f9','56cc885c-37d4-5dc6-900d-1a7a6defec8b','IR-2026-90005','Payments API outage','Payments API returned 503 for ~40 min affecting checkout.','8c64e1ba-2222-59b6-9e39-e6a0421b554f','resolved','6da32b93-6f3d-5f80-b6e7-69cba3f13e38','2026-06-27T12:00:00','2026-06-27T13:00:00','2026-06-27T14:00:00',ARRAY['19e4074d-63fa-5967-87fe-b8cccfd53448']::uuid[],'2508cec6-dfae-5876-8122-9ae3c10ac50d'),
('05147102-b8cb-5cd4-ad19-d43d2fc8c628','56cc885c-37d4-5dc6-900d-1a7a6defec8b','IR-2026-90006','Elevated web error rate','Investigating a rise in 5xx responses on the web platform.','ac172dd1-95e6-557d-a45d-ffbe061d1e65','investigating','4a46dc4a-6050-522b-aab9-0a8cdd200c80','2026-07-02T09:00:00',NULL,NULL,ARRAY['4da0b040-cfc1-5dfd-bdbf-965c031aef39']::uuid[],NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO incident_roles (id,incident_id,role,user_id) VALUES
('40fcfe5a-bbc1-5c2b-ba93-d5663b4fd4f1','bb020389-1d00-534d-ae92-b06e5866d2f9','ic','6da32b93-6f3d-5f80-b6e7-69cba3f13e38'),
('c1c07121-8a79-5019-b4e5-a4da2fd52fc7','bb020389-1d00-534d-ae92-b06e5866d2f9','comms','4a46dc4a-6050-522b-aab9-0a8cdd200c80'),
('18b8ef88-4b26-511b-8966-b3adfa45dac6','bb020389-1d00-534d-ae92-b06e5866d2f9','ops','5073456e-2932-5df4-b218-9ce4e34553f1'),
('580b159d-deb3-5e14-a926-b28e02ce4942','bb020389-1d00-534d-ae92-b06e5866d2f9','scribe','83a1c32e-2426-52b4-b62a-8e16ebdea66b'),
('fd51ee55-f0f5-5395-b87f-33a03576fa1a','05147102-b8cb-5cd4-ad19-d43d2fc8c628','ic','4a46dc4a-6050-522b-aab9-0a8cdd200c80')
ON CONFLICT (id) DO NOTHING;
INSERT INTO incident_timeline (id,incident_id,actor_id,event_type,data,pinned,at) VALUES
('072d60b1-72fc-562e-8e97-445ecf688f07','bb020389-1d00-534d-ae92-b06e5866d2f9','6da32b93-6f3d-5f80-b6e7-69cba3f13e38','declared','{"severity": "SEV2"}'::jsonb,true,'2026-06-27T12:00:00'),
('01fb9d88-b9ab-574c-a52a-b3bd36a20aa0','bb020389-1d00-534d-ae92-b06e5866d2f9','6da32b93-6f3d-5f80-b6e7-69cba3f13e38','status_changed','{"to": "investigating"}'::jsonb,false,'2026-06-27T22:00:00'),
('a7174d5a-8e9d-5a6a-afef-170b4e485491','bb020389-1d00-534d-ae92-b06e5866d2f9','6da32b93-6f3d-5f80-b6e7-69cba3f13e38','status_changed','{"to": "monitoring"}'::jsonb,false,'2026-06-30T00:00:00'),
('d4cc8883-9ab2-53a6-a892-33d87fb52ce5','bb020389-1d00-534d-ae92-b06e5866d2f9','6da32b93-6f3d-5f80-b6e7-69cba3f13e38','status_changed','{"to": "resolved"}'::jsonb,false,'2026-07-02T12:00:00'),
('a6e6ec23-7331-50e4-8b39-b0e20c2b35c3','05147102-b8cb-5cd4-ad19-d43d2fc8c628','6da32b93-6f3d-5f80-b6e7-69cba3f13e38','declared','{"severity": "SEV1"}'::jsonb,true,'2026-07-02T09:00:00'),
('7a8d3949-2849-5481-b025-2ed30945e786','05147102-b8cb-5cd4-ad19-d43d2fc8c628','6da32b93-6f3d-5f80-b6e7-69cba3f13e38','status_changed','{"to": "investigating"}'::jsonb,false,'2026-07-02T10:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO incident_status_updates (id,incident_id,body) VALUES
('594b50ab-8ee4-5385-a4b8-943fd82635a5','bb020389-1d00-534d-ae92-b06e5866d2f9','We identified a failed deploy and rolled back. Monitoring recovery.'),
('dd35c5b6-d805-55cf-9e16-67fd275111f0','bb020389-1d00-534d-ae92-b06e5866d2f9','Payments fully restored. Retrospective to follow.')
ON CONFLICT (id) DO NOTHING;
INSERT INTO incident_retrospectives (id,incident_id,summary,contributing_factors,impact,status,published_at) VALUES
('a0f32d93-a82f-5b00-b000-69159189b0de','bb020389-1d00-534d-ae92-b06e5866d2f9','A bad config deploy took Payments API offline for ~40 minutes.','Missing canary stage; alert routing delayed by 5 min.','~1,200 failed checkouts; est. revenue impact moderate.','published','2026-06-28T12:00:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO retro_action_items (id,retro_id,description) VALUES
('da0d50e8-63f9-5e48-8395-8ae5fd0f33c5','a0f32d93-a82f-5b00-b000-69159189b0de','Add canary stage to payments deploy pipeline.'),
('4ce8882c-5db6-5739-82fb-d67a648e7c37','a0f32d93-a82f-5b00-b000-69159189b0de','Tune alert routing to page IC within 60s.')
ON CONFLICT (id) DO NOTHING;
UPDATE alerts SET incident_id='bb020389-1d00-534d-ae92-b06e5866d2f9' WHERE id='2508cec6-dfae-5876-8122-9ae3c10ac50d';
INSERT INTO kb_spaces (id,tenant_id,name,description,slug,scope,is_public,is_active) VALUES
('56a8a37f-0ecc-5412-8192-8e251834c2a7','56cc885c-37d4-5dc6-900d-1a7a6defec8b','IT Knowledge Base','Self-service help articles','acme-it-kb','tenant_wide',false,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_categories (id,space_id,name,display_order,is_active) VALUES
('d50ada84-c01a-5c36-ad81-d4aac3d4b9a0','56a8a37f-0ecc-5412-8192-8e251834c2a7','How-To',1,true),
('5c950194-114c-565b-9039-13635f9fc77d','56a8a37f-0ecc-5412-8192-8e251834c2a7','Troubleshooting',2,true),
('2922a07a-ddaa-58a7-b193-acd64fa61305','56a8a37f-0ecc-5412-8192-8e251834c2a7','Policies',3,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_tags (id,tenant_id,name) VALUES
('d6bf9d5c-97bd-5052-a06f-85d271f15ebd','56cc885c-37d4-5dc6-900d-1a7a6defec8b','vpn'),
('ebd18311-5c68-5fb6-af98-65572e379bb4','56cc885c-37d4-5dc6-900d-1a7a6defec8b','email'),
('5a9b596b-a31b-5739-9037-4157ba3af90c','56cc885c-37d4-5dc6-900d-1a7a6defec8b','printer')
ON CONFLICT (id) DO NOTHING;
INSERT INTO kb_articles (id,tenant_id,space_id,category_id,title,slug,body,excerpt,status,visibility,author_id,version,view_count,helpful_count,published_at,metadata) VALUES
('da916263-bf7e-5bb6-80e1-f3ceee8f1b28','56cc885c-37d4-5dc6-900d-1a7a6defec8b','56a8a37f-0ecc-5412-8192-8e251834c2a7','d50ada84-c01a-5c36-ad81-d4aac3d4b9a0','How to connect to the corporate VPN','acme-a1','Step 1: Install the VPN client. Step 2: Sign in with SSO. Step 3: Select the nearest gateway and connect.','Step 1: Install the VPN client. Step 2: Sign in with SSO. Step 3: Select the nea','published','internal','5073456e-2932-5df4-b218-9ce4e34553f1',1,142,30,'2026-06-22T12:00:00','{"seed": "piq-demo"}'::jsonb),
('cec037a4-eb70-5479-adad-449597b80283','56cc885c-37d4-5dc6-900d-1a7a6defec8b','56a8a37f-0ecc-5412-8192-8e251834c2a7','d50ada84-c01a-5c36-ad81-d4aac3d4b9a0','Reset your email password','acme-a2','Use the self-service portal at /reset, verify via SMS, then set a new password meeting the policy.','Use the self-service portal at /reset, verify via SMS, then set a new password m','published','public','5073456e-2932-5df4-b218-9ce4e34553f1',1,310,88,'2026-06-22T12:00:00','{"seed": "piq-demo"}'::jsonb),
('7d1b8d6f-e20b-52aa-8546-6fe054e06fe2','56cc885c-37d4-5dc6-900d-1a7a6defec8b','56a8a37f-0ecc-5412-8192-8e251834c2a7','5c950194-114c-565b-9039-13635f9fc77d','Fixing a paper jam on floor printers','acme-a3','Open tray 2, remove jammed sheet gently, close, then resume the print job from the panel.','Open tray 2, remove jammed sheet gently, close, then resume the print job from t','published','internal','5073456e-2932-5df4-b218-9ce4e34553f1',1,58,12,'2026-06-22T12:00:00','{"seed": "piq-demo"}'::jsonb),
('0d8ca246-aa68-53ff-bcf4-db3c4c386ba0','56cc885c-37d4-5dc6-900d-1a7a6defec8b','56a8a37f-0ecc-5412-8192-8e251834c2a7','5c950194-114c-565b-9039-13635f9fc77d','Troubleshooting Outlook calendar crashes','acme-a4','Rebuild the Outlook profile, clear the calendar cache, and re-sync. Escalate if OST is corrupt.','Rebuild the Outlook profile, clear the calendar cache, and re-sync. Escalate if ','published','agents_only','5073456e-2932-5df4-b218-9ce4e34553f1',1,21,5,'2026-06-22T12:00:00','{"seed": "piq-demo"}'::jsonb),
('e3dce391-f331-58f1-acb2-98d1daea365a','56cc885c-37d4-5dc6-900d-1a7a6defec8b','56a8a37f-0ecc-5412-8192-8e251834c2a7','2922a07a-ddaa-58a7-b193-acd64fa61305','Acceptable Use Policy','acme-a5','Company devices are for business use. Do not install unapproved software. Report incidents to IT.','Company devices are for business use. Do not install unapproved software. Report','draft','internal','5073456e-2932-5df4-b218-9ce4e34553f1',1,4,0,NULL,'{"seed": "piq-demo"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO asset_categories (id,tenant_id,name,is_active) VALUES
('e07c5a63-8a36-566a-8c48-47146f6c8985','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Hardware',true),
('3748203f-8c65-5613-9252-67768dc8171f','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Software',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO asset_types (id,tenant_id,category_id,name) VALUES
('599d0f4d-38c1-5a5b-b2ac-39a68d5a7ccf','56cc885c-37d4-5dc6-900d-1a7a6defec8b','e07c5a63-8a36-566a-8c48-47146f6c8985','Laptop'),
('99815d88-c634-510f-93ec-ea415eb83d67','56cc885c-37d4-5dc6-900d-1a7a6defec8b','e07c5a63-8a36-566a-8c48-47146f6c8985','Server'),
('2f3f477c-500f-5a1f-b223-c024d3134c10','56cc885c-37d4-5dc6-900d-1a7a6defec8b','3748203f-8c65-5613-9252-67768dc8171f','SaaS License')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vendors (id,tenant_id,name,contact_email,website,is_active) VALUES
('73bca55f-caad-55ff-a025-1f7b5f9a6b39','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Dell Technologies','support@dell.demo','https://dell.demo',true),
('5f22d49c-734b-566a-97bd-1913e65801d8','56cc885c-37d4-5dc6-900d-1a7a6defec8b','Atlassian','support@atlassian.demo','https://atlassian.demo',true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO assets (id,asset_tag,tenant_id,department_id,type_id,name,status,condition,serial_number,manufacturer,vendor_id,purchase_date,purchase_cost,warranty_expiry_date,assigned_to,assigned_at,metadata) VALUES
('a3acdf5b-b8e3-52c4-82c8-a632843be118','AST-ACME-001','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','599d0f4d-38c1-5a5b-b2ac-39a68d5a7ccf','Latitude 7440 - Casey','in_use','good','SN-LAT-0001','Dell','73bca55f-caad-55ff-a025-1f7b5f9a6b39','2025-01-15',1450.0,'2028-01-15','3e74b653-ba7f-5124-a06c-248e31ae2786','2026-06-02T12:00:00','{"seed": "piq-demo"}'::jsonb),
('2b728e4d-3a43-582a-ae38-e92e9411b2e8','AST-ACME-002','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','599d0f4d-38c1-5a5b-b2ac-39a68d5a7ccf','Latitude 7440 - Devin','in_use','good','SN-LAT-0002','Dell','73bca55f-caad-55ff-a025-1f7b5f9a6b39','2025-01-15',1450.0,'2028-01-15','cad34ad2-3796-524a-b2ea-319baacdd3a1','2026-06-02T12:00:00','{"seed": "piq-demo"}'::jsonb),
('4915e0ed-355f-55dd-bfe3-675fff68567b','AST-ACME-003','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','599d0f4d-38c1-5a5b-b2ac-39a68d5a7ccf','Latitude 5540 - Spare','in_stock','new','SN-LAT-0003','Dell','73bca55f-caad-55ff-a025-1f7b5f9a6b39','2025-01-15',1450.0,'2028-01-15',NULL,NULL,'{"seed": "piq-demo"}'::jsonb),
('e945cabf-b164-5d4e-94fe-92284422a4a5','AST-ACME-004','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','99815d88-c634-510f-93ec-ea415eb83d67','db-primary','in_use','good','SN-SRV-1001','Dell','73bca55f-caad-55ff-a025-1f7b5f9a6b39','2025-01-15',8200.0,'2028-01-15',NULL,NULL,'{"seed": "piq-demo"}'::jsonb),
('b9ebca0e-7682-5fe2-9d7f-500d87ff9001','AST-ACME-005','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','99815d88-c634-510f-93ec-ea415eb83d67','web-01','in_use','good','SN-SRV-1002','Dell','73bca55f-caad-55ff-a025-1f7b5f9a6b39','2025-01-15',8200.0,'2028-01-15',NULL,NULL,'{"seed": "piq-demo"}'::jsonb),
('02d51d18-8827-5182-8485-574dd82df976','AST-ACME-006','56cc885c-37d4-5dc6-900d-1a7a6defec8b','7ffd830b-4e1f-5067-94ce-9d6d79daafd7','2f3f477c-500f-5a1f-b223-c024d3134c10','Jira Software (50 seats)','in_use','new',NULL,'Atlassian','5f22d49c-734b-566a-97bd-1913e65801d8','2025-01-15',5000.0,'2028-01-15',NULL,NULL,'{"seed": "piq-demo"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO asset_relationships (id,tenant_id,source_asset_id,target_asset_id,relationship_type,created_by) VALUES
('1f0e54a9-9502-5a0f-be2d-cfc6ca5711de','56cc885c-37d4-5dc6-900d-1a7a6defec8b','02d51d18-8827-5182-8485-574dd82df976','b9ebca0e-7682-5fe2-9d7f-500d87ff9001','runs_on','6da32b93-6f3d-5f80-b6e7-69cba3f13e38'),
('e78c3c0a-1dd0-5ceb-b074-3d19f4107fa7','56cc885c-37d4-5dc6-900d-1a7a6defec8b','e945cabf-b164-5d4e-94fe-92284422a4a5','b9ebca0e-7682-5fe2-9d7f-500d87ff9001','connected_to','6da32b93-6f3d-5f80-b6e7-69cba3f13e38')
ON CONFLICT (id) DO NOTHING;
COMMIT;
