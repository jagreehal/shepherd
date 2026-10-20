---
name: python
description: Python rules for a code review (services, workers, Django, FastAPI, Flask). Flags code that trusts input, loses errors, blocks or misbehaves under load in ways ruff and mypy miss. Covers queries and commands built from input, unsafe deserialisation, missing authorization on views, unvalidated input, swallowed exceptions, blocking calls in async code, outbound calls with no timeout, mutable defaults and module state shared across requests, ORM N+1 and unbounded queries, transactions that commit half the work, naive datetimes, and API and model contract changes. Use as a review lens or as a stamp rule pack.
---

# python

Python lets almost anything run, so the defects show up in production rather
than at build time. Review whether this change keeps input away from
interpreters, keeps errors visible, stays non-blocking where it is async, and
keeps state from leaking between requests.

## Review

- **injection** [refuse]: SQL takes input through parameters, commands through argument lists, file paths through a containment check. Flag: f-strings or `%` into `cursor.execute`, `text()` or `.raw()`/`.extra()`; `subprocess` with `shell=True` and input; `os.system`; `open(os.path.join(root, user_path))` with no check that the resolved path stays under root; `eval`/`exec` on input. Why: injection and path traversal.
- **unsafe-deserialization** [refuse]: Untrusted data never reaches `pickle`, `marshal`, `shelve`, `yaml.load` without `SafeLoader`, or `torch.load` without `weights_only=True`. Flag: unpickling a request body, cache value or uploaded file; `yaml.load(data)`. Why: remote code execution.
- **view-authz** [refuse]: Every new view, route or endpoint checks authentication and the caller's right to the resource. Flag: a Django view without `login_required`/permission classes where neighbours have them, a FastAPI route without the auth dependency, a lookup by id with no owner or tenant filter. Why: the endpoint is public or exposes other users' data.
- **validate-input**: Request data is parsed with the framework's schema (Pydantic, DRF serializers, Django forms) before use, and only declared fields are written. Flag: `request.json`/`request.POST` passed straight to a model constructor or `update(**data)`, a serializer with `fields = "__all__"` on a write path. Why: callers set fields like `is_staff` or `tenant_id`.
- **exception-handling**: Exceptions are caught narrowly, keep their cause, and are logged once with the traceback. Flag: bare `except:` or `except Exception: pass`, `raise NewError(...)` inside `except` without `from err`, `logger.error(str(e))` without `exc_info`, a broad catch that returns a default and hides a failure. Why: the cause of the incident is lost, or a real error becomes wrong data.
- **async-blocking**: `async def` code never makes blocking calls. Flag: `requests`, `time.sleep`, synchronous database drivers, file I/O or CPU-heavy work inside an `async def` view or task without `run_in_executor`/`to_thread`; a sync ORM call from async Django without `sync_to_async`. Why: one call stalls the event loop for every request.
- **outbound-timeout**: HTTP, database and queue calls set timeouts, and retries are bounded with backoff. Flag: `requests.get(url)` with no `timeout`, an `httpx` client with timeouts disabled, `while True` retry loops. Why: requests hang indefinitely and exhaust workers.
- **shared-state**: Nothing request-specific lives in mutable defaults, module globals or class attributes. Flag: `def f(items=[])` or `={}`, a module-level dict used as a cache with no bound or lock, request data stored on a class attribute or a global client mutated per request. Why: data leaks between calls and requests, and memory grows.
- **orm-query-shape**: ORM access fetches what the code uses in a bounded number of queries. Flag: related objects accessed in a loop without `select_related`/`prefetch_related`/`selectinload`, `.all()` on a growing table in a request, a list endpoint with no pagination, `len(queryset)` instead of `.count()`. Why: N+1 queries and memory that grows with the table.
- **transaction-scope**: Multi-step writes that must succeed together run in one transaction, and side effects (emails, tasks, webhooks) fire after commit. Flag: two related writes outside `transaction.atomic()`/a session transaction, a Celery task enqueued inside a transaction that might roll back (use `on_commit`). Why: half-written data, or a task that runs against a row that does not exist.
- **datetime-aware**: Datetimes are timezone-aware and in UTC at boundaries. Flag: `datetime.now()` or `utcnow()` for stored or compared times, comparing naive and aware values, parsing timestamps without a zone. Why: off-by-hours bugs around DST and across servers, or a `TypeError` at runtime.
- **contract-change**: Changes to models, serialised response shapes and public functions are deliberate and paired with a migration. Flag: a renamed or removed model field with no migration, a new non-null column with no default, a changed response key, a removed keyword argument in a shared module. Why: data or clients break at deploy.

## Fix

- Prefer: parameterised queries through the ORM or driver, the framework's schema and permission classes, `logger.exception`, `raise ... from err`, `httpx`/`requests` with explicit timeouts, and `transaction.on_commit`.
- Never touch: dependency pins (`pyproject.toml`, `requirements*.txt`, lockfiles), existing migrations, and settings modules beyond the change.
- Escalate: `view-authz` and `contract-change` breaks, new migrations, and any change to authentication or middleware settings.
