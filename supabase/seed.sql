-- Seed-Events fuer Mainfranken (Wuerzburg, Schweinfurt, Aschaffenburg)
-- content_hash = md5(lower(title) || '|' || starts_at || '|' || lower(city))  -> deterministischer Dedupe-Schluessel
-- Idempotent: bei gleichem content_hash wird aktualisiert statt dupliziert.

insert into public.events
  (title, description, starts_at, ends_at, location_name, city, address, url, organizer, tags, is_free, price, source, content_hash)
values
  ('Würzburg Web Dev Meetup #42',
   'Monatliches Treffen der Webentwickler-Community. Talks zu React, TypeScript und Web Performance.',
   '2026-07-08 18:30+02', '2026-07-08 21:00+02',
   'Posthalle Würzburg', 'Würzburg', 'Bahnhofplatz 2a, 97070 Würzburg',
   'https://example.org/wue-webdev-42', 'Webdev Würzburg',
   array['webdev','react','typescript','meetup'], true, null, 'seed',
   md5('würzburg web dev meetup #42|2026-07-08 18:30+02|würzburg')),

  ('KI Stammtisch Mainfranken',
   'Offener Austausch zu KI, LLMs und Agenten. Für Einsteiger und Profis.',
   '2026-07-15 19:00+02', '2026-07-15 22:00+02',
   'IHK Würzburg-Schweinfurt', 'Würzburg', 'Mainaustraße 33, 97082 Würzburg',
   'https://example.org/ki-stammtisch', 'KI Hub Mainfranken',
   array['ki','llm','agents','stammtisch'], true, null, 'seed',
   md5('ki stammtisch mainfranken|2026-07-15 19:00+02|würzburg')),

  ('DevOps Day Schweinfurt',
   'Ganztägige Konferenz zu CI/CD, Kubernetes und Cloud-Infrastruktur.',
   '2026-07-22 09:00+02', '2026-07-22 17:00+02',
   'Konferenzzentrum Maininsel', 'Schweinfurt', 'Maininsel 1, 97421 Schweinfurt',
   'https://example.org/devops-day-sw', 'DevOps Franken',
   array['devops','kubernetes','cloud','konferenz'], false, '49 EUR', 'seed',
   md5('devops day schweinfurt|2026-07-22 09:00+02|schweinfurt')),

  ('Python User Group Aschaffenburg',
   'Lightning Talks rund um Python, Data Science und Automatisierung.',
   '2026-07-10 18:00+02', '2026-07-10 20:30+02',
   'TH Aschaffenburg', 'Aschaffenburg', 'Würzburger Str. 45, 63743 Aschaffenburg',
   'https://example.org/pug-ab', 'Python Aschaffenburg',
   array['python','datascience','meetup'], true, null, 'seed',
   md5('python user group aschaffenburg|2026-07-10 18:00+02|aschaffenburg')),

  ('Cyber Security Awareness Workshop',
   'Praxis-Workshop zu Phishing, Passwort-Hygiene und sicherer Software.',
   '2026-07-18 14:00+02', '2026-07-18 18:00+02',
   'Zentrum für Digitale Innovationen', 'Würzburg', 'Friedrich-Bergius-Ring 15, 97076 Würzburg',
   'https://example.org/cybersec-ws', 'Digitales Mainfranken',
   array['security','workshop','cybersecurity'], false, '25 EUR', 'seed',
   md5('cyber security awareness workshop|2026-07-18 14:00+02|würzburg')),

  ('Startup & Tech Networking Abend',
   'Lockeres Networking für Gründer, Entwickler und Tech-Interessierte aus der Region.',
   '2026-07-25 19:30+02', '2026-07-25 23:00+02',
   'Vogel Convention Center', 'Würzburg', 'Max-Planck-Str. 7/9, 97082 Würzburg',
   'https://example.org/startup-networking', 'Gründerzentrum Würzburg',
   array['networking','startup','tech'], true, null, 'seed',
   md5('startup & tech networking abend|2026-07-25 19:30+02|würzburg'))
on conflict (content_hash) do update set
  title = excluded.title,
  description = excluded.description,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  location_name = excluded.location_name,
  city = excluded.city,
  address = excluded.address,
  url = excluded.url,
  organizer = excluded.organizer,
  tags = excluded.tags,
  is_free = excluded.is_free,
  price = excluded.price,
  source = excluded.source;
