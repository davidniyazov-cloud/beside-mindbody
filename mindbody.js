/**
 * mindbody.js
 * Wrapper around the Mindbody Public API v6
 * Docs: https://developers.mindbodyonline.com/
 */
const axios = require('axios');

const BASE_URL = 'https://api.mindbodyonline.com/public/v6';
const SITE_ID  = process.env.MINDBODY_SITE_ID;
const API_KEY  = process.env.MINDBODY_API_KEY;

let _staffToken = null;
let _tokenExpiry = null;

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Get (and cache) a staff user token.
 * Required for booking appointments on behalf of the business.
 */
async function getStaffToken() {
  if (_staffToken && _tokenExpiry && Date.now() < _tokenExpiry) {
    return _staffToken;
  }

  const res = await mb('POST', '/usertoken/issue', {
    Username: process.env.MINDBODY_STAFF_USERNAME,
    Password: process.env.MINDBODY_STAFF_PASSWORD,
  }, false); // false = no auth header needed for this call

  _staffToken  = res.AccessToken;
  _tokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // refresh after 23h
  return _staffToken;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function mb(method, path, data = {}, auth = true) {
  const headers = {
    'Content-Type': 'application/json',
    'Api-Key':      API_KEY,
    'SiteId':       SITE_ID,
  };

  if (auth) {
    headers['Authorization'] = await getStaffToken();
  }

  const config = {
    method,
    url: BASE_URL + path,
    headers,
    ...(method === 'GET' ? { params: data } : { data }),
  };

  try {
    const res = await axios(config);
    return res.data;
  } catch (err) {
    const error = err.response?.data?.Error;
    const msg = error?.Message || err.message;
    const details = JSON.stringify(error || err.response?.data || {});
    console.error(`[Mindbody] Full error on ${method} ${path}:`, details);
    throw new Error(`Mindbody API error on ${method} ${path}: ${msg}`);
  }
}

// ─── Clients ──────────────────────────────────────────────────────────────────

/**
 * Search for an existing client by phone number.
 * Returns the first match or null.
 */
async function findClientByPhone(phone) {
  // Normalize: strip non-digits AND leading country code (1)
  // Mindbody stores 10-digit US numbers; searching with 11 digits won't match
  const normalized = phone.replace(/\D/g, '').replace(/^1/, '').slice(-10);

  const res = await mb('GET', '/client/clients', {
    SearchText: normalized,
  });

  const clients = res.Clients || [];
  return clients.length > 0 ? clients[0] : null;
}

/**
 * Search for an existing client by name.
 * Returns the first match or null.
 */
async function findClientByName(firstName, lastName) {
  const searchText = `${firstName} ${lastName}`.trim();
  if (!searchText) return null;

  const res = await mb('GET', '/client/clients', {
    SearchText: searchText,
  });

  const clients = res.Clients || [];
  return clients.length > 0 ? clients[0] : null;
}

/**
 * Create a new client in Mindbody.
 * Returns the created client object.
 */
async function createClient({ firstName, lastName, phone, email }) {
  // Mindbody expects 10-digit US phone, no country code, no special chars
  const cleanPhone = (phone || '').replace(/\D/g, '').replace(/^1/, '').slice(-10);

  const res = await mb('POST', '/client/addclient', {
    FirstName:    firstName || 'Unknown',
    LastName:     lastName  || '',
    MobilePhone:  cleanPhone || '',
    Email:        email     || '',
    BirthDate:    '1900-01-01T00:00:00',
    HomeLocation: { Id: parseInt(process.env.DEFAULT_LOCATION_ID || '1', 10) },
  });
  return res.Client;
}

/**
 * Find or create a client. Returns the Mindbody client object.
 */
async function findOrCreateClient({ firstName, lastName, phone, email }) {
  // 1. Try phone lookup first
  if (phone) {
    const existing = await findClientByPhone(phone);
    if (existing) {
      console.log(`[Mindbody] Found existing client by phone: ${existing.FirstName} ${existing.LastName} (ID: ${existing.Id})`);
      return existing;
    }
  }

  // 2. Try creating — if Mindbody rejects as duplicate, fall back to name search
  console.log(`[Mindbody] Creating new client: ${firstName} ${lastName}`);
  try {
    return await createClient({ firstName, lastName, phone, email });
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('duplicate')) {
      console.log(`[Mindbody] Duplicate error — searching by name as fallback`);
      const byName = await findClientByName(firstName, lastName);
      if (byName) {
        console.log(`[Mindbody] Found existing client by name: ${byName.FirstName} ${byName.LastName} (ID: ${byName.Id})`);
        return byName;
      }
    }
    throw err;
  }
}

// ─── Services ─────────────────────────────────────────────────────────────────

/**
 * Get all active session/service types for your site.
 */
async function getServiceTypes() {
  // Try activesessiontypes first, fall back to sessiontypes
  try {
    const res = await mb('GET', '/appointment/activesessiontypes');
    return res.SessionTypes || [];
  } catch (e) {
    const res = await mb('GET', '/site/sessiontypes');
    return res.SessionTypes || [];
  }
}

/**
 * Match a service name string (e.g. "deep tissue", "relaxation") to a Mindbody
 * session type. Falls back to the DEFAULT_SERVICE_ID env var.
 */
async function resolveService(serviceHint) {
  if (!serviceHint) return parseInt(process.env.DEFAULT_SERVICE_ID, 10);

  const types = await getServiceTypes();
  const hint  = serviceHint.toLowerCase();

  const match = types.find(t =>
    t.Name.toLowerCase().includes(hint) ||
    hint.includes(t.Name.toLowerCase())
  );

  if (match) {
    console.log(`[Mindbody] Matched service: "${match.Name}" (ID: ${match.Id})`);
    return match.Id;
  }

  console.log(`[Mindbody] No service match for "${serviceHint}", using default`);
  return parseInt(process.env.DEFAULT_SERVICE_ID, 10);
}

// ─── Availability ─────────────────────────────────────────────────────────────

/**
 * Get available appointment slots.
 * @param {string} dateStr  - e.g. "2026-05-10"
 * @param {number} staffId  - Mindbody staff ID
 * @param {number} serviceId
 */
async function getAvailability(dateStr, staffId, serviceId) {
  const params = {
    LocationId:     parseInt(process.env.DEFAULT_LOCATION_ID || '1', 10),
    SessionTypeIds: [serviceId || parseInt(process.env.DEFAULT_SERVICE_ID, 10)],
    StartDateTime:  `${dateStr}T00:00:00`,
    EndDateTime:    `${dateStr}T23:59:59`,
  };
  if (staffId) {
    params.StaffIds = [staffId];
  }
  const res = await mb('POST', '/appointment/availabilities', params);
  return res.Availabilities || [];
}

// ─── Appointments ─────────────────────────────────────────────────────────────

/**
 * Book an appointment.
 * @param {object} params
 * @param {string} params.clientId      - Mindbody client ID
 * @param {number} params.serviceId
 * @param {number} params.staffId
 * @param {string} params.startDateTime - ISO string, e.g. "2026-05-10T14:00:00"
 * @param {string} params.notes         - Optional notes from the call
 */
async function bookAppointment({ clientId, serviceId, staffId, startDateTime, notes }) {
  const res = await mb('POST', '/appointment/addappointment', {
    ClientId:      clientId,
    SessionTypeId: serviceId || parseInt(process.env.DEFAULT_SERVICE_ID, 10),
    StaffId:       staffId   || parseInt(process.env.DEFAULT_STAFF_ID, 10),
    LocationId:    parseInt(process.env.DEFAULT_LOCATION_ID || '1', 10),
    StartDateTime: startDateTime,
    Notes:         notes || 'Booked automatically via Beside AI receptionist',
    SendEmail:     true,  // Mindbody sends its own confirmation email
  });
  return res.Appointment;
}

// ─── Messaging ────────────────────────────────────────────────────────────────

/**
 * Send a text message to a client via Mindbody's built-in messaging.
 */
async function sendTextMessage(clientId, message) {
  // Mindbody's SendEmail endpoint also handles SMS for clients with mobile phones
  const res = await mb('POST', '/client/sendautoemail', {
    ClientId:      clientId,
    EmailType:     'Custom',
    WhenToSend:    'Immediately',
    IncludeNames:  true,
    Subject:       'Appointment Confirmation - Spacibo Therapeutic Massage',
    HTMLText:      message,
  });
  return res;
}

module.exports = {
  findOrCreateClient,
  findClientByPhone,
  findClientByName,
  createClient,
  getServiceTypes,
  resolveService,
  getAvailability,
  bookAppointment,
  sendTextMessage,
  getStaffTokenDebug: getStaffToken, // exposed for debug endpoint only
};
