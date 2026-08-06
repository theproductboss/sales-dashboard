const PAYPAL_BASES = {
  live: 'https://api-m.paypal.com',
  sandbox: 'https://api-m.sandbox.paypal.com',
};

async function getAccessToken(base, clientId, clientSecret) {
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`PayPal auth failed: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}

async function searchWindow(base, token, startISO, endISO) {
  const transactions = [];
  let page = 1;
  for (;;) {
    const url = new URL(`${base}/v1/reporting/transactions`);
    url.searchParams.set('start_date', startISO);
    url.searchParams.set('end_date', endISO);
    url.searchParams.set('fields', 'transaction_info,cart_info');
    url.searchParams.set('page_size', '500');
    url.searchParams.set('page', String(page));
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.name || data.error) {
      throw new Error(
        `PayPal transaction search error: ${data.message || data.error_description || data.name}. ` +
          '(Is "Transaction Search" enabled on the REST app in the PayPal developer dashboard?)'
      );
    }
    transactions.push(...(data.transaction_details || []));
    if (page >= (data.total_pages || 1)) return transactions;
    page += 1;
  }
}

function transactionLabel(txn) {
  const items = (txn.cart_info?.item_details || [])
    .map((item) => item.item_name)
    .filter(Boolean);
  if (items.length) return items.join(' + ');
  return txn.transaction_info.transaction_subject || txn.transaction_info.transaction_note || '(no description)';
}

// Returns the same normalized payment shape as stripe.js. The Transaction
// Search API only allows 31-day windows, so the range is walked in chunks.
// Event codes: T00xx = payments received (T0002 = subscription payment),
// T11xx = refunds/reversals. Bank transfers, fees, and withdrawals are
// intentionally excluded so they don't distort revenue.
async function fetchPaypalPayments(clientId, clientSecret, env, sinceMs) {
  const base = PAYPAL_BASES[env] || PAYPAL_BASES.live;
  const token = await getAccessToken(base, clientId, clientSecret);

  const DAY = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const transactions = [];
  for (let windowStart = sinceMs; windowStart < nowMs; windowStart += 31 * DAY) {
    const windowEnd = Math.min(windowStart + 31 * DAY - 1000, nowMs);
    transactions.push(
      ...(await searchWindow(base, token, new Date(windowStart).toISOString(), new Date(windowEnd).toISOString()))
    );
  }

  const payments = [];
  for (const txn of transactions) {
    const info = txn.transaction_info;
    const code = info.transaction_event_code || '';
    const status = info.transaction_status;
    const amount = Number(info.transaction_amount?.value || 0);
    const record = {
      source: 'paypal',
      ts: new Date(info.transaction_initiation_date).getTime(),
      cents: Math.round(Math.abs(amount) * 100),
      currency: (info.transaction_amount?.currency_code || '').toLowerCase(),
      recurring: code === 'T0002',
      label: transactionLabel(txn),
    };

    if (code.startsWith('T11')) {
      payments.push({ ...record, kind: 'refund' });
    } else if (code.startsWith('T00')) {
      if (status === 'S') payments.push({ ...record, kind: 'sale' });
      else if (status === 'D') payments.push({ ...record, kind: 'failed' });
      // 'P' (pending) and 'V' (reversed — the T11xx entry covers it) are skipped
    }
  }
  return payments;
}

module.exports = { fetchPaypalPayments };
