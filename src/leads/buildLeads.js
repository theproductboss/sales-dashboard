// Collapses WebinarJam registrations into one lead per email and attaches
// any call bookings and payments that came in on or after they registered.
//
// Attribution is first-touch: a lead's registration date and UTMs come from
// their earliest registration, while `webinarDate` is their latest session
// (the one they'd still be waiting on if they re-registered).
function buildLeads(registrations, bookings, payments, now = new Date()) {
  const byEmail = new Map();
  for (const reg of registrations) {
    if (!byEmail.has(reg.email)) byEmail.set(reg.email, []);
    byEmail.get(reg.email).push(reg);
  }

  const bookingsByEmail = groupByEmail(bookings);
  const paymentsByEmail = groupByEmail(payments);

  const leads = [];
  for (const [email, regs] of byEmail) {
    regs.sort((a, b) => String(a.registeredAt).localeCompare(String(b.registeredAt)));
    const first = regs[0];
    const registeredAt = first.registeredAt;
    const webinarDates = regs.map((r) => r.webinarDate).filter(Boolean).sort();
    const webinarDate = webinarDates[webinarDates.length - 1] || null;

    const afterSignup = (iso) => !registeredAt || iso >= registeredAt;
    const leadBookings = (bookingsByEmail.get(email) || []).filter((b) => afterSignup(b.bookedAt));
    const leadPayments = (paymentsByEmail.get(email) || []).filter((p) => afterSignup(p.paidAt));
    const firstBooking = leadBookings.sort((a, b) => a.bookedAt.localeCompare(b.bookedAt))[0];

    // Bookings and payments that were linked from another email, so the
    // page can show how they were matched.
    const how = { alias: 'linked by hand', thread: 'matched from the Slack thread', name: 'matched by name' };
    const otherEmails = [
      ...leadBookings.filter((b) => b.originalEmail).map((b) => `Booked as ${b.originalEmail} (${how[b.matchedBy]})`),
      ...leadPayments.filter((p) => p.originalEmail).map((p) => `Paid as ${p.originalEmail} (${how[p.matchedBy]})`),
    ];

    const named = regs.find((r) => r.firstName || r.lastName) || first;
    leads.push({
      email,
      name: `${named.firstName} ${named.lastName}`.trim(),
      phone: (regs.find((r) => r.phone) || {}).phone || '',
      revenueLevel: (regs.find((r) => r.revenueLevel) || {}).revenueLevel || (firstBooking && firstBooking.callType) || '',
      registeredAt,
      webinarName: first.webinarName,
      webinarDate,
      webinarHappened: Boolean(webinarDate) && new Date(webinarDate) <= now,
      registrationCount: regs.length,
      attendedLive: regs.some((r) => r.attendedLive),
      attendedReplay: regs.some((r) => r.attendedReplay),
      utm: first.utm,
      bookedCall: Boolean(firstBooking),
      bookedAt: firstBooking ? firstBooking.bookedAt : null,
      callType: firstBooking ? firstBooking.callType : '',
      paid: leadPayments.length > 0,
      paidAt: leadPayments.length ? leadPayments.map((p) => p.paidAt).sort()[0] : null,
      paidAmount: leadPayments.reduce((sum, p) => sum + p.amount, 0),
      products: [...new Set(leadPayments.map((p) => p.product))],
      otherEmails: [...new Set(otherEmails)],
    });
  }

  return leads.sort((a, b) => String(b.registeredAt).localeCompare(String(a.registeredAt)));
}

function groupByEmail(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.email)) map.set(item.email, []);
    map.get(item.email).push(item);
  }
  return map;
}

module.exports = { buildLeads };
