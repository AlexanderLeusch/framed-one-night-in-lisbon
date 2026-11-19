-- ### Checks the database rules of supabase/schema.sql against two made-up accounts. Paste it into the Supabase SQL editor
-- ### and run it: it ends with an error on purpose, "RULE CHECK (rolled back): ...", which undoes everything it did, so no
-- ### test account or run stays behind. Every part should read "ok"; a "FAIL" means a rule is missing.
do $$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  res text := '';
  n int;
begin
  insert into auth.users (id, email, aud, role) values (a, 'rule-check-a@example.invalid', 'authenticated', 'authenticated'),
                                                       (b, 'rule-check-b@example.invalid', 'authenticated', 'authenticated');
  -- player B: a name and one run
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.drivers (name) values ('RuleB');
  insert into public.runs (mode, time, veh, stars) values ('city', 70, 'bike', 2);
  execute 'reset role';
  -- player A tries everything that must be refused
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin insert into public.drivers (name) values ('ruleb'); res := res || 'FAIL same name other case allowed; '; exception when others then res := res || 'ok name taken; '; end;
  insert into public.drivers (name) values ('RuleA');
  begin insert into public.drivers (name) values ('Second'); res := res || 'FAIL two names; '; exception when others then res := res || 'ok one name per account; '; end;
  insert into public.runs (mode, time, veh, stars) values ('city', 61.5, 'car', 3);
  res := res || 'ok own run; ';
  begin insert into public.runs (mode, time, veh, stars) values ('city', 60, 'car', 3); res := res || 'FAIL second run within 10 s; '; exception when others then res := res || 'ok too fast refused; '; end;
  begin insert into public.runs (driver_id, mode, time, veh, stars) values (b, 'city', 20, 'car', 3); res := res || 'FAIL run for someone else; '; exception when others then res := res || 'ok not for others; '; end;
  begin insert into public.runs (mode, time, veh, stars) values ('city', 2, 'car', 3); res := res || 'FAIL impossible time; '; exception when others then res := res || 'ok impossible time refused; '; end;
  begin update public.runs set time = 11; res := res || 'FAIL update allowed; '; exception when others then res := res || 'ok no update; '; end;
  begin delete from public.runs; res := res || 'FAIL delete allowed; '; exception when others then res := res || 'ok no delete; '; end;
  begin update public.drivers set name = 'Hacked' where id = b; get diagnostics n = row_count; res := res || case when n = 0 then 'ok cannot rename others; ' else 'FAIL renamed other; ' end; exception when others then res := res || 'ok cannot rename others; '; end;
  insert into public.heists (escape, drive, veh) values (200, 61.5, 'car');
  res := res || 'ok own heist; ';
  begin insert into public.heists (escape, drive, veh) values (190, 61.5, 'car'); res := res || 'FAIL second heist within 10 s; '; exception when others then res := res || 'ok heist too fast refused; '; end;
  begin insert into public.heists (driver_id, escape, drive, veh) values (b, 100, 20, 'car'); res := res || 'FAIL heist for someone else; '; exception when others then res := res || 'ok heist not for others; '; end;
  begin insert into public.heists (escape, drive, veh) values (0, 60, 'car'); res := res || 'FAIL impossible escape; '; exception when others then res := res || 'ok impossible escape refused; '; end;
  begin insert into public.heists (escape, drive, total, veh) values (300, 60, 11, 'car'); res := res || 'FAIL own total; '; exception when others then res := res || 'ok total is added up by the database; '; end;
  begin delete from public.heists; res := res || 'FAIL heist delete allowed; '; exception when others then res := res || 'ok no heist delete; '; end;
  select count(*) into n from public.heist_board where total = 261.5;
  res := res || 'heist rows ' || n || ' (expect 1); ';
  select count(*) into n from public.board_all where mode = 'city';
  res := res || 'board rows ' || n || ' (expect 2); ';
  select count(*) into n from public.board_month where mode = 'city';
  res := res || 'month rows ' || n || ' (expect 2); ';
  execute 'reset role';
  -- a visitor without an account
  execute 'set local role anon';
  begin insert into public.runs (mode, time, veh, stars) values ('city', 50, 'car', 3); res := res || 'FAIL anon wrote; '; exception when others then res := res || 'ok anon cannot write; '; end;
  select count(*) into n from public.board_all;
  res := res || 'anon sees ' || n || ' rows (expect 2)';
  raise exception 'RULE CHECK (rolled back): %', res;
end $$;
