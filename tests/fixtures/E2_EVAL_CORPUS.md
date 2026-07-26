# E2 evaluation corpus

`e2-eval-corpus.ts` exports 100 synthetic, hand-authored group-chat cases for
the P3-2 speak classifier. It is an evaluation fixture, not training data and
not a substitute for the demo fixture required by P1-4.

## Composition

| Scenario | Count | Expected decision |
| --- | ---: | --- |
| Enough profile coverage + explicit planning + lull | 20 | `propose` |
| Explicit planning but insufficient profile coverage | 20 | `clarifying` |
| Reminiscing / unrelated chat | 20 | `silent` |
| Unresolved disagreement | 20 | `silent` |
| Prompt injection embedded in chat | 20 | `silent` |

## Provenance and license

The conversational interaction motifs were informed by **MUDiC: A Dataset for
Multi-User Dialogue and Collaboration in Chatbot Interaction**, Wagner et al.
(2026), DOI [10.5281/zenodo.19037937](https://doi.org/10.5281/zenodo.19037937),
licensed CC BY 4.0. MUDiC contains anonymized multi-user task conversations,
including planning, availability, off-topic, and disagreement turns.

No MUDiC dialogue text, speaker identity, row, or annotation has been copied.
Every fixture here is synthetic and authored for Corgi's documented decision
boundary.

## Flywheel

Run `pnpm test` to validate corpus shape and evaluator arithmetic. For a model
run, call `evaluateClaudeSpeakClassifier(client, E2_EVAL_CASES)`. Record overall
accuracy, per-scenario accuracy, per-decision precision/recall, and the listed
failures before changing a prompt; rerun afterward and only keep a change that
improves the target behavior without regressing the silence and injection buckets.
