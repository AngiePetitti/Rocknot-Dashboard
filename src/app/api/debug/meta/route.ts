import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const token = (process.env.META_ACCESS_TOKEN || '').trim();
  const accountId = (process.env.META_AD_ACCOUNT_ID || '').trim().replace('act_', '');

  if (!token || !accountId) {
    return NextResponse.json({ error: 'META_ACCESS_TOKEN or META_AD_ACCOUNT_ID not set' });
  }

  const fields = 'spend,clicks,actions,action_values';
  const url = `https://graph.facebook.com/v19.0/act_${accountId}/insights?fields=${fields}&date_preset=today&level=account&access_token=${token}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    return NextResponse.json({ status: res.status, accountId, json });
  } catch (err) {
    return NextResponse.json({ error: String(err) });
  }
}
