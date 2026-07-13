import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Convenience: surfaces the service account's email + project so you can share
// the Google Sheet with the right account and enable the Sheets API in the
// right project. client_email and project_id are identifiers, not secrets.
export async function GET() {
  const key = (process.env.GCP_SERVICE_ACCOUNT_KEY || '').trim();
  if (!key) return NextResponse.json({ error: 'GCP_SERVICE_ACCOUNT_KEY is not set' });
  try {
    const creds = JSON.parse(key);
    return NextResponse.json({
      shareTheSheetWith: creds.client_email,
      enableSheetsApiInProject: creds.project_id,
      calendarSheetIdConfigured: Boolean((process.env.CALENDAR_SHEET_ID || '').trim()),
    });
  } catch (e) {
    return NextResponse.json({ error: `Could not parse GCP_SERVICE_ACCOUNT_KEY: ${String(e)}` });
  }
}
