# Shards Discord Bot — Privacy Policy

> **DRAFT — NOT YET EFFECTIVE.** This document is a working template based on the repository’s current implementation. It is not legal advice and does not establish compliance with any particular law. Before use with real users, the operator must complete every bracketed item, confirm the actual data controller and legal bases, identify the real hosting and storage arrangements, set a retention/deletion process, and obtain jurisdiction-specific legal review.

**Proposed effective date:** `[YYYY-MM-DD]`  
**Data controller / service operator:** `[FULL LEGAL NAME AND ENTITY TYPE]`  
**Privacy contact:** `[MONITORED PRIVACY EMAIL OR REQUEST URL]`  
**Postal address (if required):** `[BUSINESS / LEGAL ADDRESS]`  
**Privacy lead or representative (if applicable):** `[NAME / CONTACT OR “NOT APPLICABLE—CONFIRM WITH COUNSEL”]`

## 1. Scope

This Privacy Policy describes information handled through the Shards Discord Bot (the “Bot” or “Service”), the purposes for which it is handled, the current storage and retention limitations, and how to contact the operator. The Service is operated by the controller identified above (“Shards,” “we,” “us,” or “our”).

This draft describes the source code in this repository as of its publication. It is not a statement that the Bot is deployed or available to the public. The code supports self-hosted Ollama/Qwen inference, read-only public GitHub research, and a text-only task worker, but no production host, data region, model endpoint, or live Discord deployment is configured by this repository. The operator must identify the actual model host and other providers before publishing this policy; revise it if the deployed setup differs.

Discord separately collects and processes information under its own terms and privacy policy. This policy does not cover Discord’s independent processing, other bots, or third-party websites.

## 2. Information the Bot handles

The Bot does not request or use Discord’s privileged Message Content intent and does not intentionally ingest channel message history. It receives Discord interaction payloads when someone invokes a command. The current code uses or stores the following:

| Information | What the current Bot does with it |
| --- | --- |
| Discord user ID | Used to associate a task and model-usage record with its requester, enforce requester-level access, and apply the in-memory AI request limit. The `/hello` response also uses the invoking username transiently; usernames are not written to the task or usage ledgers. |
| Discord server (guild) ID | Stored with tasks and usage records created in a server, used to keep those views within that server, and paired with the requester ID for the in-memory AI request limit. Usage records from direct messages have no guild ID and remain scoped to the requesting user; task submission remains unavailable in direct messages. |
| Temporary AI admission-limit state | The Bot temporarily keeps requester/server keys and request timestamps in process memory to limit direct AI generation and simultaneous direct calls. It is not written to task or usage files; it resets when the process restarts and is not shared across Bot replicas. The default is five generated requests per minute per requester/server (or DM), one concurrent call per requester and per server/DM scope, and two concurrent direct calls per process; the operator can change the request and process-wide limits. |
| Interaction ID | Used as an idempotency key to avoid duplicate task records when the same interaction is retried. |
| Task request text | The text submitted with `/task submit` (up to 2,000 characters) is stored as plain text in the task ledger. Do not include passwords, tokens, payment data, sensitive personal information, or confidential material. |
| Task record and lifecycle metadata | A random task ID, state (such as queued, running, completed, failed, or cancelled), creation/update timestamps, attempt count, worker identifier when claimed, and a limited result or failure code. The configured worker processes text-only requests through the operator-selected Ollama endpoint; it has no GitHub write, shell, or other external-action tools. |
| Audit events | Task submission, worker claims, completion/failure, cancellation, and restart recovery are recorded with a task ID, actor/worker identifier, timestamp, action, and limited operational details. The request text is not copied into these event details. |
| Model-usage metadata | Successful model-call records include user ID, guild ID when available, model tag, source type, optional task ID, Ollama-reported prompt/completion token counts and duration, and timestamp. Metrics can be unavailable. Prompts and generated text are not copied into this ledger. The latest 20,000 records are retained; older records are removed as new records arrive. |
| Operational information | The process uses runtime and gateway state to answer `/system status`. It emits limited static error messages. On startup, it logs the Bot’s own Discord account ID; it is not designed to log raw task text or raw Discord API errors. |

Discord and the hosting provider may process additional technical information, such as connection and security logs, under their own roles and policies. The actual provider and region must be documented here before production launch.

## 3. Purposes and legal bases

The operator uses the information above to receive and display command responses; process AI requests through the configured model endpoint; limit AI request frequency and concurrent direct calls; save, identify, secure, and manage task requests; prevent duplicate submissions; limit task and usage views to the requester and server; recover interrupted work; measure model usage; maintain and secure the Bot; respond to support or legal requests; and comply with applicable law.

**Controller review required:** The operator must confirm and document the applicable legal basis for each purpose in every relevant jurisdiction before publication. Where the GDPR or similar laws apply, potential bases may include providing a feature requested by the user, legitimate interests in operating and securing the Service (subject to applicable balancing requirements), consent where legally required, or compliance with a legal obligation. This list is not a determination that a particular basis applies. If consent is used, the operator must implement a valid method to obtain and withdraw it.

## 4. How information is stored

Task data is stored in a JSON file at `SHARDS_TASK_STORE_PATH`, which defaults to `.data/tasks.json`. Model-usage metadata is stored separately at `SHARDS_USAGE_STORE_PATH`, which defaults to `.data/usage.json`; the usage ledger keeps at most the latest 20,000 records. Both stores use atomic file replacement and owner-only file permissions. These controls do not encrypt the files, provide tamper-evident audit history, or replace a managed database and access-control process.

The Docker Compose configuration places the task and usage files on `/data` in a persistent volume. An operator deploying the Bot must provide and protect that volume. Data may be accessible to authorised server/host operators and anyone with access to the machine, mounted storage, or backups. The JSON stores are designed for a single running Bot process and must not be shared between multiple replicas.

Task records are not end-to-end encrypted. Do not submit content that requires a higher level of confidentiality than this design provides.

## 5. Disclosure and service providers

The Bot sends interaction responses through Discord and uses Discord’s gateway and application command infrastructure. Discord’s processing is governed by Discord’s own policies. The Bot’s operator and authorised technical administrators may access the task ledger to operate, secure, troubleshoot, back up, or delete it.

The Bot sends prompts to the Ollama endpoint selected by the operator. The endpoint may run on the same machine or on another host; if hosted by a third party, that provider may receive the prompts and model outputs and must be identified here before launch. For research commands, the Bot also makes bounded read-only requests to GitHub's public API and reads only public repository metadata or permitted text files. It cannot access private repositories or write to GitHub. The actual Ollama host, infrastructure, storage, monitoring, and backup providers are not configured in this repository. **Before launch, list each provider, its role, data-access scope, processing location, and relevant privacy/security terms here.**

We may disclose information if reasonably necessary to comply with law or valid legal process, protect users or the Service, investigate abuse or security incidents, or establish, exercise, or defend legal claims. Any disclosure must be limited as required by applicable law.

## 6. International transfers

Discord and a future hosting or storage provider may process information in countries other than the user’s country. The production hosting region and transfer arrangements are not configured in this repository. Before launch, the operator must identify relevant countries and implement any legally required transfer mechanism, safeguards, notices, and risk assessment.

## 7. Retention and deletion

**Current implementation limitation:** The task ledger has no automatic time-based retention, no user-facing delete command, and no per-task purge operation. Task records and task audit events therefore remain until an authorised operator deletes or replaces the task file. The separate usage ledger retains only the latest 20,000 model-call records across all users; older usage records are dropped as new ones are added, with no time-based schedule. Copies may remain in backups or filesystem snapshots until those copies expire or are deleted under the operator’s backup practices.

Before accepting real user data, the operator should establish and publish a retention schedule, implement a reliable deletion process, address backups, and document any legal holds. A user may request access, correction, or deletion using the contact in the header; the operator will assess and respond as required by applicable law. The current software cannot fulfil such a request automatically, and deletion may require manual operator action and coordination with backups.

## 8. Security

We use measures implemented in the current code, including a minimal Discord intent set, ephemeral AI/task/usage/audit responses, requester/server checks, in-memory AI rate and concurrency limits, per-requester/server active-task limits, bounded request and result lengths, owner-only task/usage-file permissions, atomic file replacement, generic error logging, read-only public GitHub research, and limited recovery attempts for interrupted work. AI rate-limit counters reset on restart and are not shared across replicas. These measures reduce certain risks but do not guarantee security. The files are not encrypted, audit events are not tamper-proof, the filesystem is not a multi-tenant database, and the repository does not configure production monitoring, managed secrets, backups, or incident-response tooling.

Users should not submit secrets or sensitive information. The operator should store the Discord bot token in an appropriate secret manager in production, restrict host and backup access, keep software updated, define incident response and token rotation procedures, and avoid running multiple Bot replicas against the same task file.

## 9. Your choices and privacy rights

Depending on where you live, you may have rights to request access to, correction of, deletion of, restriction of, or objection to processing of personal information; to receive a portable copy; to withdraw consent where processing relies on consent; and to complain to a data-protection regulator. Rights and exceptions vary by jurisdiction.

To make a request, contact `[PRIVACY CONTACT]` and include enough information for the operator to locate the relevant task without sending passwords or Discord credentials. The operator may request reasonable verification, will use the information for handling the request, and will respond within applicable legal time limits. You may also contact the relevant supervisory authority or regulator.

The Bot does not currently provide a cookie-based web service, targeted advertising, or an analytics profile. Task requests and direct AI prompts are sent to the operator-configured Ollama endpoint for inference; generated task results are stored in the task ledger. Usage accounting stores metadata only, not prompts or generated text. Model output is not automatically used by the Bot to make decisions about users, and the Bot does not provide an action-approval or admin-control system in this version. The operator must verify the configured model host's data handling and training practices before launch.

## 10. Children

The Service is not directed to children and should not be used by anyone who does not meet the applicable age requirements for Discord and the laws where they live. The operator must determine and publish any child-specific notice, parental-consent process, or age restriction required for its intended audience. If you believe a child has submitted personal information, contact `[PRIVACY CONTACT]` so the operator can assess and respond.

## 11. Changes to this Policy

We may update this Policy to reflect changes in the Bot, its data flows, providers, law, or operating practices. The published Policy should show its effective date and explain how users will be notified of material changes. If a material change requires consent or another notice under applicable law, the operator will provide it before applying the change.

## 12. Contact and complaints

For privacy requests, questions, or complaints, contact:

- **Controller:** `[FULL LEGAL NAME]`
- **Email or request channel:** `[MONITORED PRIVACY CONTACT]`
- **Postal address (if applicable):** `[ADDRESS]`
- **Representative / privacy officer (if applicable):** `[DETAILS]`

Do not include bot tokens, passwords, or other credentials in a privacy request. You may also complain to the data-protection authority or regulator with jurisdiction over you or the controller.
