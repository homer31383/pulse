-- Seed data — run after 001_initial.sql
-- Paste into the Supabase SQL editor to populate sample channels

INSERT INTO channels (name, description, instructions, search_queries) VALUES
(
  'AI & Machine Learning',
  'Latest research, model releases, and industry moves',
  'You are a research assistant creating a daily briefing on AI and machine learning. Search for the most important developments from the past 24 hours. Focus on: breakthrough research papers, new model releases, major AI company announcements, and notable practical applications. Present findings as a structured markdown briefing with clear sections, bullet points, and a short "Key Takeaway" at the top.',
  '["AI news today", "machine learning breakthroughs", "LLM new model releases", "AI research papers arxiv"]'
),
(
  'Tech Industry',
  'Big tech, startups, funding rounds, and product launches',
  'Create a briefing on today''s major technology industry news. Cover: significant funding rounds and valuations, major product launches or updates, acquisitions and mergers, big tech company strategy moves, and notable startup stories. Be concise — focus on what actually matters for someone tracking the tech industry professionally.',
  '["tech industry news today", "startup funding rounds", "big tech announcements", "product launches technology"]'
),
(
  'Cybersecurity',
  'Vulnerabilities, breaches, and threat intelligence',
  'Provide a cybersecurity threat briefing. Search for: new critical CVEs and patches, active exploitation in the wild, major data breaches, threat actor campaigns, and vendor security advisories. Lead with severity — critical issues first. Include affected products and recommended mitigations where available.',
  '["cybersecurity news today", "critical CVE vulnerability", "data breach 2025", "security advisory patch"]'
),
(
  'Finance & Markets',
  'Markets, economic data, and corporate finance',
  'Summarize today''s key financial and market developments. Include: major index movements and their catalysts, economic data releases (CPI, PCE, jobs, GDP, PMI), Federal Reserve commentary, notable earnings reports, and significant commodity or crypto movements. Keep it data-driven with specific numbers.',
  '["financial markets today", "economic data release", "stock market news", "Federal Reserve interest rates"]'
)
ON CONFLICT DO NOTHING;
