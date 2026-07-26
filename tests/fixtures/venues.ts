// DEMO FIXTURE — not production data. Per AGENTS.md §7, these are placeholder venues
// for the demo path. The real data source is decided in P0-1 (still open — see README).
// Replace with real Merge tool responses once P0-1 is resolved.

export interface FixtureVenue {
  name: string
  cost_tier: string
  type: string
  address: string
}

export const fixtureVenues: FixtureVenue[] = [
  {
    name: 'Summit Indoor Climbing',
    cost_tier: 'low',
    type: 'climbing_gym',
    address: '123 Main St, San Francisco, CA',
  },
  {
    name: 'Lucky Strike Social',
    cost_tier: 'medium',
    type: 'bowling_alley',
    address: '456 Market St, San Francisco, CA',
  },
  {
    name: 'The Civic Taproom',
    cost_tier: 'low',
    type: 'bar',
    address: '789 Mission St, San Francisco, CA',
  },
]
