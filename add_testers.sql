-- Requires tester_emails and support_staff tables created by earlier SQL.
insert into public.tester_emails(email) values('pelumiephraim9@gmail.com'),('westchaserlogistics@gmail.com') on conflict do nothing;
insert into public.support_staff(user_id) select id from auth.users where lower(email) in('pelumiephraim9@gmail.com','westchaserlogistics@gmail.com') on conflict do nothing;
