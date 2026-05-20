/**
 * Run: node js/flow-assignment.test.mjs
 * Assigned By must come from stored ticket data, never the viewer session.
 */

function profileById(users, profileId) {
  if (!profileId) return null;
  return users.find(p => p.id === profileId) || null;
}

function ticketPersonFromTicket(ticket, users, role) {
  if (!ticket) return null;
  if (role === 'assignedBy') {
    const u = profileById(users, ticket.assignedById);
    if (u) return { id: u.id, name: u.name };
    if (ticket.assignedByName || ticket.assignedById) {
      return { id: ticket.assignedById, name: ticket.assignedByName || 'Unknown' };
    }
    return ticketPersonFromTicket(ticket, users, 'createdBy');
  }
  if (role === 'createdBy') {
    const u = profileById(users, ticket.createdBy);
    if (u) return { id: u.id, name: u.name };
    if (ticket.createdByName || ticket.createdBy) {
      return { id: ticket.createdBy, name: ticket.createdByName || 'Unknown' };
    }
    return null;
  }
  return null;
}

function ticketAssignedByDisplayName(ticket, users) {
  return ticketPersonFromTicket(ticket, users, 'assignedBy')?.name || '—';
}

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed += 1; return; }
  failed += 1;
  console.error('FAIL:', msg);
}

const users = [
  { id: 'admin1', name: 'Admin User', email: 'admin@test.com' },
  { id: 'emp1', name: 'Employee One', email: 'emp@test.com' },
];

const ticket = {
  assignee: 'Employee One',
  assigneeId: 'emp1',
  createdBy: 'admin1',
  createdByName: 'Admin User',
  assignedById: 'admin1',
  assignedByName: 'Admin User',
};

assert(
  ticketAssignedByDisplayName(ticket, users) === 'Admin User',
  'Scenario 1: employee viewer still sees Admin as Assigned By'
);

const ticketReassigned = {
  ...ticket,
  assignee: 'Employee One',
  assignedById: 'admin1',
  assignedByName: 'Admin User',
  createdBy: 'admin1',
  createdByName: 'Admin User',
};

assert(
  ticketAssignedByDisplayName(ticketReassigned, users) === 'Admin User',
  'Scenario 2: createdBy unchanged after reassignment display'
);

const ticketLatestAssigner = {
  ...ticket,
  assignedById: 'mgr1',
  assignedByName: 'Manager',
  createdBy: 'admin1',
  createdByName: 'Admin User',
};

assert(
  ticketAssignedByDisplayName(ticketLatestAssigner, users) === 'Manager',
  'Scenario 2b: assignedBy shows latest assigner'
);

const legacy = {
  assignee: 'Employee One',
  createdBy: 'admin1',
  createdByName: 'Admin User',
};

assert(
  ticketAssignedByDisplayName(legacy, users) === 'Admin User',
  'Legacy ticket: fallback to createdBy not viewer'
);

const noSpoof = ticketAssignedByDisplayName(ticket, users);
assert(noSpoof !== 'Employee One', 'Must not show assignee as Assigned By');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
