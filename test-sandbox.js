/**
 * test-sandbox.js
 * Verifies sandbox connectivity and prints available staff + services.
 * Run: node test-sandbox.js
 */
require('dotenv').config();
const axios = require('axios');

const BASE   = 'https://api.mindbodyonline.com/public/v6';
const SITE   = process.env.MINDBODY_SITE_ID;
const APIKEY = process.env.MINDBODY_API_KEY;

const headers = { 'Api-Key': APIKEY, 'SiteId': SITE, 'Content-Type': 'application/json' };

async function get(path, params = {}) {
  const r = await axios.get(BASE + path, { headers, params });
  return r.data;
}

async function post(path, data = {}) {
  const r = await axios.post(BASE + path, data, { headers });
  return r.data;
}

(async () => {
  console.log(`\n🔧 Testing Mindbody Sandbox (Site ID: ${SITE})\n`);

  // 1. Site info
  try {
    const site = await get('/site/sites');
    const s = site.Sites?.[0];
    console.log('✅ Site:', s?.Name, '|', s?.Description || '');
  } catch (e) { console.log('❌ Site fetch failed:', e.response?.data?.Error?.Message || e.message); }

  // 2. Staff token
  let token;
  try {
    const t = await post('/usertoken/issue', {
      Username: process.env.MINDBODY_STAFF_USERNAME,
      Password: process.env.MINDBODY_STAFF_PASSWORD,
    });
    token = t.AccessToken;
    console.log('✅ Staff token obtained');
  } catch (e) { console.log('❌ Auth failed:', e.response?.data?.Error?.Message || e.message); }

  const authHeaders = { ...headers, Authorization: token };

  // 3. Staff list
  try {
    const staff = await axios.get(BASE + '/staff/staff', { headers: authHeaders });
    console.log('\n📋 Staff members:');
    (staff.data.StaffMembers || []).slice(0, 10).forEach(s =>
      console.log(`   ID: ${s.Id}  Name: ${s.FirstName} ${s.LastName}  Email: ${s.Email || ''}`)
    );
  } catch (e) { console.log('❌ Staff fetch failed:', e.response?.data?.Error?.Message || e.message); }

  // 4. Services (Session Types)
  try {
    const svcs = await axios.get(BASE + '/appointment/activesessiontypes', { headers: authHeaders });
    console.log('\n💆 Active session types (services):');
    (svcs.data.SessionTypes || []).slice(0, 15).forEach(s =>
      console.log(`   ID: ${s.Id}  Name: ${s.Name}  Duration: ${s.DefaultTimeLength} min`)
    );
  } catch (e) { console.log('❌ Services fetch failed:', e.response?.data?.Error?.Message || e.message); }

  // 5. Try finding a client
  try {
    const clients = await axios.get(BASE + '/client/clients', {
      headers: authHeaders,
      params: { SearchText: 'Test' }
    });
    const c = clients.data.Clients?.[0];
    if (c) console.log(`\n👤 Sample client: ${c.FirstName} ${c.LastName} (ID: ${c.Id})`);
    else   console.log('\n👤 No clients found matching "Test"');
  } catch (e) { console.log('❌ Client search failed:', e.response?.data?.Error?.Message || e.message); }

  console.log('\n✅ Sandbox test complete.\n');
})();
