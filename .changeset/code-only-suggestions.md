---
"@jagreehal/shepherd": patch
---

A one-click suggestion over code now carries code. When a model writes advice as the suggestion, such as "Use `toBe` for an exact match", with or without a full stop, `shepherd inline` keeps the comment and leaves the suggestion out. Text inside strings, template literals, docstrings and comments counts as code, including a string opened above the replaced lines, and suggestions on prose files such as Markdown docs still post.
