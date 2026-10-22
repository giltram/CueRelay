# 

Keep commit messages in English, start with a lowercase letter, and keep them short and casual, e.g. `add semester tab selection` or `fix an adding course bug`.

# Engineering Principles

## 1. Core Philosophy

This project is designed for long-term maintainability and AI-agent development.

The primary architectural goal is **Codex Readability**: a fresh coding agent must be able to understand, navigate, modify, and verify the project efficiently using only repository contents.

Correctness, security, and explicit requirements are non-negotiable. Among correct solutions, prefer the one that minimizes cognitive load, coupling, hidden dependencies, and required context.

Core principles:

- Repository structure is more reliable than conversation memory.
- Explicit architecture is better than implicit conventions.
- Simplicity is better than cleverness.
- Clear boundaries are better than tightly coupled convenience.
- Maintainability takes priority over short-term implementation speed.
- Prefer designs that remain understandable as the project grows.

## 2. Codex Readability First

Optimize the codebase for comprehension by a fresh agent with no previous conversation context.

Requirements:

- Use descriptive, consistent names for files, functions, types, and modules.
- Keep files focused on a clear responsibility.
- Keep control flow and data flow explicit.
- Minimize hidden state, implicit behavior, and unnecessary indirection.
- Avoid oversized files, god objects, deeply nested logic, and unnecessary abstractions.
- Prefer existing conventions and straightforward solutions.
- Make important assumptions and invariants discoverable in the repository.
- Do not rely on undocumented knowledge from previous sessions.

A module should be understandable from its documentation, public interface, direct dependencies, and relevant tests without reading the entire repository.

If understanding a small change requires investigating many unrelated modules, treat this as a possible architecture problem.

## 3. Functional Modularity

Organize the project into cohesive modules with explicit responsibilities and boundaries.

Rules:

- Each module owns one well-defined area of responsibility.
- Every module exposes a clear public interface.
- Internal implementation details must remain private.
- Modules communicate through explicit interfaces.
- Avoid cross-module access to internal implementation.
- Prefer high cohesion and low coupling.
- Shared functionality should have clear ownership.
- Do not create abstractions or modules without a concrete architectural purpose.

Prefer the smallest modular design that preserves clear boundaries.

Do not sacrifice architectural clarity merely to reduce the number of files.

## 4. Dependency Discipline

The module dependency graph must remain directed and acyclic.

Hard constraints:

- No circular dependencies, including indirect cycles.
- No unnecessary upward dependencies.
- Higher-level orchestration may depend on lower-level modules, but lower-level modules must not depend on their consumers.
- Cross-module dependencies must follow documented architectural boundaries.
- Avoid bidirectional coupling.
- Avoid introducing global shared state as a shortcut.

When a dependency cycle appears:

1. Identify the underlying responsibility or boundary problem.
2. Consider extracting a shared contract, inverting the dependency, or redesigning the affected modules.
3. Prefer the solution with the simplest resulting dependency graph.
4. Update architecture documentation and relevant tests.

Do not hide architectural problems behind wrappers or workarounds.

## 5. Architecture as External Memory

The repository, not the agent's conversation history, is the source of truth.

Maintain `docs/architecture.md` as the architecture entry point.

It should document:

- Overall system structure.
- Module responsibilities and ownership.
- Module dependency relationships.
- Important entry points and data flows.
- Public interfaces and architectural constraints.
- Important architectural decisions and their rationale.

Use Mermaid diagrams or other text-based, version-controlled diagrams when they improve understanding.

For sufficiently complex modules, maintain a local README documenting:

- Purpose and responsibilities.
- Public APIs and contracts.
- Direct dependencies.
- Important invariants.
- Key files and test locations.

Keep documentation concise and synchronized with the implementation.

When architecture changes, update the relevant documentation in the same task.

## 6. Context Management

Never assume that knowledge from a previous Codex session is available or accurate.

At the beginning of a task:

1. Read the applicable `AGENTS.md` instructions.
2. Consult `docs/architecture.md` for architectural orientation.
3. Identify the modules relevant to the task.
4. Read their documentation, interfaces, and relevant tests.
5. Inspect additional dependencies only when necessary.

Prefer targeted exploration over loading the entire repository.

For complex work, record implementation plans, important decisions, and unresolved constraints in repository files so that a fresh session can resume without relying on conversation summaries.

If documentation conflicts with implementation, investigate and resolve the discrepancy.

## 7. Continuous Architecture Improvement

Continuously evaluate opportunities to improve:

- Codex readability.
- Modularity and cohesion.
- Dependency direction and coupling.
- Cyclomatic and structural complexity.
- Duplication and unnecessary abstractions.
- Testability and observability.
- Overall architectural health.

Actively identify architectural degradation rather than allowing it to accumulate.

Refactoring is encouraged when:

- Module responsibilities become unclear.
- Dependency boundaries are violated.
- Circular dependencies emerge.
- Complexity makes changes difficult to reason about.
- Repeated patches indicate a structural problem.
- A module becomes difficult to test or maintain.

Prefer structural fixes over accumulating local workarounds.

However:

- Do not refactor solely for aesthetic reasons.
- Do not introduce speculative abstractions.
- Do not expand the scope of a task without a clear benefit.
- Prefer incremental, behavior-preserving refactoring.
- Preserve external contracts unless changes are explicitly authorized.
- Complete the requested task rather than entering an endless optimization loop.

After completing a task, assess whether further architectural improvements are warranted. Report unrelated improvements separately instead of implementing them automatically.

## 8. Implementation Workflow

Before significant changes:

1. Identify the affected modules and their contracts.
2. Understand current behavior and available tests.
3. Evaluate architectural implications.
4. Choose the simplest maintainable implementation.
5. For complex changes, create a concise execution plan.

During implementation:

- Respect module boundaries and dependency rules.
- Keep changes focused and traceable.
- Address root causes rather than symptoms.
- Refactor affected code when necessary for a clean implementation.
- Add or update relevant tests.

After implementation:

1. Run relevant tests and static checks.
2. Check for circular dependencies and boundary violations.
3. Review the change for unnecessary complexity.
4. Update affected architecture documentation.
5. Report changes, verification results, and remaining architectural concerns.

Never claim that a check passed unless it was actually executed.

## 9. Refactoring Safety

Refactoring must preserve intended behavior unless behavior changes are explicitly requested.

For significant refactors:

- Establish baseline behavior through existing or new tests.
- Define the intended architectural improvement.
- Prefer small, independently verifiable steps.
- Validate interfaces and integration points.
- Remove obsolete code and documentation.
- Avoid mixing unrelated feature work with large structural changes.

If the implementation becomes increasingly dependent on patches and exceptions, reconsider the underlying design instead of extending the workaround chain.

## 10. Agent Collaboration

Maintain one coherent architectural source of truth.

Multi-agent collaboration is optional, not a design requirement.

When using multiple agents:

- Divide work along well-defined module boundaries.
- Define shared interfaces before parallel implementation.
- Avoid concurrent conflicting edits.
- Ensure all agents follow the same architecture documentation.
- Integrate and verify cross-module behavior.

Prefer a single coherent implementation process when parallelization would increase coordination cost or architectural inconsistency.

## 11. Decision-Making Authority

The agent may autonomously:

- Improve the internal structure of affected modules.
- Extract cohesive components.
- Simplify dependencies.
- Eliminate unnecessary complexity.
- Improve tests and relevant documentation.
- Fix architectural violations within the authorized task scope.

For major changes to public APIs, data models, or unrelated modules, explain the tradeoffs and request approval when necessary.

Choose solutions based on correctness, simplicity, architectural consistency, and long-term Codex readability.

## Final Principle

**The project must remain understandable without relying on any agent's memory.**

Every significant architectural decision should improve, or at least preserve, the ability of a fresh agent to understand the relevant system from the repository itself.

Build software that can be understood, changed, tested, and safely refactored one module at a time.







## Code Review Rules

### Correctness and Regressions

- Flag changes that introduce demonstrable incorrect behavior, regressions, security vulnerabilities, or data loss.
- Check compatibility with existing public contracts.
- Identify missing tests for consequential behavioral changes.
- Prioritize reproducible defects over speculative concerns.

### Module Boundaries

- Flag new circular dependencies, including indirect cycles.
- Flag imports that violate documented module boundaries.
- Flag changes that expose private module internals to unrelated modules.
- Prefer fixing dependency direction over adding workarounds.

### Codex Readability

- Flag changes that introduce hidden dependencies, unclear ownership, or unnecessary complexity when they materially impair maintainability.
- A fresh agent should be able to understand a changed module from its interface, direct dependencies, documentation, and tests.
- Do not flag style preferences unless they create a concrete maintenance risk.

### Architectural Integrity

- Check whether changes preserve documented architectural invariants.
- Flag new cross-module coupling that undermines existing boundaries.
- Flag duplicated business logic when it creates inconsistent behavior or ownership.
- Recommend the smallest maintainable correction.

### Review Quality

- Report actionable findings, not general advice.
- Include affected files and precise locations.
- Explain the concrete failure scenario and its impact.
- Distinguish verified defects from architectural risks.
- Do not invent issues to fill a review.
- Do not request unrelated refactoring.
- Keep review read-only; do not modify code.
