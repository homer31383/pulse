-- Post Pulse: department relations + Concept & Image Generation roster (2026-09-14)
-- Requires migrations/026_post_pulse_department_relations.sql.
-- 1. Link Concept & Image Generation <-> Generative Media Models & Platforms
--    (the video/motion layer lives there; still-image concept work here).
-- 2. Seed three character-consistency tools under Concept & Image Generation.
-- 3. Rewrite the Concept doc to explain the split.
-- Idempotent; the relation updates are no-ops if either department is missing.

update pp_departments set related_department_ids = array_remove(array_append(array_remove(related_department_ids, (select id from pp_departments where slug = 'generative-media-models')), (select id from pp_departments where slug = 'generative-media-models')), null)
where slug = 'concept-image-generation' and exists (select 1 from pp_departments where slug = 'generative-media-models');

update pp_departments set related_department_ids = array_remove(array_append(array_remove(related_department_ids, (select id from pp_departments where slug = 'concept-image-generation')), (select id from pp_departments where slug = 'concept-image-generation')), null)
where slug = 'generative-media-models' and exists (select 1 from pp_departments where slug = 'concept-image-generation');

update pp_departments set overview_doc = $doc$
Concept art, mood boards, storyboards, character design sheets, and early previs frames: the still-image, illustration-first work that turns a script and a director's references into pictures a studio can bid, plan, and pitch from. This department is one half of a pair. The video and motion execution layer — Runway, Seedance, Veo, Kling, Wan, Nano Banana, LTX Studio and the platforms around them — is tracked under Generative Media Models & Platforms, not here, and real production workflows combine both: concept a character in Midjourney or Leonardo, lock its identity with a reference, then animate or extend it with Runway or Seedance. If a tool you expect to see is missing from this list, check the related department before treating it as untracked.

What defines the tools tracked here is character and design consistency for still work: holding one face, one costume, one design language across dozens of frames from a single reference, without training a LoRA or building a dataset. That is the capability that moved concept work from "generate and hope" to something a supervisor can art-direct.

## Tier 1 — Automated {#tier-1}

Nothing tracked here. Nothing in concept work ships without an artist's selection and direction, and this tier should stay thin: generation is fast, but every frame that reaches a director has been chosen.

## Tier 2 — AI-assisted {#tier-2}

Character-consistency generation is production-usable for concept-art-quality work. Midjourney is the industry standard for identity lock: V7's Omni Reference replaced the older --cref flag with a dedicated reference panel, so a character portrait uploaded once anchors every subsequent generation. Leonardo AI pairs its character reference tools with PhotoReal mode and is positioned for game-style character sheets and iterative design rather than single hero illustrations. Ideogram is the strongest free-tier option, holding facial identity from a single uploaded reference photo with no LoRA training or multi-image dataset. The motion side of the same workflow — taking an approved concept into a moving shot — lives with the video tools under Generative Media Models & Platforms.

## Tier 3 — Artist-led {#tier-3}

Choosing the frame, the design language, and what the director actually responds to is still the concept artist's job. Generation moved the labour of producing options; the taste, the edit, and the presentation of a look are unchanged, and rights clearance for anything that reaches a client deck is a human decision.
$doc$
where slug = 'concept-image-generation';

insert into pp_tools (department_id, name, tier, host_app, status, vendor, blurb, attributes, source_urls) values
((select id from pp_departments where slug = 'concept-image-generation'), 'Midjourney', 'assisted', 'web', 'active', 'Midjourney',
 'V7 introduced Omni Reference, replacing the older --cref flag with a dedicated reference panel: upload a character portrait once, every subsequent generation pulls from that anchor. Industry standard for concept-art-quality character identity lock.',
 '{"output_type": "Still images; character identity lock via Omni Reference", "control": "Omni Reference panel (single portrait anchors later generations)"}'::jsonb,
 array['https://fast.io/resources/best-ai-character-generators-2026/']),
((select id from pp_departments where slug = 'concept-image-generation'), 'Leonardo AI', 'assisted', 'web', 'active', 'Leonardo AI',
 'Combines character reference tools with PhotoReal mode; positioned for game-style character sheets and iterative design rather than single hero illustrations.',
 '{"output_type": "Still images; character sheets and iterative design", "control": "Character reference tools + PhotoReal mode"}'::jsonb,
 array['https://www.lovart.ai/blog/6-best-ai-character-consistency-tools-2026']),
((select id from pp_departments where slug = 'concept-image-generation'), 'Ideogram', 'assisted', 'web', 'active', 'Ideogram',
 'Best free-tier option for character consistency — holds facial identity from a single uploaded reference photo, no LoRA training or multi-image dataset required.',
 '{"output_type": "Still images; facial identity from one reference photo", "control": "Single reference photo, no LoRA or dataset", "pricing": "Free tier available"}'::jsonb,
 array['https://fast.io/resources/best-ai-character-generators-2026/'])
on conflict (department_id, name) do update set
  tier = excluded.tier, host_app = excluded.host_app, status = excluded.status, vendor = excluded.vendor,
  blurb = excluded.blurb, attributes = excluded.attributes, source_urls = excluded.source_urls;

update pp_tools set doc_anchor = 'tier-2' where doc_anchor is null and department_id = (select id from pp_departments where slug = 'concept-image-generation');
update pp_tools set last_verified_at = '2026-09-14T12:00:00Z' where last_verified_at is null and department_id = (select id from pp_departments where slug = 'concept-image-generation');
