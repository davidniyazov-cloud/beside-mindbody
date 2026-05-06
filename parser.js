/**
 * parser.js
 * Extracts booking intent from Beside call summaries and transcripts.
 *
 * Beside's call webhook contains:
 *   - summary:     Full summary text (includes Overview + To-Do List sections)
 *   - transcript:  Raw conversation transcript
 *   - callerName:  Name of caller (if identified)
 *   - callerPhone: Caller's phone number
 */

// ─── Service keyword map ──────────────────────────────────────────────────────
const SERVICE_KEYWORDS = {
  'deep tissue':    'Deep Tissue',
  'deep-tissue':    'Deep Tissue',
  'therapeutic':    'Therapeutic',
  'sports':         'Sports',
  'sport':          'Sports',
  'relaxing':       'Relaxation',
  'relaxation':     'Relaxation',
  'swedish':        'Swedish',
  'prenatal':       'Prenatal',
  'couples':        'Couples',
  'hot stone':      'Hot Stone',
};

// ─── Time parsing helpers ─────────────────────────────────────────────────────

/**
 * Try to extract a date from text like "tomorrow", "Friday", "Monday at 2pm",
 * "May 10", "next Tuesday", etc.
 * Returns an ISO date string "YYYY-MM-DD" or null.
 */
function extractDate(text) {
  const lower = text.toLowerCase();
  const today = new Date();

  // "tomorrow"
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  // "today"
  if (/\btoday\b/.test(lower)) {
    return today.toISOString().slice(0, 10);
  }

  // Day of week: "Monday", "Tuesday", etc.
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  for (let i = 0; i < days.length; i++) {
    const re = new RegExp(`\\b${days[i]}\\b`);
    if (re.test(lower)) {
      const current = today.getDay();
      let diff = i - current;
      if (diff <= 0) diff += 7; // always next occurrence
      const d = new Date(today);
      d.setDate(d.getDate() + diff);
      return d.toISOString().slice(0, 10);
    }
  }

  // "May 10", "June 5", etc.
  const months = ['january','february','march','april','may','june',
                  'july','august','september','october','november','december'];
  for (let m = 0; m < months.length; m++) {
    const re = new RegExp(`${months[m]}\\s+(\\d{1,2})`, 'i');
    const match = text.match(re);
    if (match) {
      const year = today.getFullYear();
      const d = new Date(year, m, parseInt(match[1]));
      if (d < today) d.setFullYear(year + 1); // already passed this year
      return d.toISOString().slice(0, 10);
    }
  }

  return null;
}

/**
 * Extract a time from text like "2pm", "2:00 PM", "14:00", "noon", "2 o'clock".
 * Returns "HH:MM:00" string or null.
 */
function extractTime(text) {
  const lower = text.toLowerCase();

  if (/\bnoon\b/.test(lower)) return '12:00:00';
  if (/\bmidnight\b/.test(lower)) return '00:00:00';

  // "2:30 pm", "2:30pm", "14:30"
  const full = lower.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/);
  if (full) {
    let h = parseInt(full[1]);
    const min = full[2];
    const period = full[3];
    if (period === 'pm' && h < 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${min}:00`;
  }

  // "2pm", "3 pm", "11am"
  const simple = lower.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (simple) {
    let h = parseInt(simple[1]);
    const period = simple[2];
    if (period === 'pm' && h < 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:00:00`;
  }

  return null;
}

// ─── Email extraction ─────────────────────────────────────────────────────────

/**
 * Extract an email address from text.
 */
function extractEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

// ─── Name parsing ─────────────────────────────────────────────────────────────

/**
 * Split a full name into first/last.
 */
function splitName(fullName) {
  if (!fullName) return { firstName: '', lastName: '' };
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName:  parts.slice(1).join(' ') || '',
  };
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse a Beside call webhook payload into a structured booking intent.
 *
 * @param {object} payload - Raw Beside webhook body
 * @returns {object} intent - Parsed booking intent
 */
function parseCallPayload(payload) {
  // Beside sends via Zapier with these field names.
  // For inbound calls: From = client, To = Spacibo
  // For outbound calls: From = Spacibo, To = client
  const summary    = payload.summary    || payload.Summary    || '';
  const transcript = payload.transcript || payload.Transcript || '';
  const direction  = (payload.direction || '').toLowerCase();

  const BUSINESS_NAME = 'spacibo';
  const fromName  = payload.from_name  || '';
  const fromPhone = payload.from_phone || payload.from_phone_number || '';
  const toName    = payload.to_name    || '';
  const toPhone   = payload.to_phone   || payload.to_phone_number   || '';

  // Pick whichever side is NOT the business
  let callerName, callerPhone;
  if (fromName.toLowerCase().includes(BUSINESS_NAME)) {
    callerName  = toName;
    callerPhone = toPhone;
  } else if (toName.toLowerCase().includes(BUSINESS_NAME)) {
    callerName  = fromName;
    callerPhone = fromPhone;
  } else {
    // Fallback: inbound = from is caller, outbound = to is caller
    callerName  = direction === 'outbound' ? toName  : fromName;
    callerPhone = direction === 'outbound' ? toPhone : fromPhone;
  }

  // Also handle legacy/direct webhook field names
  callerName  = callerName  || payload.callerName  || payload.caller_name  || '';
  callerPhone = callerPhone || payload.callerPhone || payload.caller_phone || payload.phone || '';

  // Combine all text for parsing
  const fullText = `${summary}\n${transcript}`;

  // ── Detect booking intent ──────────────────────────────────────────────────
  const bookingKeywords = [
    'appointment', 'book', 'schedule', 'reserve', 'slot', 'session',
    'come in', 'available', 'availability', '12pm', '1pm', '2pm', '3pm',
    '4pm', '5pm', '6pm', 'tomorrow', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday', 'sunday',
  ];
  const hasBookingIntent = bookingKeywords.some(kw =>
    fullText.toLowerCase().includes(kw)
  );

  // ── Extract service type ───────────────────────────────────────────────────
  let serviceType = null;
  for (const [keyword, name] of Object.entries(SERVICE_KEYWORDS)) {
    if (fullText.toLowerCase().includes(keyword)) {
      serviceType = name;
      break;
    }
  }

  // ── Extract date & time ────────────────────────────────────────────────────
  // Focus on the To-Do / scheduling sections first
  const todoSection = summary.match(/To-Do List([\s\S]*?)(?=Services offered|Pricing|$)/i);
  const focusText   = todoSection ? todoSection[1] : fullText;

  const date = extractDate(focusText) || extractDate(fullText);
  const time = extractTime(focusText) || extractTime(fullText);

  // ── Extract email ─────────────────────────────────────────────────────────
  const email = extractEmail(fullText) || null;

  // ── Parse caller name ──────────────────────────────────────────────────────
  const { firstName, lastName } = splitName(callerName);

  // ── Build ISO datetime if we have both ────────────────────────────────────
  let startDateTime = null;
  if (date && time) {
    startDateTime = `${date}T${time}`;
  } else if (date) {
    startDateTime = `${date}T10:00:00`; // default to 10am if no time found
  }

  // ── Extract notes ──────────────────────────────────────────────────────────
  // Grab the first actionable to-do line for Spacibo as appointment notes
  const notesMatch = summary.match(/Spacibo[^:]*:\s*\n(.+?)(?:\n\n|Unknown User:|$)/s);
  const notes = notesMatch
    ? notesMatch[1].trim().slice(0, 500)
    : `Call from ${callerName || callerPhone}. Service: ${serviceType || 'massage'}`;

  return {
    hasBookingIntent,
    caller: {
      firstName,
      lastName,
      phone: callerPhone,
      email,
      fullName: callerName,
    },
    appointment: {
      serviceType,
      date,
      time,
      startDateTime,
    },
    notes,
    raw: { summary, transcript, callerName, callerPhone },
  };
}

module.exports = { parseCallPayload, extractDate, extractTime };
