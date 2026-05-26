/**
 * templates.js — Source of truth for WhatsApp message template strings.
 *
 * Three variants per message type. The Python backend (whatsapp_client.py)
 * selects one variant at random, injects the dynamic placeholders, and sends
 * the final string to the worker via POST /send-message. This file contains
 * the raw strings only — no selection logic.
 *
 * Placeholders: {patient_name}, {doctor_name}, {date}, {time}
 * (reminder_1h does not include {date})
 */

module.exports = {
  /**
   * Sent immediately after a patient successfully books a slot.
   * Contains: {patient_name}, {doctor_name}, {date}, {time}
   */
  booking_confirmation: [
    'Hi {patient_name}! Your appointment with {doctor_name} is confirmed for {date} at {time} IST. Please keep WhatsApp open — the doctor will call you directly. See you then! 🩺',
    'Hello {patient_name}, you\'re all set! {doctor_name} will call you on WhatsApp at {time} on {date}. No need to do anything — just make sure your phone is reachable.',
    'Confirmed ✅ {patient_name}, your slot with {doctor_name} is locked in for {date} at {time}. The doctor will reach out directly via WhatsApp video at that time.',
  ],

  /**
   * Sent ~60 minutes before the appointment slot.
   * Contains: {patient_name}, {doctor_name}, {time}
   * NOTE: {date} is intentionally omitted — the reminder is always for "today".
   */
  reminder_1h: [
    'Hi {patient_name}! Just a reminder — your appointment with {doctor_name} is in about 1 hour, at {time} today. Please keep WhatsApp open and your phone nearby. 📱',
    'Hello {patient_name}, your call with {doctor_name} starts at {time} today. Make sure you\'re in a quiet spot with good connectivity — the doctor will call you on WhatsApp shortly.',
    'Quick heads-up, {patient_name}! Your appointment is at {time} today with {doctor_name}. Stay close to your phone — the WhatsApp call is coming your way soon. 🕐',
  ],

  /**
   * Sent when an appointment is cancelled (by patient or doctor).
   * Contains: {patient_name}, {doctor_name}, {date}, {time}
   */
  cancellation: [
    'Hi {patient_name}, we\'re sorry — your appointment with {doctor_name} on {date} at {time} has been cancelled. Please rebook at your convenience.',
    'Hello {patient_name}. Unfortunately, your slot with {doctor_name} on {date} at {time} is no longer available. You can book a new appointment on the same link.',
    'Update for {patient_name}: your appointment with {doctor_name} scheduled for {date} at {time} has been cancelled. We apologise for any inconvenience — please rebook when ready.',
  ],
};
