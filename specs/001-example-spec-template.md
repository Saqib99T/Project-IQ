# 001 — Example Spec (copy this as a starting point)

**Status:** Draft  
**GitHub Issue:** #  
**Author:** saqibgm  
**Created:** 2026-05-07

---

## Goal
<!-- Replace with the real goal -->
Demonstrate the spec format. Delete this file once you have written your first real spec.

## Background & Context
Project IQ V2 uses Spec-Driven Development so that every feature is agreed upon
before any code is written.

## Acceptance Criteria
- [ ] Feature behaves as described in the API contract
- [ ] Edge cases are handled without unhandled exceptions
- [ ] Relevant tests are green

## API / Interface Contract

```
# Example — replace with real contract
POST /api/v1/example
Headers: Authorization: Bearer <token>
Body:   { "input": "string" }
Response 200: { "result": "string" }
Response 400: { "error": "validation message" }
```

## Data Model Changes
None for this example.

## Edge Cases & Error Handling
| Case | Expected behaviour |
|------|--------------------|
| Empty input | Return 400 with descriptive error |
| Auth token missing | Return 401 |

## Out of Scope
- UI changes
- Performance optimisation

## Open Questions
- [ ] Which service owns this endpoint?

## Implementation Notes
- Keep logic in the `core/` layer; expose via `action_server/`
