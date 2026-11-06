-- Read-only, configuration-only checks after a coordinated 010 deployment.
with functions(signature) as(values
 ('contact_owner_preferences()'),('contact_save_preferences(text,text,text,text,boolean,boolean,text)'),
 ('contact_details_action(uuid,text,text[])'),('community_signal_connection(uuid,boolean)'),
 ('community_signal_discover_v2()'),('get_saved_people()'),('save_nearify_person(uuid,uuid)')
), resolved as(select to_regprocedure('public.'||signature) as id from functions),
private_tables(name) as(values('contact_preferences_private'),('contact_disclosures'),('contact_detail_requests'),('person_saves'),('contact_permission_rollouts')),
triggers(tablename,name) as(values('profiles','private_contact_preferences'),('contact_preferences_private','prune_contact_disclosures'),('connections','connection_approval_guard'),('community_signals','community_signal_block_guard'))
select 'One-time permission rollout recorded' as check_name,exists(select 1 from public.contact_permission_rollouts where id='separate-details-v1') as passed
union all select 'Public profile sharing fields are masked',not exists(select 1 from public.profiles where public_email is not null or public_phone is not null or linkedin_url is not null or website_url is not null or coalesce(share_email,false) or coalesce(share_phone,false) or preferred_contact_method is not null)
union all select 'Private tables deny direct client access and have RLS',
 (select bool_and(coalesce(c.relrowsecurity,false) and case when c.oid is null then false else not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') end) from private_tables p left join pg_class c on c.oid=to_regclass('public.'||p.name))
union all select 'Seven permission APIs installed and authenticated-only',
 (select bool_and(case when id is null then false else has_function_privilege('authenticated',id,'EXECUTE') and not has_function_privilege('anon',id,'EXECUTE') end) from resolved)
union all select 'All four consent/masking triggers enabled',
 (select bool_and(coalesce(t.tgenabled<>'D',false)) from triggers e left join pg_trigger t on t.tgrelid=to_regclass('public.'||e.tablename) and t.tgname=e.name)
union all select 'Legacy inbox helper is not directly executable by clients',
 case when to_regprocedure('public.web_inbox_connection_only()') is null then false else not has_function_privilege('authenticated','public.web_inbox_connection_only()','EXECUTE') and not has_function_privilege('anon','public.web_inbox_connection_only()','EXECUTE') end;
