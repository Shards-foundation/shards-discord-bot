# Discord bot quality review

**Research date:** 25 October 2026

## What a strong Discord bot needs

A production bot should request only the Gateway intents and permissions its implemented features require. Discord separates command visibility from authorization, so sensitive operations still need checks in the handler. Shards currently requests only the `Guilds` intent; this review did not find a reason to add privileged intents or wider access. [1] [2] [8]

Slow interaction handlers need to acknowledge within three seconds, then finish through the interaction response flow while the token remains valid. User-specific task, usage, and AI results should remain private. Discord recommends filtering allowed mentions when messages contain user-controlled data. Its Message Resource caps message content at 2,000 characters. [3] [5]

Discord REST rate limits are dynamic. The bot should rely on discord.js's route-aware handling and honor Discord's returned retry metadata rather than adding copied, fixed per-route limits. Separately, this application should bound expensive model work and queue admission before calling Ollama. OWASP identifies missing resource limits and expensive downstream calls as API risks. [4] [11]

AI research inputs and retrieved repository files are untrusted. Deterministic code—not a model instruction—must authorize tools, validate arguments and destinations, bound results, and reject unknown operations. Generated output should be treated as untrusted before it is displayed or used elsewhere. Risk evaluation should continue throughout design, deployment, and use. [12] [13] [14] [25]

Privacy and operational controls also matter. Discord's developer policies require use of API data only for stated functionality and an accessible, accurate privacy policy. OWASP recommends bounded input validation, separate authorization, and redaction of secrets and sensitive content in logs. [6] [7] [9] [10]

Reliability guidance favors bounded queues, finite retries, idempotency, explicit signal handling, health checks, and tested storage recovery. A single-process queue should not be described as cluster-safe. [20] [21] [22] [23] [24] Use supported Node.js releases, deterministic CI, dependency review, secret controls, and a non-root container where compatible. [15] [16] [17] [18] [19]

## Findings and changes for Shards

The inspected checkout uses Node.js 24.17 and discord.js 14. It already has private deferred AI/task/usage/audit responses, mention suppression, a durable single-process task ledger, bounded read-only public GitHub tools, model timeouts and output limits, CI, and a non-root container. The baseline before this branch was 72 passing offline tests and no high-severity production dependency findings.

Three concrete gaps were addressed. First, direct `/ai ask` and `/ai research` had no application admission control. This branch adds a rolling default limit of five generated requests per minute per requester/server (or DM) and two simultaneous direct model calls per process. These counters are intentionally in memory, reset on restart, and are not shared between replicas. `/usage summary` now reports the configured values.

Second, the durable task ledger had a 10,000-record global capacity but no per-member backpressure. New submissions and retries now enforce a configurable default of five queued/running tasks per requester per server, with a supported range of 1–100. Idempotent duplicate submissions still return the existing task, and limits do not affect another member or server.

Third, a stored task result could be longer than Discord's content limit. All constructed command replies are now capped at 1,900 JavaScript string code units and include a truncation notice when shortened. AI, task, usage, audit, repository-lookup, and immediate command paths retain mention suppression. The cap is below Discord's 2,000-character message-content maximum. [5]

The AI limiter allows at most one simultaneous direct call per requester and per server/DM scope, in addition to the process-wide cap. Offline regression tests cover the rolling limiter, requester and guild isolation, fairness, concurrency release on failure, private rate-limit responses before Ollama is called, queue-cap enforcement and retries, long task output, and interaction acknowledgement. No live Discord writes or paid model API calls are part of this work.

Final local verification passed: syntax checks, 83 offline tests, the production dependency audit (zero findings), the offline command-registration preview, and whitespace checks. Docker Compose validation was not run because the Compose CLI is unavailable in this environment.

## Remaining priorities

The public `/github repo` command currently returns public repository metadata; it does not inspect CI runs, issues, or pull requests. `/approve` and `/admin` are also not implemented. Those capabilities should wait for explicit authorization and actor-bound policy controls rather than being exposed through model-generated actions. Add further read-only GitHub operations only after tests cover their token scope, public/private repository behavior, API limits, and response bounds.

A hermetic indirect-injection regression now verifies that retrieved README text is labeled untrusted and that an unknown write-like tool name is denied by deterministic code. This checks the execution boundary; it does not prove that any model is immune to prompt injection. Queue-depth/age diagnostics and a documented data-retention/deletion process remain worthwhile. Do not add custom Discord REST retry logic unless tests against the installed discord.js version show a real gap.

## References

[1]: https://docs.discord.com/developers/events/gateway "Gateway - Discord Developer Documentation"
[2]: https://docs.discord.com/developers/interactions/application-commands "Application Commands - Discord Developer Documentation"
[3]: https://docs.discord.com/developers/interactions/receiving-and-responding "Receiving and Responding to Interactions - Discord Developer Documentation"
[4]: https://docs.discord.com/developers/topics/rate-limits "Rate Limits - Discord Developer Documentation"
[5]: https://docs.discord.com/developers/resources/message "Message Resource - Discord Developer Documentation"
[6]: https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy "Discord Developer Policy"
[7]: https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service "Discord Developer Terms of Service"
[8]: https://docs.discord.com/developers/platform/oauth2-and-permissions "OAuth2 and Permissions - Discord Developer Documentation"
[9]: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html "Input Validation Cheat Sheet"
[10]: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html "Logging Cheat Sheet"
[11]: https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/ "API4:2023 Unrestricted Resource Consumption"
[12]: https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html "AI Agent Security Cheat Sheet"
[13]: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html "LLM Prompt Injection Prevention Cheat Sheet"
[14]: https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/ "LLM05:2025 Improper Output Handling"
[15]: https://nodejs.org/en/about/previous-releases "Node.js Releases"
[16]: https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html "Node.js Security Cheat Sheet"
[17]: https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review "Dependency Review - GitHub Docs"
[18]: https://docs.github.com/code-security/secret-scanning/about-secret-scanning "Secret Scanning - GitHub Docs"
[19]: https://docs.docker.com/build/building/best-practices/ "Build Best Practices - Docker Docs"
[20]: https://nodejs.org/learn/modules/backpressuring-in-streams "Backpressuring in Streams - Node.js"
[21]: https://learn.microsoft.com/en-us/azure/architecture/patterns/retry "Retry Pattern - Azure Architecture Center"
[22]: https://nodejs.org/api/process.html "Process - Node.js Documentation"
[23]: https://docs.docker.com/reference/compose-file/services/ "Compose Services - Docker Docs"
[24]: https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-209.pdf "NIST SP 800-209: Security Guidelines for Storage Infrastructure"
[25]: https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence "Artificial Intelligence Risk Management Framework: Generative AI Profile"
