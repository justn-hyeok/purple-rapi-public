-- Sources of the AI blog and free-token feeds. Safe to run again.
-- official: a vendor's own posts, shown in the AI blog card and searched for free offers.
-- aiBlog: an independent AI blog, shown in the card and still counted as coverage of official posts.
-- aiOnly: the feed also posts about other things, so only titles about AI are shown.
BEGIN;

INSERT INTO sources (id, kind, locator, collection_policy)
SELECT gen_random_uuid(), 'rss', v.locator, v.policy::jsonb
FROM (VALUES
  ('https://mistral.ai/rss.xml', '{"label":"Mistral","section":"tools","official":"true","visibility":"public"}'),
  ('https://aws.amazon.com/blogs/machine-learning/feed/', '{"label":"AWS Machine Learning","section":"tools","official":"true","visibility":"public"}'),
  ('https://devblogs.microsoft.com/foundry/feed/', '{"label":"Microsoft Foundry","section":"tools","official":"true","visibility":"public"}'),
  ('https://blogs.nvidia.com/feed/', '{"label":"NVIDIA","section":"tools","official":"true","aiOnly":"true","visibility":"public"}')
) AS v(locator, policy)
ON CONFLICT (kind, locator) DO NOTHING;

UPDATE sources SET updated_at = now(),
  collection_policy = collection_policy || '{"label":"Anthropic","section":"tools","official":"true"}'::jsonb
WHERE kind = 'html' AND locator = 'https://www.anthropic.com/news';

UPDATE sources SET updated_at = now(),
  collection_policy = collection_policy || '{"aiOnly":"true"}'::jsonb
WHERE kind = 'rss' AND locator = 'https://github.blog/changelog/feed/';

UPDATE sources SET updated_at = now(),
  collection_policy = collection_policy || '{"aiBlog":"true"}'::jsonb
WHERE kind = 'rss' AND locator IN (
  'https://simonwillison.net/atom/entries/',
  'https://www.latent.space/feed',
  'https://www.interconnects.ai/feed',
  'https://importai.substack.com/feed',
  'https://hamel.dev/index.xml',
  'https://lilianweng.github.io/index.xml'
);

COMMIT;
