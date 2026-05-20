/**
 * Run: node js/flow-permissions.test.mjs
 * Unit tests for permission helpers (no DOM / Supabase required).
 */

const ADMIN_ROLES = new Set(['admin', 'super_admin']);
const STATUS_TRANSITIONS = { todo: ['prog'], prog: ['todo', 'done'], done: ['prog'] };

function normalizePersonName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function assigneeNamesMatch(ticketAssignee, userName) {
  const a = normalizePersonName(ticketAssignee);
  const b = normalizePersonName(userName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(`${b} `) || b.startsWith(`${a} `)) return true;
  return false;
}

function makePerms(currentUser) {
  const isAdminUser = (user = currentUser) => Boolean(user?.role && ADMIN_ROLES.has(user.role));
  const isAssignee = (ticket) => {
    if (!currentUser || !ticket) return false;
    if (ticket.assigneeId && currentUser.id) return ticket.assigneeId === currentUser.id;
    return assigneeNamesMatch(ticket.assignee, currentUser.name);
  };
  const isAssignedBy = (ticket) => {
    if (!currentUser || !ticket) return false;
    if (ticket.assignedById && currentUser.id) return ticket.assignedById === currentUser.id;
    if (ticket.assignedByName && currentUser.name) {
      return assigneeNamesMatch(ticket.assignedByName, currentUser.name);
    }
    if (!ticket.assignedById && ticket.createdBy && currentUser.id) {
      return ticket.createdBy === currentUser.id;
    }
    return false;
  };
  const isTicketCreator = (ticket) =>
    Boolean(currentUser?.id && ticket?.createdBy && ticket.createdBy === currentUser.id);
  const canEditTicketDetails = (ticket) => isAssignedBy(ticket) || isAdminUser();
  const canChangeTicketStatus = (ticket) => isAssignee(ticket) || isAdminUser();
  const canEditTicket = (ticket) => canEditTicketDetails(ticket) || canChangeTicketStatus(ticket);
  const canMoveTicket = (ticket) => canChangeTicketStatus(ticket);
  const canDeleteTicket = (ticket) => isAdminUser() || isTicketCreator(ticket);
  const isValidStatusTransition = (from, to) =>
    from !== to && (STATUS_TRANSITIONS[from] || []).includes(to);
  return {
    isAssignee,
    isAssignedBy,
    canEditTicketDetails,
    canChangeTicketStatus,
    canEditTicket,
    canMoveTicket,
    canDeleteTicket,
    isValidStatusTransition,
  };
}

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed += 1; return; }
  failed += 1;
  console.error('FAIL:', msg);
}

const bob = { id: 'b1', name: 'Bob Smith', role: 'member' };
const admin = { id: 'a1', name: 'Admin', role: 'admin' };
const ticket = {
  id: 't1',
  assignee: 'Bob Smith',
  assigneeId: 'b1',
  createdBy: 'c1',
  assignedById: 'a1',
  assignedByName: 'Alice',
  status: 'todo',
};

const bobPerms = makePerms(bob);
assert(bobPerms.isAssignee(ticket), 'assignee by id');
assert(bobPerms.canChangeTicketStatus(ticket), 'assignee can change status');
assert(bobPerms.canMoveTicket(ticket), 'assignee can move on board');
assert(!bobPerms.canEditTicketDetails(ticket), 'assignee cannot edit details');
assert(bobPerms.canEditTicket(ticket), 'assignee can open modal for status');
assert(!bobPerms.canDeleteTicket(ticket), 'assignee cannot delete');

const assigner = { id: 'a1', name: 'Alice', role: 'member' };
const assignerPerms = makePerms(assigner);
assert(assignerPerms.isAssignedBy(ticket), 'assigner is assigned-by');
assert(assignerPerms.canEditTicketDetails(ticket), 'assigner can edit details');
assert(!assignerPerms.canChangeTicketStatus(ticket), 'assigner cannot change status');
assert(!assignerPerms.canMoveTicket(ticket), 'assigner cannot move on board');
assert(assignerPerms.canEditTicket(ticket), 'assigner can open modal for details');

const adminPerms = makePerms(admin);
assert(adminPerms.canEditTicketDetails(ticket), 'admin can edit details');
assert(adminPerms.canChangeTicketStatus(ticket), 'admin can change status');

const other = { id: 'x1', name: 'Xavier', role: 'member' };
const otherPerms = makePerms(other);
assert(!otherPerms.canEditTicket(ticket), 'unrelated user cannot edit');

const legacy = {
  id: 't0',
  assignee: 'Bob Smith',
  assigneeId: 'b1',
  createdBy: 'c1',
  status: 'todo',
};
const creator = { id: 'c1', name: 'Carol', role: 'member' };
const creatorPerms = makePerms(creator);
assert(creatorPerms.canEditTicketDetails(legacy), 'legacy raiser can edit details');
assert(!creatorPerms.canChangeTicketStatus(legacy), 'legacy raiser cannot change status unless assignee');
assert(creatorPerms.canDeleteTicket(legacy), 'creator can delete');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
