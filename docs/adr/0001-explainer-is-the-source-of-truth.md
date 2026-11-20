# The Explainer is the source of truth for what the learner studies

Each Topic has exactly one Explainer, and Recall Prompts are generated from that Explainer, not from Sources directly. Once the learner has edited an Explainer to match their own understanding, it is never regenerated: a newly added Source can only propose Suggested Edits, which the learner accepts or rejects one by one. Nothing the learner is tested on comes from anywhere but their Sources and their own edits. A Topic with no Source gets no Explainer, and Ask's general-knowledge answers can never be saved into one.

We chose this because the learner's corrected understanding is the most valuable thing in the Library, and re-deriving everything from Sources (the usual RAG approach) would silently overwrite it.

## Considered Options

- **Regenerate the Explainer whenever Sources change.** Simplest to build, but it throws away the learner's edits.
- **Generate Recall Prompts straight from Sources.** The prompts would then test what the Source says rather than what the learner has corrected it to.
- **Fill Topics without Sources from the model's general knowledge.** Lets you study sooner, but mixes unverified content into what you're tested on.

## Consequences

- Explainers need version history, so a bad Suggested Edit can be undone.
- Deleting a Source never changes an Explainer. Its citations are marked "Source removed" after a warning.
