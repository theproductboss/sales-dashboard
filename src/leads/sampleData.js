const { DateTime } = require('luxon');

// Made-up registrations, bookings, and payments for previewing the tracker
// without API keys (`npm run leads:demo`). Seeded so the output is stable.
function sampleInputs(now = DateTime.now().setZone('America/New_York')) {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const firstNames = ['Ava', 'Maya', 'Jess', 'Priya', 'Carmen', 'Lena', 'Rosa', 'Tara', 'Nina', 'Grace', 'Hana', 'Zoe', 'Dana', 'Kim', 'Alex'];
  const lastNames = ['Rivera', 'Chen', 'Patel', 'Okafor', 'Novak', 'Reyes', 'Larsen', 'Haddad', 'Kowalski', 'Moreau', 'Singh', 'Brooks'];
  const ads = [
    { source: 'facebook', medium: 'paid', campaign: 'webinar_q4_cold', content: 'video_founder_story' },
    { source: 'facebook', medium: 'paid', campaign: 'webinar_q4_cold', content: 'carousel_results' },
    { source: 'facebook', medium: 'paid', campaign: 'webinar_retargeting', content: 'static_testimonial' },
    { source: 'instagram', medium: 'paid', campaign: 'webinar_q4_cold', content: 'reel_3_mistakes' },
    { source: 'email', medium: 'newsletter', campaign: 'weekly_newsletter', content: '' },
    { source: '', medium: '', campaign: '', content: '' },
  ];
  const revenueLevels = ['Under $25,000', '$25,000-$50,000', '$50,000 to $100,000', '$100,000 to $500,000', '$500,000+'];

  // Weekly Tuesday 1pm ET webinars, from 10 weeks back through next week.
  const thisTuesday = now.startOf('week').plus({ days: 1 }).set({ hour: 13 });
  const sessions = [];
  for (let w = -10; w <= 1; w += 1) sessions.push(thisTuesday.plus({ weeks: w }));

  const registrations = [];
  const bookings = [];
  const payments = [];
  for (const session of sessions) {
    const count = 35 + Math.floor(rand() * 30);
    for (let i = 0; i < count; i += 1) {
      const first = pick(firstNames);
      const last = pick(lastNames);
      const email = `${first}.${last}${Math.floor(rand() * 900 + 100)}@example.com`.toLowerCase();
      const registeredAt = session.minus({ hours: 6 + rand() * 24 * 9 });
      if (registeredAt > now) continue;
      const ad = pick(ads);
      const happened = session <= now;
      const attendedLive = happened && rand() < (ad.campaign === 'webinar_retargeting' ? 0.45 : 0.3);
      const revenueLevel = pick(revenueLevels);

      registrations.push({
        email,
        firstName: first,
        lastName: last,
        phone: rand() < 0.5 ? `+1 555${Math.floor(rand() * 9000000 + 1000000)}` : '',
        registeredAt: registeredAt.toUTC().toISO(),
        webinarName: 'Product Boss Masterclass',
        webinarDate: session.toUTC().toISO(),
        attendedLive,
        timeLive: null,
        attendedReplay: happened && !attendedLive && rand() < 0.15,
        revenueLevel,
        utm: { ...ad, term: '' },
      });

      if (happened && rand() < (attendedLive ? 0.22 : 0.04)) {
        const bookedAt = session.plus({ hours: 1 + rand() * 72 });
        if (bookedAt > now) continue;
        bookings.push({ email, bookedAt: bookedAt.toUTC().toISO(), callType: revenueLevel });
        if (rand() < 0.3) {
          const paidAt = bookedAt.plus({ days: 1 + rand() * 6 });
          if (paidAt <= now) {
            payments.push({ email, paidAt: paidAt.toUTC().toISO(), amount: pick([2800, 4900, 8000]), product: 'The Product Boss Collective' });
          }
        }
      }
    }
  }
  payments.push({ email: 'someone.else@example.com', name: 'Morgan Example', paidAt: now.minus({ days: 2 }).toUTC().toISO(), amount: 8000, product: 'The Product Boss Collective - 1 Year [PIF]' });
  return { registrations, bookings, payments };
}

module.exports = { sampleInputs };
