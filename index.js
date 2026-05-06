/**
 * index.js
 * Beside → Mindbody Integration Server
 *
 * Receives Beside call webhooks and automatically:
 *  1. Parses booking intent from the call summary/transcript
 *  2. Finds or creates the client in Mindbody
 *  3. Books the appointment
 *  4. Sends a confirmation text to the client
 *
 * Setup:
 *   1. cp .env.example .env  →  fill in your credentials
 *   2. npm install
 *   3. node index.js
 *   4. Point Beside webhook URL to: http://your-server:3000/webhook/beside
 */

require('dotenv').config();
const express = require('express');
const morgan  = require('morgan');

const { parseCallPayload }   = require('./parser');
const {
  findOrCreateClient,
  resolveService,
  getAvailability,
  bookAppointment,
  sendTextMessage,
} = require('./mindbody');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // parse form-encoded data from Zapier
app.use(morgan('dev'));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Beside → Mindbody Integration' });
});

// ─── Beside Webhook ───────────────────────────────────────────────────────────
app.post('/webhook/beside', async (req, res) => {
  try {
    // Optional: verify webhook secret
    const secret = req.headers['x-beside-secret'] || req.headers['authorization'];
    if (process.env.BESIDE_WEBHOOK_SECRET && secret !== process.env.BESIDE_WEBHOOK_SECRET) {
      console.warn('[Webhook] Unauthorized request — wrong secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = req.body;
    console.log('\n─────────────────────────────────────');
    console.log('[Webhook] Received Beside call event');
    console.log('[Webhook] Full payload:', JSON.stringify(payload, null, 2));
    console.log('[Webhook] Caller:', payload.callerName || payload.caller_name || payload.phone || 'Unknown');

    // ── Step 1: Parse the call payload ────────────────────────────────────
    const intent = parseCallPayload(payload);
    console.log('[Parser] Booking intent detected:', intent.hasBookingIntent);
    console.log('[Parser] Caller:', intent.caller);
    console.log('[Parser] Appointment:', intent.appointment);

    if (!intent.hasBookingIntent) {
      console.log('[Handler] No booking intent — skipping Mindbody actions');
      return res.json({
        success: true,
        action: 'skipped',
        reason: 'No booking intent detected in this call',
      });
    }

    // ── Step 2: Find or create the client in Mindbody ─────────────────────
    const client = await findOrCreateClient({
      firstName: intent.caller.firstName,
      lastName:  intent.caller.lastName,
      phone:     intent.caller.phone,
    });

    console.log(`[Mindbody] Client ready: ${client.FirstName} ${client.LastName} (ID: ${client.Id})`);

    // ── Step 3: Resolve the service type ──────────────────────────────────
    const serviceId = await resolveService(intent.appointment.serviceType);
    const staffId   = parseInt(process.env.DEFAULT_STAFF_ID, 10);

    // ── Step 4: Book the appointment (if we have a date/time) ────────────
    let appointment = null;
    if (intent.appointment.startDateTime) {
      appointment = await bookAppointment({
        clientId:      client.Id,
        serviceId,
        staffId,
        startDateTime: intent.appointment.startDateTime,
        notes:         intent.notes,
      });
      console.log(`[Mindbody] Appointment booked! ID: ${appointment?.Id}`);
    } else {
      console.log('[Handler] No date/time found — skipping appointment booking');
    }

    // ── Step 5: Send confirmation text ────────────────────────────────────
    if (appointment && client.Id) {
      const serviceName = intent.appointment.serviceType || 'massage';
      const dateStr     = intent.appointment.date || 'your scheduled date';
      const timeStr     = intent.appointment.time
        ? formatTime(intent.appointment.time)
        : 'your scheduled time';

      const confirmationMsg = buildConfirmationMessage({
        firstName:   client.FirstName,
        serviceName,
        dateStr,
        timeStr,
        appointmentId: appointment.Id,
      });

      await sendTextMessage(client.Id, confirmationMsg);
      console.log('[Mindbody] Confirmation message sent to client');
    }

    // ── Respond ───────────────────────────────────────────────────────────
    res.json({
      success: true,
      action: 'booked',
      client: {
        id:        client.Id,
        firstName: client.FirstName,
        lastName:  client.LastName,
      },
      appointment: appointment
        ? { id: appointment.Id, startDateTime: appointment.StartDateTime }
        : null,
    });

  } catch (err) {
    console.error('[Error]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Lead creation webhook (fires on new leads in Beside) ────────────────────
app.post('/webhook/beside/lead', async (req, res) => {
  try {
    const payload = req.body;
    console.log('\n─────────────────────────────────────');
    console.log('[Lead Webhook] New lead:', payload.callerName || payload.phone);

    const intent = parseCallPayload(payload);

    // Create the client in Mindbody as a lead / prospect
    const client = await findOrCreateClient({
      firstName: intent.caller.firstName,
      lastName:  intent.caller.lastName,
      phone:     intent.caller.phone,
    });

    res.json({
      success: true,
      action: 'lead_created',
      client: { id: client.Id, firstName: client.FirstName },
    });

  } catch (err) {
    console.error('[Lead Error]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(timeStr) {
  // "14:00:00" → "2:00 PM"
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour   = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

function buildConfirmationMessage({ firstName, serviceName, dateStr, timeStr, appointmentId }) {
  return `
    <p>Hi ${firstName},</p>
    <p>Your <strong>${serviceName} massage</strong> appointment at
    <strong>Spacibo Therapeutic Massage</strong> has been confirmed!</p>
    <p><strong>Date:</strong> ${dateStr}<br/>
    <strong>Time:</strong> ${timeStr}<br/>
    <strong>Location:</strong> 5571 N University Drive, Coral Springs, FL 33067</p>
    <p>Please arrive 5 minutes early. If you need to reschedule,
    reply to this message or call us at your convenience.</p>
    <p>See you soon!<br/>— David, Spacibo Therapeutic Massage</p>
    ${appointmentId ? `<p style="color:#999;font-size:12px">Confirmation #: ${appointmentId}</p>` : ''}
  `.trim();
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Beside → Mindbody integration running on port ${PORT}`);
  console.log(`   Webhook URL: http://localhost:${PORT}/webhook/beside`);
  console.log(`   Lead URL:    http://localhost:${PORT}/webhook/beside/lead`);
  console.log(`   Mindbody Site ID: ${process.env.MINDBODY_SITE_ID}`);
});
