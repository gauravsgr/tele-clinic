'use strict';

const templates = require('../templates');

describe('templates.js', () => {
  const TYPES = ['booking_confirmation', 'reminder_1h', 'cancellation'];

  test('exports all three message types', () => {
    for (const type of TYPES) {
      expect(templates).toHaveProperty(type);
    }
  });

  test.each(TYPES)('%s has exactly 3 variants', (type) => {
    expect(Array.isArray(templates[type])).toBe(true);
    expect(templates[type]).toHaveLength(3);
  });

  test.each(TYPES)('%s — all variants are non-empty strings', (type) => {
    for (const variant of templates[type]) {
      expect(typeof variant).toBe('string');
      expect(variant.length).toBeGreaterThan(0);
    }
  });

  test.each(TYPES)('%s — all variants contain {patient_name}', (type) => {
    for (const variant of templates[type]) {
      expect(variant).toContain('{patient_name}');
    }
  });

  test.each(TYPES)('%s — all variants contain {doctor_name}', (type) => {
    for (const variant of templates[type]) {
      expect(variant).toContain('{doctor_name}');
    }
  });

  test.each(TYPES)('%s — all variants contain {time}', (type) => {
    for (const variant of templates[type]) {
      expect(variant).toContain('{time}');
    }
  });

  test('booking_confirmation — all variants contain {date}', () => {
    for (const variant of templates.booking_confirmation) {
      expect(variant).toContain('{date}');
    }
  });

  test('cancellation — all variants contain {date}', () => {
    for (const variant of templates.cancellation) {
      expect(variant).toContain('{date}');
    }
  });

  test('reminder_1h — variants do NOT contain {date} (reminder is always for today)', () => {
    for (const variant of templates.reminder_1h) {
      expect(variant).not.toContain('{date}');
    }
  });

  test('no two variants within a type are identical', () => {
    for (const type of TYPES) {
      const variants = templates[type];
      const unique = new Set(variants);
      expect(unique.size).toBe(variants.length);
    }
  });
});
