---
description: Project structure conventions and file organization rules
---

# Project Structure Rules

## Directory Organization

| Directory | Purpose |
|-----------|---------|
| `core/` | Rasa NLU/Dialog (config, training data, models) |
| `action_server/` | Custom Rasa actions + GLPI service |
| `admin/` | Admin API + UI + KB + config |
| `common/` | Shared utilities (config_manager, conversation_db, analytics) |
| `docs/` | **ALL documentation files (.md, .pdf, .pptx)** |
| `scripts/` | Utility scripts |
| `tests/` | Test files |

## Rules

1. **Documentation**: Always keep `.md`, `.pdf`, `.pptx` files in `docs/` folder
2. **No code mixing**: Each app (Core, Action Server, Admin) has its own folder
3. **Shared code**: Common utilities go in `common/`
4. **KB data**: Knowledge base files go in `admin/knowledge_base/`
