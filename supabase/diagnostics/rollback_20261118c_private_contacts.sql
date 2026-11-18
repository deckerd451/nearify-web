-- Removes the table and every contact people saved to their account on /save/.
-- People saved while signed out are in their browsers and are not affected.
drop table if exists public.private_contacts;
