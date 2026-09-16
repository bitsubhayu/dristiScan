/**
 * DrishtiScan — Text Shape & Format Validators
 * 
 * Standalone, dependency-free text pattern recognition and sanitization helpers:
 * - Date shape detection (isDateShaped)
 * - Metric/count quantity unit verification (VALID_MASS_VOLUME_UNITS, VALID_COUNT_UNITS, isValidQuantityUnit)
 * - Promotional/marketing badge recognition (MARKETING_BADGE_PATTERNS, isMarketingBadge)
 * - Identity candidate rejection heuristics across 13 categories (isNonProductTitleCandidate)
 * - Standard known countries list (KNOWN_COUNTRIES)
 * - Mojibake / encoding / junk artifact text sanitizer (sanitizeExtractedText)
 */

/**
 * Helper: Detect if a string is shaped like a calendar date.
 * Matches standard date formats (DD/MM/YYYY, MM/YYYY, Month YYYY, etc.).
 * Identity fields (productName, brandName, genericCommodityName) must NEVER match this.
 */
const isDateShaped = (text) => {
    if (!text || typeof text !== 'string') return false;
    const s = text.trim();
    if (s.length < 3) return false;
    if (/^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/i.test(s)) return true;
    if (s.length < 4) return false;
    if (/\d{1,2}:\d{2}/.test(s)) return true;
    if (/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(s)) return true;
    if (/\b\d{1,2}[/]\d{2,4}\b/.test(s)) return true;
    if (/\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[a-z]*[\s./-]+\d{2,4}\b/i.test(s)) return true;
    if (/\b\d{1,2}[\s./-]+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[a-z]*[\s./-]+\d{2,4}\b/i.test(s)) return true;
    if (/\b(?:BEST\s*BEFORE|EXP|EXPIRY|USE\s*BY|MFG|MFD|PKD|PACKED)\b/i.test(s) && /\d/.test(s)) return true;
    return false;
};

/**
 * Valid standard metric mass/volume units and packaging count units.
 * Non-units such as "n", "u", "ch", or arbitrary noise tokens must be rejected.
 */
const VALID_MASS_VOLUME_UNITS = new Set([
    'g', 'gm', 'gms', 'gram', 'grams',
    'kg', 'kgs', 'kilogram', 'kilograms',
    'mg', 'milligram', 'milligrams',
    'ml', 'mls', 'millilitre', 'millilitres', 'milliliter', 'milliliters',
    'l', 'lt', 'ltr', 'litre', 'litres', 'liter', 'liters',
    'cl'
]);

const VALID_COUNT_UNITS = new Set([
    'capsules', 'capsule', 'tablets', 'tablet',
    'softgels', 'softgel', 'pieces', 'piece',
    'sachets', 'sachet', 'units', 'unit',
    'packs', 'pack', 'candies', 'gummies',
    'bars', 'pouches', 'vials', 'ampoules',
    'rolls', 'sheets', 'wipes'
]);

const isValidQuantityUnit = (unit) => {
    if (!unit || typeof unit !== 'string') return false;
    const u = unit.trim().toLowerCase();
    return VALID_MASS_VOLUME_UNITS.has(u) || VALID_COUNT_UNITS.has(u);
};

/**
 * Marketing/quality badge patterns that must NEVER be treated as brand,
 * product, or generic commodity name. These are promotional declarations,
 * not identity declarations.
 */
const MARKETING_BADGE_PATTERNS = [
    /100\s*%\s*(?:authentic|pure|natural|organic|vegetarian|veg|genuine)/i,
    /\b(?:certified|premium|quality|original|guaranteed|approved|tested|verified)\b/i,
    /\b(?:ISO|GMP|HACCP|WHO|GLP)\s*(?:certified|approved)?\b/i,
    /\b(?:Halal|Kosher|Vegan|Gluten\s*Free)\s*(?:Certified)?\b/i,
    /\b(?:award|winning|best|trusted|leading|no\.?\s*1)\b/i,
    /\b(?:clinically|scientifically|lab)\s*(?:tested|proven|validated)\b/i,
    /\b(?:money\s*back|satisfaction)\s*(?:guarantee)?\b/i,
    /\b(?:new|improved|advanced|ultra|super|mega|pro|max)\b/i,
    /^\s*(?:made\s*in|product\s*of|manufactured|marketed|packed|imported)\b/i,
];

/**
 * Check if a text string is a marketing badge / quality claim, not an identity declaration.
 */
const isMarketingBadge = (text) => {
    if (!text || typeof text !== 'string') return false;
    const t = text.trim();
    if (t.length < 3) return false;
    return MARKETING_BADGE_PATTERNS.some(p => p.test(t));
};

/**
 * Filter out non-product-title candidates across 13 rejection categories.
 * Pure string/regex logic with zero external dependencies.
 */
const isNonProductTitleCandidate = (rawText) => {
    if (!rawText || typeof rawText !== 'string') return true;
    const tr = rawText.trim();
    if (tr.length < 2 || tr.length > 70) return true;

    // 1. Single character or isolated symbols
    if (/^[^\w\s]+$/.test(tr) || tr.length === 1) return true;

    // 2. Pure digits, decimals, times, pure punctuation, or phone numbers
    if (/^\d+(?:\.\d+)?$/.test(tr)) return true;
    if (/^\d+\.\d{2}$/.test(tr)) return true;
    if (/\d{1,2}:\d{2}/.test(tr)) return true;
    if (/^[+\d\s\-().]{7,25}$/.test(tr)) return true;

    // 3. Quantities, dosages, servings, counts, and standalone units:
    if (/^\s*\d+(?:\.\d+)?\s*(?:mg|g|gm|gms|kg|kgs|ml|mls|l|lt|ltr|cl|oz|fl\s*oz|pt|kcal|tablets?|capsules?|softgels?|cap|caps|tabs?|pcs|pieces?|units?|sachets?|servings?|count|ct)\b/i.test(tr)) return true;
    if (/^\s*(?:approx\.?\s*)?\d+(?:\.\d+)?\s*(?:mg|g|ml|kg|l)\b/i.test(tr)) return true;
    if (/^\s*(?:\d+\s*)?(?:capsules?|tablets?|softgels?|cap|caps|tabs?|pcs|pieces?|units?|sachets?|scoop)[:.-]?$/i.test(tr)) return true;
    if (/^\s*(?:\d+\s*)?(?:servings?|servings?\s*per\s*container)[:.-]?/i.test(tr)) return true;
    if (/servings?$/i.test(tr)) return true;
    if (/^\d+\s*Capsule\s*\(/i.test(tr)) return true;

    const withoutNum = tr.replace(/[\d.,+\-/()%\s]/g, '').toLowerCase();
    if (withoutNum.length > 0 && /^(?:mg|g|gm|gms|kg|kgs|ml|mls|l|lt|ltr|oz|pt|kcal|mcg|tablets?|capsules?|softgels?|servings?)$/i.test(withoutNum)) return true;

    // 4. Prices, taxes, and currency:
    if (/[₹$€£]/.test(tr)) return true;
    if (/\b(?:rs\.?|inr)\s*[:.-]?\s*\d+/i.test(tr)) return true;
    if (/\b(?:mrp|usp|unit\s*sale\s*price|max\s*retail)\b/i.test(tr)) return true;
    if (/\b\d+(?:\.\d+)?\s*\/\s*(?:cap|tab|g|kg|ml|unit|pc|piece)\b/i.test(tr)) return true;
    if (/\b(?:taxes?|tax\b|incl\.?\s*of|inclusive\s*of)\b/i.test(tr)) return true;
    if (/^\(?cincl\.?of/i.test(tr)) return true;

    // 5. Dates, months, timestamps, and packaging codes:
    if (/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(tr)) return true;
    if (/\b\d{1,2}[/]\d{2,4}\b/.test(tr)) return true;
    if (/\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[a-z]*[\s./-]*\d{2,4}\b/i.test(tr)) return true;
    if (/^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/i.test(tr)) return true;
    if (/\b(?:mfg|pkd|exp|expiry|best\s*before|use\s*by|packed\s*on)\b/i.test(tr)) return true;

    // 6. Batch / Lot / Serial numbers:
    if (/\b(?:batch|lot|b\.?\s*no\.?)\b/i.test(tr)) return true;
    if (/^[A-Z]{2,6}\d{4,10}$/i.test(tr)) return true;
    if (/^B\d{4,}$/i.test(tr)) return true;

    // 7. Regulatory, Licenses, Standards, Barcodes:
    if (/\b(?:fssai|lic\.?\s*no\.?|license)\b/i.test(tr)) return true;
    if (/^\d{14}$/.test(tr)) return true;
    if (/\d{5,}"\d{5,}/.test(tr)) return true;
    if (/\b(?:ICMR|RDA|WHO|GMP|ISO|HACCP)\b/i.test(tr)) return true;
    if (/percent\s*rda|guideline\s*2020|medical\s*research/i.test(tr)) return true;

    // 8. Additives, INS numbers, Excipients:
    if (/INS\s*\d+/i.test(tr)) return true;
    if (/\b(?:preservative|humectant|emulsifier|stabilizer|thickener|acidity\s*regulator|anti-caking)\b/i.test(tr)) return true;
    if (/^-\s*(?:monounsaturated|polyunsaturated|saturated|trans\s*fat|cholesterol|epa|dha)/i.test(tr)) return true;

    // 9. Nutrition panel & Ingredients headers/rows:
    if (/^(?:nutrition\s*(?:information|facts)?|nutritional\s*information|supplement\s*facts|ingredients?|ingredents?|ngedients?)\s*[:.-]?$/i.test(tr)) return true;
    if (/^(?:energy|protein|fat|total\s*fat|carbohydrate|carbs?|total\s*sugars?|added\s*sugars?|sodium|cholesterol|dietary\s*fiber)\s*[:.-]?\s*(?:\d|<|>|nil|trace|none|\bper\b|\bamount\b|\bg\b|\bmg\b|\bkcal\b)/i.test(tr)) return true;
    if (/^(?:energy|protein|fat|total\s*fat|carbohydrate|carbs?|total\s*sugars?|added\s*sugars?|sodium|cholesterol|dietary\s*fiber)\s*[:.-]?$/i.test(tr)) return true;
    if (/\b(?:per\s*serving|amount\s*per\s*serving|daily\s*value|\bper\s*100g?\b)\b/i.test(tr)) return true;
    if (/^allergens?\b/i.test(tr)) return true;

    // 10. Contact, Customer care, URLs, Phones, Feedback:
    if (/^(?:customer|consumer|client)\b/i.test(tr)) return true;
    if (/\b(?:customer\s*care|consumer\s*care|for\s*feedback|helpline|toll\s*free|call\s*1-|call\s*\+91)\b/i.test(tr)) return true;
    if (/\b(?:https?:\/\/|www\.|\.(?:com|org|net|in|co|gov|edu)\b)/i.test(tr)) return true;
    if (/^(?:visit|check|browse|follow|refer\s*to)\s+(?:us|our|online|website|at|for|more)?\b/i.test(tr)) return true;

    // 11. Storage instructions & Disclaimers:
    if (/\b(?:store\s*in|keep\s*in|cool\s*and\s*dry|direct\s*sunlight|keep\s*out\s*of\s*reach|how\s*to\s*use|directions?\s*for\s*use)\b/i.test(tr)) return true;
    if (/\b(?:not\s*for\s*medicinal|not\s*to\s*exceed|consult\s*your)\b/i.test(tr)) return true;

    // 12. Corporate suffixes, Legal clauses, Manufacturing notes, and Sentence fragments:
    if (/[,;.]$/.test(tr)) return true; // Sentence fragments ending with punctuation
    if (/^(?:for|to|and|with|our|from|in|on|at|by|of)\s+/i.test(tr)) return true; // Prepositional phrases
    if (/\b(?:feedback|customer|consumer|our\s*products?)\b/i.test(tr)) return true;
    if (/^(?:the|and|or|for|with|from|this|that|these|those|our|your|their|are|was|were|been|have|has|had|not|can|may|will|would|should|could|online)$/i.test(tr)) return true; // Isolated stop words
    if (/^(?:ation|tion|sion|ment|ties|ness|able|ible|ised|ized|tured|ing|ed)$/i.test(tr)) return true; // Isolated morphemes / clipped suffixes
    if (/\b(?:manufactured\s*by|marketed\s*by|packed\s*by|imported\s*by|mfd\.?\s*by|pkd\.?\s*by|made\s*in\b)/i.test(tr)) return true;
    if (/\b(?:is|are|was|were|been|being)\s+(?:manufactured|packed|marketed|distributed|produced|formulated|made|bottled|processed)\b/i.test(tr)) return true; // Passive manufacturing clauses
    if (/\b(?:recycle|recyclable|no\s*refill|please\s*recycle|crush\s*the\s*bottle|dispose\s*of)\b/i.test(tr)) return true; // Generic packaging handling directives
    if (/\b(?:proof\s*of\s*purch(?:ase)?|code\s*under\s*(?:the\s*)?cap|scratch\s*code|scan\s*qr|scan\s*to\s*win)\b/i.test(tr)) return true; // Generic consumer packaging promotions
    if (/^(?:share|enjoy|taste|try|feel|drink|serve|refresh)\s+(?:a|an|the|our|this)\b/i.test(tr)) return true; // Generic imperative marketing slogans
    if (/^[a-z0-9\s]+:$/i.test(tr)) return true;

    // 13. Imperative / procedural packaging-handling directives — generic,
    // not tied to any specific product (e.g. cut-here marks, tear lines,
    // twist-open caps, peel tabs). These are printed instructions for
    // handling the package, never the product's identity.
    if (/\b(?:cut|tear|open|peel|pull|press|push|twist|fold|snip|lift)\b.{0,20}\b(?:here|along|this\s*(?:line|side|edge)|dotted\s*line|perforat\w*|to\s*open|tab|corner)\b/i.test(tr)) return true;
    if (/^(?:cut|tear|open|peel|pull|press|push|twist|fold|snip)\s+(?:here|from\s*here|along|this|the|open|carefully)/i.test(tr)) return true;
    if (/\b(?:dotted|perforated)\s*line\b/i.test(tr)) return true;

    return false;
};

const KNOWN_COUNTRIES = [
    'India', 'United States', 'USA', 'China', 'Germany', 'United Kingdom', 'UK', 
    'Japan', 'France', 'Italy', 'Canada', 'Australia', 'Ireland', 'Switzerland', 
    'Vietnam', 'Thailand', 'Indonesia', 'Malaysia', 'Singapore', 'Taiwan', 
    'Korea', 'South Korea', 'Sri Lanka', 'Bangladesh', 'Nepal', 'Bhutan', 
    'United Arab Emirates', 'UAE', 'Spain', 'Netherlands', 'Belgium', 'Brazil', 
    'Mexico', 'South Africa', 'New Zealand'
];

/**
 * Generic Commodity / Category nouns and descriptors.
 * Prevents generic commodity concepts (e.g. protein, oil, milk, etc.)
 * from being accepted as brandName.
 */
const GENERIC_COMMODITY_NOUNS = new Set([
    'protein', 'whey', 'isolate', 'casein', 'creatine', 'collagen', 'bcaa', 'glutamine',
    'milk', 'dairy', 'curd', 'yogurt', 'cheese', 'paneer', 'butter', 'ghee',
    'juice', 'drink', 'beverage', 'water', 'soda', 'cola', 'tea', 'coffee',
    'oil', 'flour', 'atta', 'maida', 'besan', 'sooji', 'rava', 'rice', 'dal', 'pulses', 'lentils',
    'mustard', 'sunflower', 'olive', 'coconut', 'soybean', 'sesame', 'groundnut', 'peanut', 'canola', 'palm', 'vegetable',
    'soap', 'shampoo', 'conditioner', 'lotion', 'cream', 'paste', 'toothpaste',
    'biscuit', 'biscuits', 'cookie', 'cookies', 'snack', 'snacks', 'chips', 'wafers', 'namkeen',
    'noodle', 'noodles', 'pasta', 'vermicelli', 'cereal', 'oats', 'muesli', 'corn', 'wheat',
    'salt', 'sugar', 'jaggery', 'honey', 'vinegar', 'sauce', 'ketchup', 'jam', 'spread',
    'spice', 'spices', 'masala', 'turmeric', 'chilli', 'coriander', 'cumin', 'pepper',
    'supplement', 'supplements', 'capsules', 'tablets', 'softgels', 'syrup', 'powder',
    'seeds', 'nuts', 'almonds', 'cashews', 'walnuts'
]);

const GENERIC_MODIFIER_WORDS = new Set([
    '100%', 'pure', 'natural', 'organic', 'raw', 'refined', 'filtered', 'cold', 'pressed',
    'virgin', 'extra', 'dietary', 'nutritional', 'food', 'health', 'instant', 'premium',
    'classic', 'fresh', 'rich', 'creamy', 'crispy', 'roasted', 'salted', 'sweet', 'plain',
    'edible', 'packaged', 'table', 'cooking', 'daily', 'multivitamin', 'herbal', 'ayurvedic',
    'concentrate', 'hydrolyzed', 'blend', 'mix', 'supplement', 'powder', 'drink', 'beverage',
    'liquid', 'capsules', 'tablets', 'softgels', 'oil', 'flour', 'grains', 'whole', 'unrefined',
    'mustard', 'sunflower', 'olive', 'coconut', 'soybean', 'sesame', 'groundnut', 'peanut', 'vegetable'
]);

/**
 * Checks if a string is merely a generic commodity or category descriptor.
 */
const isGenericCommodityTerm = (text) => {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim().toLowerCase();
    if (clean.length < 2) return false;

    // Direct match against known commodity nouns
    if (GENERIC_COMMODITY_NOUNS.has(clean)) return true;

    // Check if composed entirely of generic modifiers and commodity nouns
    const words = clean.replace(/[^a-z0-9\s%]/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length === 0) return false;

    const allGeneric = words.every(w => GENERIC_COMMODITY_NOUNS.has(w) || GENERIC_MODIFIER_WORDS.has(w) || /^\d+%?$/.test(w));
    if (allGeneric && words.some(w => GENERIC_COMMODITY_NOUNS.has(w))) {
        return true;
    }

    return false;
};

/**
 * Checks if a string contains an explicit country of origin or manufacturing declaration.
 */
const EXPLICIT_COUNTRY_PREFIX_REGEX = /^(?:country\s*of\s*origin|country\s*of\s*manufacture|country\s*manufactured\s*in|made\s*in|manufactured\s*in|product\s*of|origin)\s*[:.-]?\s*(.+)/i;

const isExplicitCountryDeclaration = (text) => {
    if (!text || typeof text !== 'string') return false;
    const t = text.trim();
    if (t.length < 3) return false;

    // Reject email / web addresses immediately
    if (/@|www\.|\.(?:com|org|net|in\b|co\.)/i.test(t)) return false;

    return EXPLICIT_COUNTRY_PREFIX_REGEX.test(t);
};

/**
 * Extracts explicit country from a declaration string.
 * Returns normalized country name if the string is an explicit country declaration
 * (e.g. "Made in Germany" -> "Germany", "Country of Origin: Japan" -> "Japan").
 * Returns null if the country is only part of an address, URL, email, or unrelated text.
 */
const extractExplicitCountryFromDeclaration = (text) => {
    if (!text || typeof text !== 'string') return null;
    const t = text.trim();
    if (t.length < 3) return null;

    // Reject email / web addresses immediately
    if (/@|www\.|\.(?:com|org|net|in\b|co\.)/i.test(t)) return null;

    const match = t.match(EXPLICIT_COUNTRY_PREFIX_REGEX);
    if (!match || !match[1]) return null;

    const candidate = match[1].trim();
    for (const country of KNOWN_COUNTRIES) {
        const countryPattern = new RegExp(`\\b${country}\\b`, 'i');
        if (countryPattern.test(candidate)) {
            return country === 'USA' ? 'United States' : country;
        }
    }
    return null;
};

/**
 * Universal text sanitization helper to clean OCR noise, broken encodings,
 * mojibake (e.g. "â‚¹", "â€“"), and malformed characters such as "&þ" or isolated "þ".
 * If the resulting string has no real words or characters, returns null so clean
 * human-readable fallbacks ("Not detected") render instead of garbage.
 */
const sanitizeExtractedText = (val) => {
    if (val === null || val === undefined) return null;
    if (typeof val !== 'string') return val;

    let s = val.trim();
    if (!s) return null;

    // 1. Fix common mojibake sequences from Latin-1 / UTF-8 misdecoding
    s = s.replace(/â‚¹/g, '₹')
         .replace(/â€“/g, '—')
         .replace(/â€”/g, '—')
         .replace(/â€™/g, "'")
         .replace(/â€˜/g, "'")
         .replace(/â€œ/g, '"')
         .replace(/â€/g, '"')
         .replace(/Ã©/g, 'é')
         .replace(/Ã¢/g, 'â')
         .replace(/Ã¼/g, 'ü');

    // 2. Fix broken thorn / ampersand artifacts ("&þ" -> "&", isolated "þ" -> "")
    s = s.replace(/&þ/g, '&')
         .replace(/&amp;þ/g, '&')
         .replace(/[þðýÿøæœ§±µ¿¡†‡¶°\u00FE\u00FD\u00F0]/g, ' ');

    // 3. Remove non-printable control characters
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

    // 4. Collapse multiple spaces
    s = s.replace(/\s+/g, ' ').trim();

    // 5. If the string is purely junk symbols/punctuation, return null
    if (/^[\s\-_.:,;/'"&|*~`!@#$%^()=+<>{}[\]\\]+$/.test(s) || s.length === 0) {
        return null;
    }

    return s;
};

/**
 * Post-extraction format validator for fields with well-defined shapes.
 * Returns { valid: true, value } if the value conforms, or { valid: false, reason } if not.
 * Non-conforming values should be marked REVIEW, not accepted as-is.
 */
const validateFieldFormat = (fieldName, value) => {
    if (value === null || value === undefined) return { valid: true, value: null };

    switch (fieldName) {
        case 'productName':
        case 'brandName':
        case 'genericCommodityName': {
            const str = String(value).trim();
            if (isDateShaped(str)) {
                return { valid: false, reason: `Field value "${str}" is date-shaped — rejected` };
            }
            if (isMarketingBadge(str)) {
                return { valid: false, reason: `Field value "${str}" is a promotional/marketing badge — rejected` };
            }
            if (isNonProductTitleCandidate(str)) {
                return { valid: false, reason: `Rejected by identity-candidate filter: "${str}"` };
            }
            if (str.length < 2) {
                return { valid: false, reason: 'Too short to be a valid identity declaration' };
            }
            if (fieldName === 'brandName' && isGenericCommodityTerm(str)) {
                return { valid: false, reason: `Generic category/commodity descriptor "${str}" cannot be accepted as brandName` };
            }
            return { valid: true, value: str };
        }
        case 'countryOfOrigin': {
            const str = String(value).trim();
            if (!str) return { valid: false, reason: 'Empty country of origin' };
            if (/@|www\.|\.(?:com|org|net|in\b|co\.)/i.test(str)) {
                return { valid: false, reason: `Contains URL/email — not a valid country: "${str}"` };
            }
            const found = KNOWN_COUNTRIES.find(c => new RegExp(`\\b${c}\\b`, 'i').test(str));
            if (!found) {
                return { valid: false, reason: `"${str}" is not a recognized country of origin` };
            }
            return { valid: true, value: found === 'USA' ? 'United States' : found };
        }
        case 'netQuantity': {
            if (value && typeof value === 'object') {
                const val = value.value !== undefined ? value.value : value.amount;
                const unit = value.unit;
                if (val === null || val === undefined || isNaN(parseFloat(val)) || parseFloat(val) <= 0) {
                    return { valid: false, reason: 'Net quantity has non-numeric or non-positive value' };
                }
                if (!isValidQuantityUnit(unit)) {
                    return { valid: false, reason: `Unit "${unit}" is not a recognized standard metric or count unit` };
                }
                return { valid: true, value };
            }
            const rawStr = String(value);
            if (/(?:protein|carbohydrate|fat|sugar|sodium|fiber|energy|kcal|ingredient|preservative|humectant|acid|how\s*to|direction|storage)/i.test(rawStr)) {
                return { valid: false, reason: 'Contains ingredient/nutrition text — not a valid net quantity' };
            }
            const wordCount = rawStr.trim().split(/\s+/).length;
            if (wordCount > 5) {
                return { valid: false, reason: `Net quantity has ${wordCount} words — likely contaminated with adjacent text` };
            }
            const nqm = rawStr.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/);
            if (nqm && !isValidQuantityUnit(nqm[2])) {
                return { valid: false, reason: `Unit "${nqm[2]}" is not a recognized standard metric or count unit` };
            }
            return { valid: true, value };
        }
        case 'mrp': {
            const valToCheck = (value && typeof value === 'object') ? (value.amount || value.value) : value;
            const m = String(valToCheck || '').match(/\d+(?:\.\d+)?/);
            const num = m ? parseFloat(m[0]) : NaN;
            if (isNaN(num) || num <= 0 || num > 500000) {
                return { valid: false, reason: 'MRP is not a valid positive number' };
            }
            return { valid: true, value: num };
        }
        case 'unitSalePrice': {
            if (!/\d/.test(String(value))) {
                return { valid: false, reason: 'Unit sale price contains no numeric component' };
            }
            return { valid: true, value };
        }
        case 'dates.manufacture':
        case 'dates.expiry':
        case 'dateOfManufacture':
        case 'dateOfExpiry': {
            const dateStr = String(value).trim();
            // Must contain at least a month or number pattern
            if (!/(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|\d{1,2}[/-]\d{2,4})/i.test(dateStr)) {
                return { valid: false, reason: 'Does not match any recognized date format' };
            }
            // Disallow obvious non-date artifacts like "DECD 50"
            const monthWordMatch = dateStr.match(/^([A-Za-z]+)\s*(\d+)$/);
            if (monthWordMatch) {
                const VALID_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
                                      'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
                if (!VALID_MONTHS.includes(monthWordMatch[1].toUpperCase())) {
                    return { valid: false, reason: `"${monthWordMatch[1]}" is not a recognized calendar month` };
                }
            }
            return { valid: true, value };
        }
        case 'batchNumber': {
            const batch = String(value).trim();
            if (batch.length < 3 || batch.length > 25) {
                return { valid: false, reason: `Batch number length ${batch.length} is outside expected 3-25 chars` };
            }
            if (!/[A-Za-z0-9]/.test(batch)) {
                return { valid: false, reason: 'Batch number contains no alphanumeric characters' };
            }
            return { valid: true, value };
        }
        case 'fssaiLicenseNumber': {
            const fssai = String(value).trim();
            if (!/^\d{14}$/.test(fssai)) {
                return { valid: false, reason: 'FSSAI license must be exactly 14 digits' };
            }
            return { valid: true, value };
        }
        case 'servingsPerContainer': {
            const valToCheck = (value && typeof value === 'object') ? (value.amount || value.value) : value;
            const num = parseFloat(String(valToCheck));
            if (isNaN(num) || num <= 0) {
                return { valid: false, reason: 'Servings per container is not a positive number' };
            }
            return { valid: true, value: num };
        }
        case 'servingSize': {
            const str = String(value).trim();
            if (str.length < 1) return { valid: false, reason: 'Serving size is empty' };
            return { valid: true, value: str };
        }
        default:
            return { valid: true, value };
    }
};

module.exports = {
    isDateShaped,
    VALID_MASS_VOLUME_UNITS,
    VALID_COUNT_UNITS,
    isValidQuantityUnit,
    MARKETING_BADGE_PATTERNS,
    isMarketingBadge,
    isNonProductTitleCandidate,
    validateFieldFormat,
    KNOWN_COUNTRIES,
    sanitizeExtractedText,
    isGenericCommodityTerm,
    isExplicitCountryDeclaration,
    extractExplicitCountryFromDeclaration
};

