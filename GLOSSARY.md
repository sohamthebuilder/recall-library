# recall-library

A personal learning tool for one learner: it ingests content from many places and makes sure what was learned is remembered and can be revised at any time.

## Language

### Content

**Source**:
One piece of content the learner has added: a book file (PDF/EPUB), a YouTube video, a blog URL, an uploaded .md/.pdf file, or a Note.
_Avoid_: Document, material, resource, upload

**Note**:
A Source the learner types in directly, such as something a colleague said or their own thought.
_Avoid_: Memo, snippet, jotting

**Topic**:
A unit of knowledge the learner wants to remember, such as "Kafka consumer groups". A Topic draws on one or more Sources, and a Source covers many Topics; a Topic with no Source yet has nothing to study until one is added.
_Avoid_: Subject, concept, chapter, note

**Tag**:
A label that groups related Topics, such as "system design". A Topic can have many Tags; Tags have no hierarchy.
_Avoid_: Category, folder, section

**Library**:
Everything the learner has added: all their Sources and Topics.
_Avoid_: Collection, knowledge base, vault

### Remembering

**Recall Prompt**:
A question about a Topic that the learner answers from memory, generated from the Topic's Explainer (or written by the learner). Its kind is one of Explain, Compare, Apply or Why.
_Avoid_: Card, flashcard, quiz question

**Review**:
One occasion when the learner explains the answer to a Recall Prompt in their own words and gets a grade and feedback on what they missed. The grade (the learner's, if they overrule the AI's) decides when the Recall Prompt comes back.
_Avoid_: Revision session, attempt, flashcard flip

**Practice**:
A Review the learner chooses to do before the Recall Prompt is due. A poor grade brings the prompt back sooner; a good grade does not push it further out.
_Avoid_: Cramming, free review, extra review

**Explainer**:
The one condensed, visual explanation of a Topic (an infographic or an animated walkthrough), combining every Source linked to that Topic and citing each. The learner can change it to match their own understanding, and it is what Recall Prompts are generated from.
_Avoid_: Summary, notes, cheat sheet

**Suggested Edit**:
A change to an Explainer that the AI proposes when a new Source adds to or contradicts it. The learner accepts or rejects each one; their own edits are never overwritten without asking.
_Avoid_: Update, merge, regeneration

**Goal**:
An optional named set of Topics with a deadline, such as "Interview prep by Dec 15". Reviews for its Topics are scheduled so they are well remembered by that date, and the learner can choose to get a daily reminder while it runs.
_Avoid_: Deck, exam, plan, course

**Ask**:
A question the learner puts to their Library, answered from their own Sources with citations. If the Sources don't cover it, the answer says so and any general-knowledge answer is clearly marked as not from the Library and can never become part of an Explainer.
_Avoid_: Chat, search, query
