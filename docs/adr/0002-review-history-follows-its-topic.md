# Review history survives a deleted Recall Prompt but not a deleted Topic

Deleting a Recall Prompt is a soft delete: the prompt leaves the Topic and the due queue, and its Reviews stay in the Topic's Review history, showing the question as it was worded when answered. Deleting a Topic is a hard delete that cascades to its Recall Prompts and, through them, to their Reviews. Review history is something the learner reads *about a Topic*; once the Topic is gone there is nowhere to show it, and keeping orphaned rows would only matter for statistics v1 does not have.

## Considered Options

- **Soft-delete Topics too.** Keeps everything, but every Topic read (lists, Tags, Practice, Goals) would need to filter deleted Topics, for history nobody can see.
- **Keep Reviews with no prompt (`ON DELETE SET NULL`).** Keeps rows for later statistics, but they lose their Topic and cannot be shown anywhere.

## Consequences

- `reviews.prompt_id` is `ON DELETE CASCADE`; prompt soft delete never touches Reviews.
- The delete-Topic warning should say its Review history goes too.
- If cross-Topic statistics (e.g. retention over time) are added later, revisit this: they would need Topic delete to keep (or summarise) Reviews.
