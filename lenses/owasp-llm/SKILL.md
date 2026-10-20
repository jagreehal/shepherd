---
name: owasp-llm
description: >
  OWASP LLM Top 10 (2025) and Agentic Top 10 (2026) rules for a code review of
  code that calls a model, runs an agent or serves MCP tools, in any language.
  Flags untrusted content mixed into instructions, model output used as code,
  SQL, HTML or a command, tools with more power than their job, destructive
  actions without a person's approval, secrets and personal data in prompts,
  poisoned retrieval and memory, unbounded tokens and loops, MCP servers without
  auth or scoped tools, unpinned models and tools, agent-to-agent trust, and
  answers presented as fact without grounding. Each finding cites the LLM or ASI
  id. Use as a review lens or as a stamp rule pack.
source: github:OWASP/secure-agent-playbook/plugins/ai-security-skills@65d4efd2cd0b081d52101e9708792b944e4ddebb
license: CC-BY-4.0
---

# owasp-llm

Review a change to code that builds prompts, calls a model, runs an agent loop,
defines tools or serves an MCP server. Treat everything the model reads as
attacker-controlled once any untrusted text reaches it, and everything the
model writes as untrusted input. Cite the OWASP id with the rule id.

## Review

- **instruction-boundary**: Untrusted text (user input, documents, web pages, emails, tool results) enters the prompt fenced as data, apart from system instructions. Flag: user or retrieved text concatenated into the system prompt, tool output fed back with no boundary. Why: prompt injection and goal hijack. (LLM01, ASI01)
- **output-as-input** [refuse]: Model output passes through the same validation, encoding and parameterization as user input before it reaches a shell, interpreter, query, HTML, file path or URL. Flag: `eval` or `exec` of generated code outside a sandbox, generated SQL run as is, model text rendered as raw HTML or Markdown with images. Why: injection and code execution. (LLM05, ASI05)
- **least-agency** [refuse]: Each tool does one narrow job with typed, constrained parameters and runs with the caller's permissions. Flag: a tool taking a free-form shell command, SQL, path or URL, a tool with a service account broader than the user's. Why: one injected instruction gains everything the tool can do. (LLM06, ASI02, ASI03)
- **human-approval**: Destructive, financial, external-send or permission-changing tool calls wait for a person's confirmation the model cannot supply. Flag: delete, pay, email or deploy executed straight from a model decision. Why: an injected goal acts unchecked. (LLM06, ASI09)
- **prompt-secrets**: Prompts, tool descriptions and system messages hold no keys, credentials, internal URLs or personal data beyond what the task needs. Flag: an API key or connection string in a prompt, a whole customer record sent to a model. Why: leakage and system prompt extraction. (LLM02, LLM07)
- **retrieval-scope**: Retrieval and vector queries filter by the caller's permissions, and ingested documents come from a known source. Flag: a vector search with no tenant or ACL filter, user uploads indexed into a shared store. Why: data leaks across users and poisoned context. (LLM04, LLM08)
- **memory-integrity**: Persistent agent memory records its source, stays scoped per user or session, and holds no instructions written by untrusted input. Flag: model output written to shared memory, memory replayed into later sessions as trusted. Why: one poisoned turn steers future runs. (ASI06)
- **bounded-consumption**: Model calls set max tokens and a timeout, agent loops cap steps and tool calls, and per-user rate or budget limits apply. Flag: a loop until the model says done, no `max_tokens`, user-chosen context size. Why: cost and denial of service. (LLM10, ASI08)
- **mcp-auth** [refuse]: An MCP server on HTTP or SSE authenticates clients, validates Origin, uses TLS and restricts CORS, and its tools reach only the paths and hosts they need. Flag: a network transport with no auth, a file tool with no root, a fetch tool that can reach internal addresses. Why: anyone on the network drives the tools. (LLM06, ASI02)
- **tool-description**: Tool names, descriptions and schemas state exactly what the tool does and carry no instructions to the model. Flag: a description broader or narrower than the code, imperative text aimed at the model. Why: tool poisoning and misuse. (LLM01, ASI02)
- **pinned-supply**: Models, MCP servers, tools and prompt packages are pinned to a version or digest from a trusted source, and the client passes each server only the env vars it needs. Flag: `latest`, a server launched through `npx` unpinned, the whole environment passed to a server. Why: a swapped component takes over the agent. (LLM03, ASI04)
- **agent-trust**: Messages between agents are authenticated and validated like external input, and one agent's failure stops the chain. Flag: an agent acting on another's output as instructions, retries that loop between agents. Why: cascading compromise. (ASI07, ASI08, ASI10)
- **grounded-output**: Factual answers that drive decisions cite retrieved sources or say they are unverified, and code acting on them checks the result. Flag: generated values stored as fact, an answer shown with no source. Why: misinformation users trust. (LLM09, ASI09)

## Fix

- Prefer: the SDK's structured messages and tool schemas, enums over free text, the repository's existing validation, sandbox and auth helpers.
- Never touch: model provider keys, system prompts owned by another team, MCP client configuration outside the change.
- Escalate: `least-agency`, `human-approval` and `mcp-auth` changes that remove a control, new tools with write or network reach, and switching model providers.
