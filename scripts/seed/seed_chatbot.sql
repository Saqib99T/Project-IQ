-- PIQ demo seed for the Chatbot DB. Idempotent: the whole block is a no-op if
-- demo conversations (sender_id LIKE 'seed-demo-%') already exist.
-- Ties to existing orgs (Blue Team org 5f75b273…, Acme demo org), existing
-- chat_apps (IT/HR/Accounting/General) and existing operators (ids 8, 9, 1).

DO $$
DECLARE
  blue_org text := '5f75b273-7b21-4877-8c49-79408ba094e1';
  acme_org text := 'demo-acme-org';
  c1 int; c2 int; c3 int; c4 int; c5 int; c6 int; c7 int; c8 int;
  q2 int; q6 int;
BEGIN
  IF EXISTS (SELECT 1 FROM conversations WHERE sender_id LIKE 'seed-demo-%') THEN
    RAISE NOTICE 'Chatbot demo seed already present — skipping.';
    RETURN;
  END IF;

  -- ===== Conversations =====
  INSERT INTO conversations (sender_id,app_id,user_id,user_name,org_id,product_id,channel,resolved,handoff_state,started_at,last_activity,ended_at)
  VALUES ('seed-demo-1','IT','casey.brooks@blue.demo','Casey Brooks',blue_org,'project-iq','internal',1,'bot_active', now()-interval '6 day', now()-interval '6 day' + interval '4 min', now()-interval '6 day' + interval '4 min') RETURNING id INTO c1;
  INSERT INTO conversations (sender_id,app_id,user_id,user_name,org_id,product_id,channel,resolved,handoff_state,assigned_operator_id,handoff_count,consent_given,started_at,last_activity,ended_at)
  VALUES ('seed-demo-2','IT','devin.flores@blue.demo','Devin Flores',blue_org,'project-iq','internal',1,'resolved',9,1,true, now()-interval '3 day', now()-interval '3 day' + interval '22 min', now()-interval '3 day' + interval '22 min') RETURNING id INTO c2;
  INSERT INTO conversations (sender_id,app_id,user_id,user_name,org_id,product_id,channel,resolved,handoff_state,started_at,last_activity,ended_at)
  VALUES ('seed-demo-3','HR','alex.romano@blue.demo','Alex Romano',blue_org,'project-iq','internal',1,'bot_active', now()-interval '2 day', now()-interval '2 day' + interval '3 min', now()-interval '2 day' + interval '3 min') RETURNING id INTO c3;
  INSERT INTO conversations (sender_id,app_id,user_id,user_name,org_id,product_id,channel,resolved,handoff_state,frustration_score,started_at,last_activity)
  VALUES ('seed-demo-4','Accounting','devin.flores@blue.demo','Devin Flores',blue_org,'account-wise','internal',0,'bot_active',0.3, now()-interval '1 day', now()-interval '1 day' + interval '2 min') RETURNING id INTO c4;
  INSERT INTO conversations (sender_id,app_id,user_id,user_name,org_id,product_id,channel,resolved,handoff_state,started_at,last_activity)
  VALUES ('seed-demo-5','IT','casey.brooks@blue.demo','Casey Brooks',blue_org,'project-iq','internal',0,'bot_active', now()-interval '5 hour', now()-interval '5 hour' + interval '6 min') RETURNING id INTO c5;
  INSERT INTO conversations (sender_id,app_id,user_id,user_name,org_id,product_id,channel,resolved,handoff_state,low_conf_streak,frustration_score,consent_given,started_at,last_activity)
  VALUES ('seed-demo-6','Accounting','alex.romano@blue.demo','Alex Romano',blue_org,'account-wise','internal',0,'waiting_operator',2,0.6,true, now()-interval '2 hour', now()-interval '90 min') RETURNING id INTO c6;
  INSERT INTO conversations (sender_id,app_id,user_id,user_name,org_id,product_id,channel,resolved,handoff_state,started_at,last_activity,ended_at)
  VALUES ('seed-demo-7','IT','jordan.patel@acme.demo','Jordan Patel',acme_org,'project-iq','internal',1,'bot_active', now()-interval '4 day', now()-interval '4 day' + interval '5 min', now()-interval '4 day' + interval '5 min') RETURNING id INTO c7;
  INSERT INTO conversations (sender_id,app_id,user_id,user_name,org_id,product_id,channel,resolved,handoff_state,frustration_score,started_at,last_activity,ended_at)
  VALUES ('seed-demo-8','General','sam.nguyen@acme.demo','Sam Nguyen',acme_org,'project-iq','internal',1,'bot_active',0.5, now()-interval '1 day', now()-interval '1 day' + interval '3 min', now()-interval '1 day' + interval '3 min') RETURNING id INTO c8;

  -- ===== Messages =====
  INSERT INTO messages (conversation_id,sender,text,intent,app_id,user_id) VALUES
    (c1,'user','How do I reset my email password?','password_reset','IT','casey.brooks@blue.demo'),
    (c1,'bot','You can reset it from the self-service portal at /reset. Verify via SMS, then set a new password.','password_reset','IT',NULL),
    (c1,'user','Great, that worked. Thanks!','affirm','IT','casey.brooks@blue.demo'),
    (c2,'user','My VPN keeps disconnecting every few minutes.','vpn_issue','IT','devin.flores@blue.demo'),
    (c2,'bot','Let me connect you with a support operator.','handoff','IT',NULL),
    (c2,'operator','Hi Devin, I see intermittent drops from your client. Please update the VPN client to 4.2 and retry.','','IT',NULL),
    (c2,'user','Updated and it is stable now, thank you!','affirm','IT','devin.flores@blue.demo'),
    (c3,'user','How many annual leave days do I have?','leave_balance','HR','alex.romano@blue.demo'),
    (c3,'bot','Full-time staff accrue 25 days per year. Check the HR portal for your current balance.','leave_balance','HR',NULL),
    (c4,'user','Where can I download last month invoice?','invoice_download','Accounting','devin.flores@blue.demo'),
    (c4,'bot','Invoices are under Billing → Statements in Account-Wise. Want me to open it?','invoice_download','Accounting',NULL),
    (c5,'user','How do I connect to the corporate VPN?','vpn_setup','IT','casey.brooks@blue.demo'),
    (c5,'bot','Install the VPN client, sign in with SSO, pick the nearest gateway and connect. See the KB article for screenshots.','vpn_setup','IT',NULL),
    (c6,'user','My invoice total looks wrong and nobody has replied.','billing_dispute','Accounting','alex.romano@blue.demo'),
    (c6,'bot','I am sorry about that. I am escalating you to an operator now.','handoff','Accounting',NULL),
    (c7,'user','Printer on floor 2 is jammed again.','printer_jam','IT','jordan.patel@acme.demo'),
    (c7,'bot','Open tray 2, gently remove the jammed sheet, close it, then resume from the panel.','printer_jam','IT',NULL),
    (c8,'user','The dashboard is not loading for me.','app_error','General','sam.nguyen@acme.demo'),
    (c8,'bot','Try a hard refresh (Ctrl+Shift+R). If it persists, clear cache and re-login.','app_error','General',NULL);

  -- ===== Feedback =====
  INSERT INTO feedback (conversation_id,type,app_id,user_id,rating,comments) VALUES
    (c1,'thumbs_up','IT','casey.brooks@blue.demo',5,'Quick and clear answer.'),
    (c3,'thumbs_up','HR','alex.romano@blue.demo',4,NULL),
    (c7,'thumbs_up','IT','jordan.patel@acme.demo',5,'Fixed it in a minute.'),
    (c8,'thumbs_down','General','sam.nguyen@acme.demo',2,'Refresh did not help, still broken.');

  -- ===== Handoff queue + consent + operator messages =====
  INSERT INTO handoff_queue (conversation_id,sender_id,app_id,priority,trigger_reason,status,operator_id,user_org_id,support_org_id,product_id,channel,queued_at,assigned_at,resolved_at,wait_time_secs,handle_time_secs,return_to_bot,closing_note,agent_rating)
  VALUES (c2,'seed-demo-2','IT',3,'explicit_request','resolved',9,blue_org,blue_org,'project-iq','internal', now()-interval '3 day', now()-interval '3 day' + interval '1 min', now()-interval '3 day' + interval '22 min', 60, 1260, true, 'Advised VPN client upgrade to 4.2; resolved.', 5) RETURNING id INTO q2;
  INSERT INTO handoff_queue (conversation_id,sender_id,app_id,priority,trigger_reason,status,user_org_id,support_org_id,product_id,channel,queued_at,queue_position)
  VALUES (c6,'seed-demo-6','Accounting',2,'frustration','waiting',blue_org,blue_org,'account-wise','internal', now()-interval '85 min', 1) RETURNING id INTO q6;

  INSERT INTO handoff_consent_log (sender_id,conversation_id,consented) VALUES
    ('seed-demo-2',c2,true),
    ('seed-demo-6',c6,true);

  INSERT INTO operator_messages (conversation_id,queue_id,operator_id,message_text,sent_at,delivered_at,read_at) VALUES
    (c2,q2,9,'Hi Devin, I see intermittent drops from your client. Please update the VPN client to 4.2 and retry.', now()-interval '3 day' + interval '2 min', now()-interval '3 day' + interval '2 min', now()-interval '3 day' + interval '3 min'),
    (c2,q2,9,'Glad that fixed it. I will close this out — reach out any time.', now()-interval '3 day' + interval '20 min', now()-interval '3 day' + interval '20 min', now()-interval '3 day' + interval '21 min');

  -- ===== Canned responses (operator macros) =====
  INSERT INTO canned_responses (org_id,app_id,title,body,shortcut,created_by) VALUES
    (blue_org,'IT','VPN client upgrade','Please upgrade your VPN client to the latest version (4.2+), reboot, and reconnect. Let me know if drops continue.','/vpn','blue@example.com'),
    (blue_org,'IT','Password reset steps','Go to /reset, verify via SMS, then set a new password meeting the complexity policy (12+ chars).','/pwd','blue@example.com'),
    (blue_org,'Accounting','Invoice location','Invoices live under Billing → Statements. Select the month and click Download PDF.','/invoice','blue@example.com'),
    (blue_org,'IT','Greeting','Hi! Thanks for reaching out to IT support. Could you share your device name and what you were doing when the issue started?','/hi','blue.opt@example.com'),
    (blue_org,'IT','Closing note','Glad I could help! I am closing this chat now — reopen any time if you need more assistance.','/bye','blue.opt@example.com');

  -- ===== Notifications =====
  INSERT INTO notifications (user_id,app_id,type,title,body,read) VALUES
    ('casey.brooks@blue.demo','IT','ticket_updated','Your ticket was updated','Agent Jordan Patel replied to "Laptop won''t boot after update".',false),
    ('devin.flores@blue.demo','IT','handoff_resolved','Chat resolved','Your VPN support chat was resolved by an operator.',true),
    ('alex.romano@blue.demo','Accounting','handoff_waiting','You are in the queue','An operator will be with you shortly regarding your billing question.',false),
    ('jordan.patel@acme.demo','IT','kb_article_published','New help article','"Fixing a paper jam on floor printers" was published.',false),
    ('blue.opt@example.com','IT','handoff_assigned','New chat assigned','A new support chat has been assigned to you.',true),
    ('sam.nguyen@acme.demo','General','ticket_assigned','Ticket assigned','Your issue "dashboard not loading" was logged as a ticket.',false);

  RAISE NOTICE 'Chatbot demo seed inserted: 8 conversations + related rows.';
END $$;
