---
tags: [foundry-vtt-dev]
max_turns: 120
timeout_seconds: 3600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Write me a small Foundry VTT module called "quick-checks" (put it in ./quick-checks) for v14. As GM I want a button somewhere obvious (chat sidebar or the token scene controls) that opens a dialog where I type a roll formula (like 1d20 + @abilities.dex.mod) and a label. That posts a chat card with a "Roll" button. When a player clicks the button it rolls the formula using their own assigned character's roll data and posts the result to chat. It must work with any game system. Also expose a function other macros can call, like game.modules.get("quick-checks").api.requestCheck({formula, label}).
