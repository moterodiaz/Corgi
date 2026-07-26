export type PlanStatus = "proposed" | "revising" | "confirmed" | "abandoned";

export interface PlanObject {
  planId: string;
  version: number;
  status: PlanStatus;
  activity: string;
  venue: {
    name: string;
    sourceTool: string;
    refId: string;
  };
  datetime: string;
  costTier: "low" | "medium" | "high";
  attendees: Record<string, "yes" | "no" | "pending">;
  rationale: string;
}

export interface PlanCardPayload {
  kind: "corgi.plan-card";
  planId: string;
  version: number;
  status: PlanStatus;
  headline: string;
  details: {
    activity: string;
    venue: string;
    datetime: string;
    costTier: string;
  };
  rationale: string;
  rsvp: Array<{
    attendee: string;
    state: "yes" | "no" | "pending";
  }>;
}

export function renderPlanCardTemplate(plan: PlanObject): PlanCardPayload {
  return {
    kind: "corgi.plan-card",
    planId: plan.planId,
    version: plan.version,
    status: plan.status,
    headline: `${titleCase(plan.activity)} at ${plan.venue.name}`,
    details: {
      activity: plan.activity,
      venue: plan.venue.name,
      datetime: formatDateTime(plan.datetime),
      costTier: plan.costTier,
    },
    rationale: plan.rationale,
    rsvp: Object.entries(plan.attendees)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([attendee, state]) => ({ attendee, state })),
  };
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString();
}

function titleCase(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}
