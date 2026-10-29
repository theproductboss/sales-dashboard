const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBookingMessage, parsePaymentMessage } = require('../src/leads/slackActivity');
const { normalizeRegistrant } = require('../src/leads/webinarjam');
const { buildLeads } = require('../src/leads/buildLeads');
const { renderTracker } = require('../src/leads/render');

const msg = (text) => ({ text, ts: '1793288439.879679' });

test('parses both #collective-calls-booked formats', () => {
  assert.deepEqual(parseBookingMessage(msg('Arren Leo <mailto:arreneleo@gmail.com|arreneleo@gmail.com> booked an Under 50k call!')), {
    email: 'arreneleo@gmail.com',
    bookedAt: '2026-10-29T15:40:39.879Z',
    callType: 'Under 50k',
  });
  const b = parseBookingMessage(msg('Patty Owens <mailto:Patty@backyard-gatherings.com|Patty@backyard-gatherings.com> booked a call! (estimated revenue $25,000-$50,000)'));
  assert.equal(b.email, 'patty@backyard-gatherings.com');
  assert.equal(b.callType, '$25,000-$50,000');
});

test('parses #payments new-payment formats and skips subscription renewals', () => {
  const cases = [
    ['The Product Boss Collective - 1 Year [PIF] - $8000 - jacqoffer - 8000.00 New Payment from Sophia Kang (<mailto:sophia.kang27@gmail.com|sophia.kang27@gmail.com>)', 8000, 'sophia.kang27@gmail.com'],
    ['Emails for E-commerce course with template - $77 New payment from   (<mailto:theruckerromance@gmail.com|theruckerromance@gmail.com>)', 77, 'theruckerromance@gmail.com'],
    ['The Product Boss Collective - The Product Boss Collective - 12 month payment plan - 997 - New Payment from Jennifer Giese <mailto:jenny@jennygiese.com|jenny@jennygiese.com>', 997, 'jenny@jennygiese.com'],
    ['Build Your AI Holiday Team | PP - 499.00 New Payment from Elizabeth S Tyrrell (<mailto:liz@purplenestdesign.com|liz@purplenestdesign.com>)', 499, 'liz@purplenestdesign.com'],
  ];
  for (const [text, amount, email] of cases) {
    const p = parsePaymentMessage(msg(text));
    assert.equal(p.amount, amount, text);
    assert.equal(p.email, email);
  }
  assert.equal(parsePaymentMessage(msg('The Product Boss Collective - 1 Year [PIF] - $8000 - jacqoffer - 8000.00 New Payment from Emily Brown (<mailto:e@x.com|e@x.com>)')).name, 'Emily Brown');
  assert.equal(parsePaymentMessage(msg('X - $77 New payment from   (<mailto:e@x.com|e@x.com>)')).name, '');
  assert.equal(parsePaymentMessage(msg('X - 997 - New Payment from Jennifer Giese <mailto:j@x.com|j@x.com>')).name, 'Jennifer Giese');
  assert.equal(parsePaymentMessage(msg('The Product Boss Collective - 12 month payment plan - 997 - New Payment from Jennifer Giese <mailto:jenny@jennygiese.com|jenny@jennygiese.com>')).product,
    'The Product Boss Collective - 12 month payment plan');
  assert.equal(parsePaymentMessage(msg('Subscription Payment: 708.33')), null);
  assert.equal(parsePaymentMessage(msg('WOWIE WOWIE LOOK AT YOU TWO')), null);
});

test('normalizes a registrant in the shape the WebinarJam API actually returns', () => {
  const r = normalizeRegistrant(
    { first_name: 'Sam', last_name: '', email: 'Sam@x.com', phone_country_code: '', phone_number: '',
      'Phone Number (Optional)': '5551234567', schedule_id: 475, schedule: 'Wed, 28 Oct 2026, 01:00 PM',
      signup_date: 'Wed, 28 Oct 2026, 01:42 PM', attended_live: 'No', attended_replay: 'Yes', revenue_live: 0,
      'Projected Revenue - 2026': '$10,000 to $25,000', webinar: 'Collective Webinar - 28 October 2026',
      utm_source: 'convertkit', utm_medium: 'email', utm_campaign: 'psst', utm_term: null, utm_content: null },
    { name: 'Collective Webinar - 28 October 2026', timezone: 'America/New_York' },
    { 475: '2026-10-28T17:00:00.000Z' }
  );
  assert.equal(r.registeredAt, '2026-10-28T17:42:00.000Z');
  assert.equal(r.webinarDate, '2026-10-28T17:00:00.000Z');
  assert.equal(r.attendedLive, false);
  assert.equal(r.attendedReplay, true);
  assert.equal(r.phone, '5551234567');
  assert.equal(r.revenueLevel, '$10,000 to $25,000');
  assert.equal(r.utm.campaign, 'psst');
  assert.equal(r.utm.content, '');
  // Without the schedule lookup, the registrant's own schedule text is used.
  assert.equal(normalizeRegistrant({ email: 'a@b.c', schedule: 'Wed, 28 Oct 2026, 01:00 PM' }, { timezone: 'America/New_York' }, {}).webinarDate,
    '2026-10-28T17:00:00.000Z');
});

test('normalizes a WebinarJam registrant using the schedule-id lookup', () => {
  const r = normalizeRegistrant(
    { first_name: 'Jane', last_name: 'Doe', email: ' Jane@X.com ', signup_date: '2026-10-20 09:15', schedule_id: 77,
      attended_live: 'Yes', utm_source: 'facebook', utm_campaign: 'cold', 'What is your annual revenue?': '$50k-$100k', revenue_live: 0 },
    { name: 'Masterclass', timezone: 'America/New_York' },
    { 77: '2026-10-27T17:00:00.000Z' }
  );
  assert.equal(r.email, 'jane@x.com');
  assert.equal(r.registeredAt, '2026-10-20T13:15:00.000Z');
  assert.equal(r.webinarDate, '2026-10-27T17:00:00.000Z');
  assert.equal(r.attendedLive, true);
  assert.equal(r.revenueLevel, '$50k-$100k');
  assert.equal(r.utm.source, 'facebook');
});

test('joins registrations to bookings and payments by email', () => {
  const reg = (email, registeredAt, webinarDate, extra = {}) => ({
    email, firstName: 'A', lastName: 'B', phone: '', registeredAt, webinarName: 'W', webinarDate,
    attendedLive: false, attendedReplay: false, revenueLevel: null, utm: { source: 'fb', medium: '', campaign: 'c1', content: '', term: '' }, ...extra,
  });
  const now = new Date('2026-10-29T12:00:00Z');
  const leads = buildLeads(
    [
      reg('a@x.com', '2026-10-01T00:00:00Z', '2026-10-07T17:00:00Z', { attendedLive: true }),
      reg('a@x.com', '2026-10-20T00:00:00Z', '2026-10-27T17:00:00Z', { utm: { source: 'ig', medium: '', campaign: 'c2', content: '', term: '' } }),
      reg('b@x.com', '2026-10-28T00:00:00Z', '2026-11-03T17:00:00Z'),
      reg('c@x.com', '2026-10-10T00:00:00Z', '2026-10-14T17:00:00Z'),
    ],
    [
      { email: 'a@x.com', bookedAt: '2026-10-08T00:00:00Z', callType: 'Under 50k' },
      { email: 'c@x.com', bookedAt: '2026-09-01T00:00:00Z', callType: '' }, // before they registered
    ],
    [{ email: 'a@x.com', paidAt: '2026-10-09T00:00:00Z', amount: 8000, product: 'Collective' }],
    now
  );
  const byEmail = Object.fromEntries(leads.map((l) => [l.email, l]));
  assert.equal(leads.length, 3);
  assert.equal(byEmail['a@x.com'].registrationCount, 2);
  assert.equal(byEmail['a@x.com'].utm.campaign, 'c1', 'first-touch attribution');
  assert.equal(byEmail['a@x.com'].webinarDate, '2026-10-27T17:00:00Z', 'latest session');
  assert.equal(byEmail['a@x.com'].attendedLive, true);
  assert.equal(byEmail['a@x.com'].bookedCall, true);
  assert.equal(byEmail['a@x.com'].revenueLevel, 'Under 50k', 'falls back to call type');
  assert.equal(byEmail['a@x.com'].paidAmount, 8000);
  assert.equal(byEmail['b@x.com'].webinarHappened, false);
  assert.equal(byEmail['c@x.com'].bookedCall, false, 'bookings before registration do not count');
});

test('rendered page escapes lead data inside the script tag', () => {
  const html = renderTracker({ generatedAt: '', timeZone: 'UTC', warnings: [], leads: [{ name: '</script><b>x' }] });
  assert.ok(!html.includes('</script><b>'));
});

