/**
 * Identity Parser
 * Extracts and normalizes company identifiers (Name, MC#, DOT#, Phone, Email)
 * from DAT One DOM elements and text.
 */

export class IdentityParser {
  /**
   * Normalizes MC number to digits only
   * @param {string} raw
   * @returns {string}
   */
  static normalizeMC(raw) {
    if (!raw) return '';
    const match = raw.toString().match(/\b(\d{4,8})\b/);
    return match ? match[1] : '';
  }

  /**
   * Normalizes phone number to 10 digits
   * @param {string} raw
   * @returns {string}
   */
  static normalizePhone(raw) {
    if (!raw) return '';
    const digits = raw.toString().replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
      return digits.slice(1);
    }
    return digits.length >= 10 ? digits.slice(-10) : digits;
  }

  /**
   * Format phone for display: (XXX) XXX-XXXX
   * @param {string} phone
   * @returns {string}
   */
  static formatPhone(phone, ext = '') {
    const norm = this.normalizePhone(phone);
    let str = phone || '';
    if (norm.length === 10) {
      str = `(${norm.slice(0, 3)}) ${norm.slice(3, 6)}-${norm.slice(6)}`;
    }
    if (ext) {
      str += ` ext ${ext}`;
    }
    return str;
  }

  /**
   * Extracts phone extension (e.g. ext. 102, x105 -> 102)
   * @param {string} raw
   * @returns {string}
   */
  static extractExt(raw) {
    if (!raw) return '';
    const match = raw.toString().match(/(?:ext\.?|x|extension)\s*([0-9]{1,6})\b/i);
    return match ? match[1] : '';
  }

  /**
   * Normalizes email address
   * @param {string} raw
   * @returns {string}
   */
  static normalizeEmail(raw) {
    if (!raw) return '';
    return raw.toString().trim().toLowerCase();
  }

  /**
   * Normalizes company name for comparison
   * @param {string} raw
   * @returns {string}
   */
  static normalizeName(raw) {
    if (!raw) return '';
    return raw
      .toString()
      .trim()
      .toLowerCase()
      // 1. Standardize corporate abbreviation variants before stripping punctuation
      .replace(/\bl\.l\.c\.?\b/g, 'llc')
      .replace(/\bl\.p\.?\b/g, 'lp')
      .replace(/\bl\.l\.p\.?\b/g, 'llp')
      .replace(/\bincorporated\b/g, 'inc')
      .replace(/\bcorporation\b/g, 'corp')
      .replace(/\blimited liability company\b/g, 'llc')
      .replace(/\blimited\b/g, 'ltd')
      .replace(/\bcompany$/g, 'co')
      // 2. Remove punctuation (commas, periods, quotes, dashes, slashes, brackets)
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
      // 3. Collapse multiple whitespace and trim
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract all potential identifiers from a DOM node or text block
   * @param {HTMLElement|string} target
   * @returns {{ mc: string, dot: string, phones: string[], emails: string[], companyName: string }}
   */
  static extractFrom(target) {
    const text = typeof target === 'string' ? target : target ? (target.innerText || target.textContent || '') : '';

    const result = {
      mc: '',
      dot: '',
      phones: [],
      emails: [],
      ext: '',
      companyName: ''
    };

    if (!text) return result;

    // 0. Extract Extension
    result.ext = this.extractExt(text);

    // 1. Extract MC number (e.g. MC 123456, MC# 123456, MC: 123456)
    const mcMatch = text.match(/\bMC\s*(?:#|no\.?|num\.?)?\s*[:\-]?\s*([0-9]{4,8})\b/i);
    if (mcMatch) {
      result.mc = mcMatch[1];
    }

    // 2. Extract DOT number (e.g. DOT 987654, USDOT: 987654)
    const dotMatch = text.match(/\b(?:USDOT|DOT)\s*(?:#|no\.?|num\.?)?\s*[:\-]?\s*([0-9]{5,9})\b/i);
    if (dotMatch) {
      result.dot = dotMatch[1];
    }

    // 3. Extract Emails
    const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emailMatches) {
      const uniqueEmails = new Set(emailMatches.map((e) => this.normalizeEmail(e)));
      result.emails = Array.from(uniqueEmails);
    }

    // 4. Extract Phones (e.g. (800) 555-0199 or 800-555-0199)
    const phoneMatches = text.match(/(?:\+?1[\s.-]*)?(?:\(?\b[2-9]\d{2}\)?[\s.-]*)[2-9]\d{2}[\s.-]*\d{4}\b/g);
    if (phoneMatches) {
      const uniquePhones = new Set();
      for (const p of phoneMatches) {
        const norm = this.normalizePhone(p);
        if (norm.length === 10) uniquePhones.add(norm);
      }
      result.phones = Array.from(uniquePhones);
    }

    // 5. Try extracting Company Name from DOM structure if target is an element
    if (typeof target !== 'string' && target) {
      result.companyName = this.extractCompanyNameFromElement(target);
    }

    return result;
  }

  /**
   * Attempts to detect company name from typical DAT One detail panels
   * @param {HTMLElement} container
   * @returns {string}
   */
  static extractCompanyNameFromElement(container) {
    // Selectors DAT One often uses for company header or broker card
    const nameSelectors = [
      '[data-testid*="company-name"]',
      '[data-testid*="broker-name"]',
      '[data-testid*="carrier-name"]',
      '.company-name',
      '.broker-name',
      'h2.mat-headline',
      'h3.mat-title',
      'mat-card-title',
      '.title',
      '.header'
    ];

    for (const sel of nameSelectors) {
      const el = container.querySelector(sel);
      if (el && el.innerText) {
        const text = el.innerText.trim();
        // Avoid generic headers
        if (text && !text.toLowerCase().includes('load details') && text.length > 2 && text.length < 80) {
          return text;
        }
      }
    }

    // Fallback: search for first strong/b tag or header in the first child elements
    const boldEl = container.querySelector('h1, h2, h3, h4, [role="heading"]');
    if (boldEl && boldEl.innerText) {
      const text = boldEl.innerText.trim();
      if (text.length > 2 && text.length < 80 && !text.toLowerCase().includes('search')) {
        return text;
      }
    }

    return '';
  }
}
