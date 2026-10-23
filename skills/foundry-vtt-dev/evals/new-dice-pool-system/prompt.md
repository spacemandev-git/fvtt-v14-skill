---
tags: [foundry-vtt-dev]
max_turns: 120
timeout_seconds: 3600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

I want to make a Foundry VTT game system for my homebrew game "Ember & Ash" (system id `ember-ash`), put it in ./ember-ash. It should work on Foundry v13 and v14.

Rules:
- Characters have three attributes, Might, Grace and Wits, each rated 1 to 5. They have HP where max HP = Might × 3 + 5, and current HP can't go above max.
- Skills are items with a rating from 0 to 3 and a linked attribute (might/grace/wits).
- To roll a skill you roll (attribute + skill rating) d6 and every 5 or 6 is a success. Post the roll to chat and show how many successes it got.
- NPCs only have a "threat" rating from 1 to 5 and HP (their max HP is threat × 4).

I need a character sheet (attributes, HP, skills list with a roll button per skill, and a biography), an NPC sheet, and a skill item sheet.
