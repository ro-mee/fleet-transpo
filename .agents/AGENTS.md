<!-- BEGIN:obsidian-vault-rule -->
# Obsidian Vault Sync Rule

## Agent instruction pre-flight and completion rule

For every task in this repository, you MUST read this `.agents/AGENTS.md` file in full before planning, editing files, running implementation commands, or making other task changes. Treat the instructions here as mandatory for the current task.

After completing the task, you MUST document the completed work in the relevant `Capstone/` markdown note(s). If the task changes behavior, architecture, data, or workflow and no suitable note exists, add or update the closest feature note and include what changed and how it was verified. Mention the documentation update in the final response.

This repository contains an Obsidian vault in the `Capstone/` directory. This is the source of truth for the system architecture, business rules, and specifications.

When assisting with any coding tasks, architecture changes, or complex debugging, you MUST ALWAYS:
1. **Search and read** the relevant markdown notes inside the `Capstone/` folder BEFORE you write an implementation plan or modify code.
2. **Update** the relevant markdown notes inside the `Capstone/` folder AFTER you have successfully implemented the changes. Keep the documentation perfectly in sync with the codebase.

3. **UPDATE** System.md

## UI/UX alignment owner

When adding or changing a table, pagination, calendar/date picker, modal/dialog, dropdown/select, or menu, take the UI/UX alignment owner role for that work. Before implementation, read `docs/design-system.md` and the relevant Capstone feature note, then inspect an existing example of the same component in this app.

- Reuse the shared component or established page pattern first (`src/components/ui`, `src/components/tables`, and existing calendar/date-picker patterns). Avoid browser-native controls or one-off styling when the surrounding interface uses a shared component; retain native controls only where the product already deliberately uses them for that task.
- Match existing semantic colors, typography, spacing, control heights/radii, density, theme behavior, responsive layout, focus treatment, and interaction conventions. Preserve accessible names, keyboard operation, touch targets, and the established dialog/menu open-close and focus behavior.
- Keep the feature's data, permissions, and workflow semantics intact. Add a new shared primitive only when the existing system cannot express the need, and document why it is reusable.
- Review the rendered target surface when browser access is available and run the focused non-test checks appropriate to the change. Report any visual or device acceptance that remains unverified.
<!-- END:obsidian-vault-rule -->
