-- Catalog seed: mirrors src/verticals/*/catalog.ts.
-- Idempotent — safe to re-run.

insert into verticals (slug, name, name_ne, tagline, description, status, sort) values
  ('pandit', 'Ceremonies & Rites', 'कर्मकाण्ड',
   'Shraddha and ancestral rites, performed at Kathmandu temples on your behalf.',
   'We arrange qualified pandits at Gokarna and Pashupatinath for shraddha, tarpan, and related rites — following your family''s tradition, on the correct tithi. You join by video from anywhere; the recording is always yours, free.',
   'active', 1),
  ('fitness', 'Fitness Coaching', 'तन्दुरुस्ती',
   'Coaching that fits your kitchen — dal bhat included.',
   'Personal training and nutrition coaching from certified Nepali coaches, built around the food you actually eat and the schedule you actually keep.',
   'coming_soon', 2),
  ('tutoring', 'Tutoring', 'शिक्षण',
   'One-on-one tutoring from Nepali educators, in your timezone.',
   'Math, science, and Nepali language tutoring for diaspora kids, taught remotely by experienced Nepali teachers.',
   'coming_soon', 3),
  ('bookkeeping', 'Bookkeeping', 'लेखा',
   'Monthly books for small businesses, kept by Nepali accountants.',
   'Reliable monthly bookkeeping for diaspora-owned small businesses at a price that makes sense.',
   'coming_soon', 4)
on conflict (slug) do update set
  name = excluded.name, name_ne = excluded.name_ne, tagline = excluded.tagline,
  description = excluded.description, status = excluded.status, sort = excluded.sort;

insert into services (id, vertical_slug, name, summary, price_cents, billing_type, billing_interval, price_note, capacity_limit, status, sort) values
  ('shraddha-basic', 'pandit', 'Annual Shraddha — Basic',
   'Tarpan and pinda daan performed on your ancestor''s tithi. Live video, recording included, tithi stored for annual reminders.',
   14900, 'one_time', null, 'per ceremony · +$49 each additional ancestor', null, 'active', 1),
  ('gokarna-shraddha-full', 'pandit', 'Gokarna Shraddha — Full',
   '90-minute ceremony with senior pandit and assistant, full samagri, photographs, live video, and recording.',
   29900, 'one_time', null, 'per ceremony', null, 'active', 2),
  ('gokarna-shraddha-complete', 'pandit', 'Gokarna Shraddha — Complete',
   'The full ceremony plus sida daan and brahmin bhojan, with priority scheduling on your tithi.',
   49900, 'one_time', null, 'per ceremony', null, 'active', 3),
  ('sohra-shraddha-bundle', 'pandit', 'Sohra Shraddha — 16-day Bundle',
   'Daily tarpan through all of Pitru Paksha, performed on your behalf with regular photo and video updates.',
   39900, 'one_time', null, 'seasonal · limited capacity', 15, 'active', 4),
  ('tripindi-pitru-dosh', 'pandit', 'Tripindi Shraddha / Pitru Dosh',
   'Extended rite with two pandits for ancestral appeasement, arranged with full samagri.',
   34900, 'one_time', null, 'per ceremony', null, 'active', 5),
  ('rudrabhishek-pashupatinath', 'pandit', 'Rudrabhishek at Pashupatinath',
   'Rudrabhishek performed at Pashupatinath in your name, with live video and recording.',
   12900, 'one_time', null, 'per ceremony', null, 'active', 6),
  ('kundali-pdf', 'pandit', 'Kundali (Birth Chart)',
   'A traditional Bikram Sambat kundali prepared by a jyotish, delivered as a PDF.',
   4900, 'one_time', null, 'delivered in 5 days', null, 'active', 7),
  ('muhurat-selection', 'pandit', 'Muhurat Selection',
   'An auspicious date and time selected by a jyotish for your ceremony, travel, or new beginning.',
   3900, 'one_time', null, 'add-on friendly', null, 'active', 8),
  ('fitness-plan', 'fitness', 'Plan',
   'A custom training program or diet plan, delivered in about five days with one revision included.',
   4900, 'one_time', null, 'one-time · $79 for training + diet', null, 'coming_soon', 1),
  ('fitness-coached', 'fitness', 'Coached',
   'Program, diet, weekly async check-ins, form checks, messaging, and monthly plan updates.',
   9900, 'subscription', 'month', '/month · billed quarterly', null, 'coming_soon', 2),
  ('fitness-premium', 'fitness', 'Premium',
   'Everything in Coached plus two live video sessions per month and priority responses.',
   15900, 'subscription', 'month', '/month · limited slots', null, 'coming_soon', 3)
on conflict (id) do update set
  name = excluded.name, summary = excluded.summary, price_cents = excluded.price_cents,
  billing_type = excluded.billing_type, billing_interval = excluded.billing_interval,
  price_note = excluded.price_note, capacity_limit = excluded.capacity_limit,
  status = excluded.status, sort = excluded.sort;
