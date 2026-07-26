import { describe, expect, it } from "vitest";

import {
  renderPlanCardTemplate,
  type PlanObject,
} from "../../../src/transport/PlanCardTemplate.js";

describe("renderPlanCardTemplate", () => {
  it("renders activity, venue, datetime, cost tier, rationale, and RSVP states", () => {
    const plan: PlanObject = {
      planId: "plan-1",
      version: 3,
      status: "proposed",
      activity: "climbing gym session",
      venue: {
        name: "Boulders Club",
        sourceTool: "search_venues",
        refId: "v-1",
      },
      datetime: "2026-08-02T14:00:00-07:00",
      costTier: "low",
      attendees: {
        sam: "yes",
        jess: "pending",
        alex: "no",
      },
      rationale:
        "Sam mentioned climbing, Jess asked for low cost, and no one flagged Saturday conflicts.",
    };

    const rendered = renderPlanCardTemplate(plan);

    expect(rendered).toMatchInlineSnapshot(`
      {
        "details": {
          "activity": "climbing gym session",
          "costTier": "low",
          "datetime": "2026-08-02T21:00:00.000Z",
          "venue": "Boulders Club",
        },
        "headline": "Climbing gym session at Boulders Club",
        "kind": "corgi.plan-card",
        "planId": "plan-1",
        "rationale": "Sam mentioned climbing, Jess asked for low cost, and no one flagged Saturday conflicts.",
        "rsvp": [
          {
            "attendee": "alex",
            "state": "no",
          },
          {
            "attendee": "jess",
            "state": "pending",
          },
          {
            "attendee": "sam",
            "state": "yes",
          },
        ],
        "status": "proposed",
        "version": 3,
      }
    `);
  });

  it("keeps original datetime string when input is invalid", () => {
    const plan: PlanObject = {
      planId: "plan-2",
      version: 1,
      status: "revising",
      activity: "dinner",
      venue: {
        name: "Noodle House",
        sourceTool: "search_venues",
        refId: "v-2",
      },
      datetime: "not-a-date",
      costTier: "medium",
      attendees: {
        sam: "pending",
      },
      rationale: "Need a fallback when datetime is malformed.",
    };

    const rendered = renderPlanCardTemplate(plan);

    expect(rendered.details.datetime).toBe("not-a-date");
  });
});
