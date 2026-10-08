/**
 * Notes Storage — Two-level notes model:
 *
 *  🏢 COMPANY NOTE  — keyed by MC# (primary) or normalized company name.
 *                  Covers the company as a whole (rating, general terms, payment).
 *
 *  👤 BROKER NOTE   — each broker has a unique ID.
 *                  Supports MULTIPLE brokers sharing the same company phone number
 *                  (with optional extension / ext).
 *                  Email uniquely identifies a specific broker.
 */
import { StorageService } from '../../core/storage.js';
import { IdentityParser } from './identity-parser.js';

const COMPANY_KEY = 'company-notes-data';
const BROKER_KEY = 'contact-notes-data'; // keeps storage key compatible

function makeCompanyId(mc, companyName) {
  if (mc) return `co_mc_${IdentityParser.normalizeMC(mc)}`;
  const norm = IdentityParser.normalizeName(companyName || '');
  return norm ? `co_name_${norm.replace(/\s+/g, '_')}` : null;
}

export class NotesStorage {

  // ── COMPANY NOTES ──────────────────────────────────────────────────────────

  static async getAllCompanyNotes() {
    const data = await StorageService.get(COMPANY_KEY);
    return (data && typeof data === 'object') ? data : {};
  }

  /**
   * Find company note by MC# (exact) or normalized company name.
   * @param {{ mc?: string, companyName?: string }} idents
   * @returns {Promise<object|null>}
   */
  static async findCompanyNote({ mc, companyName } = {}) {
    const all = await this.getAllCompanyNotes();

    const normMC = IdentityParser.normalizeMC(mc);
    if (normMC) {
      const id = `co_mc_${normMC}`;
      if (all[id]) return all[id];
      const match = Object.values(all).find((n) => IdentityParser.normalizeMC(n.mc) === normMC);
      if (match) return match;
    }

    const normName = IdentityParser.normalizeName(companyName);
    if (normName && normName.length >= 2) {
      const match = Object.values(all).find((n) => {
        if (normMC && n.mc) {
          const noteMC = IdentityParser.normalizeMC(n.mc);
          if (noteMC && noteMC !== normMC) return false;
        }
        const nNorm = IdentityParser.normalizeName(n.companyName);
        return nNorm && nNorm === normName;
      });
      if (match) return match;
    }

    return null;
  }

  /**
   * Save or update a company note.
   * @param {object} note
   * @returns {Promise<object>}
   */
  static async saveCompanyNote(note) {
    const all = await this.getAllCompanyNotes();

    const id = note.id || makeCompanyId(note.mc, note.companyName);
    if (!id) throw new Error('Cannot save company note without MC# or company name.');

    const existing = all[id] || {};
    const updated = {
      ...existing,
      ...note,
      id,
      type: 'company',
      companyName: (note.companyName || existing.companyName || '').trim(),
      mc: IdentityParser.normalizeMC(note.mc || existing.mc || ''),
      dot: (note.dot || existing.dot || '').toString().trim(),
      rating: note.rating || existing.rating || 'neutral',
      note: (note.note !== undefined ? note.note : existing.note || '').trim(),
      tags: Array.isArray(note.tags) ? note.tags : (existing.tags || []),
      updatedAt: Date.now(),
      createdAt: existing.createdAt || Date.now(),
    };
    updated.updatedAt = Date.now();

    all[id] = updated;
    await StorageService.set({ [COMPANY_KEY]: all });
    return updated;
  }

  static async deleteCompanyNote(id) {
    const all = await this.getAllCompanyNotes();
    if (all[id]) {
      delete all[id];
      await StorageService.set({ [COMPANY_KEY]: all });
    }
  }

  // ── BROKER NOTES ───────────────────────────────────────────────────────────

  static async getAllBrokerNotes() {
    const data = await StorageService.get(BROKER_KEY);
    return (data && typeof data === 'object') ? data : {};
  }

  /**
   * Find brokers by email and/or phone + ext.
   * Multiple brokers can share the same phone number!
   * @param {{ email?: string, phone?: string, ext?: string }} query
   * @returns {Promise<{ exact: object|null, matches: object[] }>}
   */
  static async findBrokers({ email, phone, ext } = {}) {
    const all = await this.getAllBrokerNotes();
    const list = Object.values(all).filter((n) => n && !n._aliasFor);

    const normEmail = IdentityParser.normalizeEmail(email);
    const normPhone = IdentityParser.normalizePhone(phone);
    const normExt = (ext || '').toString().trim();

    // 1. Email is a unique broker identifier
    if (normEmail) {
      const emailMatch = list.find((b) => {
        if (IdentityParser.normalizeEmail(b.email) === normEmail) return true;
        if (Array.isArray(b.emails) && b.emails.some((e) => IdentityParser.normalizeEmail(e) === normEmail)) return true;
        return false;
      });
      if (emailMatch) {
        return { exact: emailMatch, matches: [emailMatch] };
      }
    }

    // 2. Phone matching (may have multiple brokers on the same phone)
    if (normPhone) {
      const phoneMatches = list.filter((b) => {
        if (IdentityParser.normalizePhone(b.phone) === normPhone) return true;
        if (Array.isArray(b.phones) && b.phones.some((p) => IdentityParser.normalizePhone(p) === normPhone)) return true;
        return false;
      });

      if (phoneMatches.length > 0) {
        // If extension is specified, find exact extension match
        if (normExt) {
          const extMatch = phoneMatches.find((b) => (b.ext || '').toString().trim() === normExt);
          if (extMatch) {
            return { exact: extMatch, matches: phoneMatches };
          }
        }
        // If exactly 1 broker on this phone, it's exact
        if (phoneMatches.length === 1) {
          return { exact: phoneMatches[0], matches: phoneMatches };
        }
        // Multiple brokers on this phone!
        return { exact: null, matches: phoneMatches };
      }
    }

    return { exact: null, matches: [] };
  }

  /**
   * Backward-compatible helper that returns single broker or null
   */
  static async findContactNote(query) {
    const res = await this.findBrokers(query);
    return res.exact || (res.matches.length > 0 ? res.matches[0] : null);
  }

  /**
   * Save or update a broker note.
   * Every broker gets a unique ID so multiple brokers can share a phone number.
   * @param {object} broker
   * @returns {Promise<object>}
   */
  static async saveBrokerNote(broker) {
    const all = await this.getAllBrokerNotes();

    const id = broker.id || `brk_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const existing = all[id] || {};

    const phone = IdentityParser.normalizePhone(broker.phone || (broker.phones?.[0] || existing.phone || ''));
    const email = IdentityParser.normalizeEmail(broker.email || (broker.emails?.[0] || existing.email || ''));
    const ext = (broker.ext !== undefined ? broker.ext : existing.ext || '').toString().trim();
    const brokerName = (broker.brokerName || broker.contactName || existing.brokerName || existing.contactName || '').trim();

    const updated = {
      ...existing,
      ...broker,
      id,
      type: 'broker',
      brokerName: brokerName || 'Брокер без имени',
      contactName: brokerName || 'Брокер без имени', // backward compat
      phone,
      phones: phone ? [phone] : (existing.phones || []),
      ext,
      email,
      emails: email ? [email] : (existing.emails || []),
      companyName: (broker.companyName || existing.companyName || '').trim(),
      mc: IdentityParser.normalizeMC(broker.mc || existing.mc || ''),
      rating: broker.rating || existing.rating || 'neutral',
      note: (broker.note !== undefined ? broker.note : existing.note || '').trim(),
      tags: Array.isArray(broker.tags) ? broker.tags : (existing.tags || []),
      updatedAt: Date.now(),
      createdAt: existing.createdAt || Date.now(),
    };

    all[id] = updated;
    await StorageService.set({ [BROKER_KEY]: all });
    return updated;
  }

  static async saveContactNote(note) {
    return this.saveBrokerNote(note);
  }

  static async deleteBrokerNote(id) {
    const all = await this.getAllBrokerNotes();
    if (all[id]) {
      delete all[id];
      await StorageService.set({ [BROKER_KEY]: all });
    }
  }

  static async deleteContactNote(id) {
    return this.deleteBrokerNote(id);
  }

  /**
   * Returns all brokers for a specific company MC#
   */
  static async getBrokersForCompany(mc) {
    const all = await this.getAllBrokerNotes();
    const normMC = IdentityParser.normalizeMC(mc);
    if (!normMC) return [];
    return Object.values(all).filter((b) => !b._aliasFor && IdentityParser.normalizeMC(b.mc) === normMC);
  }

  // ── FLAT LIST FOR POPUP ────────────────────────────────────────────────────

  static async getAllFlat() {
    const [company, broker] = await Promise.all([
      this.getAllCompanyNotes(),
      this.getAllBrokerNotes(),
    ]);

    const companyList = Object.values(company);
    const brokerList = Object.values(broker).filter((b) => !b._aliasFor);

    return [...companyList, ...brokerList];
  }

  static async search(query, filter = 'all') {
    const all = await this.getAllFlat();
    const q = (query || '').toLowerCase().trim();

    return all.filter((n) => {
      if (filter !== 'all' && n.rating !== filter) return false;
      if (!q) return true;

      const name = (n.companyName || '').toLowerCase();
      const bName = (n.brokerName || n.contactName || '').toLowerCase();
      const mc = (n.mc || '').toLowerCase();
      const note = (n.note || '').toLowerCase();
      const email = (n.email || (n.emails || []).join(' ')).toLowerCase();
      const phone = n.phone || (n.phones || []).join(' ');
      const ext = (n.ext || '').toLowerCase();

      return (
        name.includes(q) ||
        bName.includes(q) ||
        mc.includes(q) ||
        note.includes(q) ||
        email.includes(q) ||
        phone.includes(q) ||
        ext.includes(q)
      );
    });
  }
}
