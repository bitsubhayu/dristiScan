/**
 * DrishtiScan Expanded Consumer Preference & Suitability Engine
 * Phase 3: Comprehensive dietary, allergy, health goals & clean-label evaluation.
 */

// Configurable Starting Default Thresholds for Health Goals (per 100g or per serving)
// NOTE: These are starting engineering defaults, not verified regulatory claim thresholds.
const DEFAULT_THRESHOLDS = {
    highCalorieMax: 400,        // kcal per serving/100g
    lowCalorieMax: 120,         // kcal per serving
    lowSugarMax: 5.0,           // g per 100g
    sugarFreeMax: 0.5,          // g per 100g
    lowSodiumMax: 140,          // mg per serving
    lowFatMax: 3.0,             // g per 100g
    highProteinMin: 10.0,       // g per serving
    highFiberMin: 6.0,          // g per 100g
    ketoNetCarbsMax: 5.0        // g per serving
};

// Keyword dictionaries
const DICTIONARIES = {
    // Non-vegetarian triggers
    nonVeg: ['meat', 'chicken', 'pork', 'beef', 'mutton', 'lamb', 'gelatin', 'animal fat', 'lard', 'carmine', 'cochineal', 'e120', 'rennet'],
    
    // Dairy triggers
    dairy: ['milk', 'dairy', 'cheese', 'butter', 'ghee', 'whey', 'casein', 'cream', 'curd', 'yogurt', 'milk solids', 'milk fat', 'paneer'],
    
    // Lactose triggers
    lactose: ['lactose', 'milk solids', 'whey powder', 'cream', 'condensed milk', 'skimmed milk powder'],
    
    // Egg triggers
    egg: ['egg', 'egg powder', 'albumen', 'ovalbumin', 'yolk', 'lysozyme', 'egg white'],
    
    // Jain restrictions (root vegetables & allium)
    jainRestricted: ['onion', 'garlic', 'potato', 'radish', 'carrot', 'ginger', 'beetroot', 'turnip', 'yeast', 'mushroom'],
    
    // Halal prohibited
    halalProhibited: ['pork', 'bacon', 'ham', 'lard', 'animal shortening', 'gelatin', 'alcohol', 'wine', 'rum', 'beer', 'carmine', 'e120'],
    
    // Kosher prohibited
    kosherProhibited: ['pork', 'shellfish', 'shrimp', 'crab', 'lobster', 'bacon', 'ham'],
    
    // Allergens
    peanuts: ['peanut', 'groundnut', 'arachis oil', 'monkey nut'],
    treeNuts: ['almond', 'cashew', 'walnut', 'hazelnut', 'pistachio', 'pecan', 'macadamia', 'brazil nut', 'pignolia', 'chestnut'],
    soy: ['soy', 'soya', 'soybean', 'edamame', 'tofu', 'soy lecithin', 'hydrolyzed soy protein'],
    wheat: ['wheat', 'wheat flour', 'maida', 'atta', 'semolina', 'suji', 'sooji', 'bulgur', 'durum', 'farina'],
    gluten: ['gluten', 'wheat', 'barley', 'rye', 'spelt', 'triticale', 'malt', 'malt extract', 'brewer\'s yeast'],
    fish: ['fish', 'cod', 'salmon', 'tuna', 'anchovy', 'fish oil', 'fish sauce', 'tilapia', 'mackerel', 'sardine'],
    shellfish: ['shrimp', 'prawn', 'crab', 'lobster', 'mussel', 'oyster', 'clam', 'scallop', 'squid', 'octopus', 'crawfish'],
    sesame: ['sesame', 'til', 'tahini', 'gingelly', 'sesame oil', 'sesame seeds'],
    mustard: ['mustard', 'rai', 'sarson', 'mustard oil', 'mustard seeds', 'mustard flour'],
    sulphites: ['sulphite', 'sulfite', 'sulfur dioxide', 'e220', 'e221', 'e222', 'e223', 'e224', 'e225', 'e226', 'e227', 'e228', 'metabisulphite', 'sodium metabisulfite'],
    
    // Clean Label / Additives
    artificialColors: ['e102', 'e110', 'e122', 'e124', 'e127', 'e129', 'e132', 'e133', 'e142', 'e143', 'tartrazine', 'sunset yellow', 'allura red', 'brilliant blue', 'artificial color', 'synthetic food color'],
    preservatives: ['e200', 'e202', 'e210', 'e211', 'e212', 'e213', 'e280', 'e281', 'e282', 'sodium benzoate', 'potassium sorbate', 'calcium propionate', 'preservative', 'class ii preservative'],
    msg: ['monosodium glutamate', 'msg', 'e621', 'flavor enhancer 621', 'ajinomoto'],
    organicKeywords: ['organic', 'certified organic', 'jaivik bharat', 'usda organic', 'india organic'],
    nonGmoKeywords: ['non-gmo', 'non gmo', 'gmo free', 'non-genetically modified']
};

/**
 * Match a text against an array of keywords
 */
const findMatches = (text = '', keywords = []) => {
    if (!text || typeof text !== 'string') return [];
    const lower = text.toLowerCase();
    return keywords.filter(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, 'i');
        return regex.test(lower);
    });
};

/**
 * Evaluate all selected consumer preferences against extracted package data
 * @param {Object} extractedFields - Structured extraction object
 * @param {Object} preferences - User selected preferences e.g. { vegetarian: true, peanuts: true, ... }
 * @returns {Object} Comprehensive evaluation summary
 */
const evaluatePreferences = (extractedFields = {}, preferences = {}) => {
    // Aggregate full text from ingredients, product name, and raw OCR text
    const ingredientsText = extractedFields.ingredients || '';
    const rawOcrText = Array.isArray(extractedFields.rawOcrText) 
        ? extractedFields.rawOcrText.map(r => r.text || '').join(' ')
        : (typeof extractedFields.rawOcrText === 'string' ? extractedFields.rawOcrText : '');
    const combinedText = `${extractedFields.productName || ''} ${ingredientsText} ${rawOcrText}`.toLowerCase();
    
    const nutrition = extractedFields.nutritionFacts || {};
    const hasNutritionData = !!(nutrition.calories || nutrition.sugar || nutrition.protein || nutrition.fat || nutrition.sodium || nutrition.carbohydrates);

    const results = {
        isSuitable: true,
        summary: [],
        details: {},
        warnings: []
    };

    // Helper to record preference evaluation
    const record = (key, category, label, status, message) => {
        results.details[key] = { category, label, status, message };
        if (status === 'FAIL') {
            results.isSuitable = false;
            results.warnings.push(`${label}: ${message}`);
        }
    };

    // 1. DIETARY TYPES
    if (preferences.vegetarian) {
        const found = findMatches(combinedText, [...DICTIONARIES.nonVeg, ...DICTIONARIES.fish, ...DICTIONARIES.shellfish]);
        if (found.length > 0) {
            record('vegetarian', 'Dietary Type', 'Vegetarian', 'FAIL', `Contains non-vegetarian ingredients (${found.join(', ')})`);
        } else {
            record('vegetarian', 'Dietary Type', 'Vegetarian', 'PASS', 'No non-vegetarian ingredients detected');
        }
    }

    if (preferences.vegan) {
        const found = findMatches(combinedText, [...DICTIONARIES.nonVeg, ...DICTIONARIES.dairy, ...DICTIONARIES.egg, ...DICTIONARIES.fish, ...DICTIONARIES.shellfish, 'honey', 'beeswax']);
        if (found.length > 0) {
            record('vegan', 'Dietary Type', 'Vegan', 'FAIL', `Contains animal-derived ingredients (${found.join(', ')})`);
        } else {
            record('vegan', 'Dietary Type', 'Vegan', 'PASS', '100% plant-based formulation detected');
        }
    }

    if (preferences.eggetarian) {
        const found = findMatches(combinedText, [...DICTIONARIES.nonVeg, ...DICTIONARIES.fish, ...DICTIONARIES.shellfish]);
        if (found.length > 0) {
            record('eggetarian', 'Dietary Type', 'Eggetarian', 'FAIL', `Contains meat or seafood ingredients (${found.join(', ')})`);
        } else {
            record('eggetarian', 'Dietary Type', 'Eggetarian', 'PASS', 'Vegetarian or egg-based ingredients only');
        }
    }

    if (preferences.jain) {
        const found = findMatches(combinedText, [...DICTIONARIES.nonVeg, ...DICTIONARIES.jainRestricted, ...DICTIONARIES.fish, ...DICTIONARIES.shellfish]);
        if (found.length > 0) {
            record('jain', 'Dietary Type', 'Jain Compatible', 'FAIL', `Contains prohibited root vegetables or non-veg ingredients (${found.join(', ')})`);
        } else {
            record('jain', 'Dietary Type', 'Jain Compatible', 'PASS', 'No root vegetables, alliums, or animal products found');
        }
    }

    if (preferences.halal) {
        const found = findMatches(combinedText, DICTIONARIES.halalProhibited);
        if (found.length > 0) {
            record('halal', 'Dietary Type', 'Halal Compliant', 'FAIL', `Contains non-halal ingredients (${found.join(', ')})`);
        } else {
            record('halal', 'Dietary Type', 'Halal Compliant', 'PASS', 'No prohibited porcine or alcoholic ingredients found');
        }
    }

    if (preferences.kosher) {
        const found = findMatches(combinedText, DICTIONARIES.kosherProhibited);
        if (found.length > 0) {
            record('kosher', 'Dietary Type', 'Kosher Compatible', 'FAIL', `Contains non-kosher ingredients (${found.join(', ')})`);
        } else {
            record('kosher', 'Dietary Type', 'Kosher Compatible', 'PASS', 'No prohibited shellfish or pork ingredients detected');
        }
    }

    if (preferences.pescatarian) {
        const found = findMatches(combinedText, DICTIONARIES.nonVeg);
        if (found.length > 0) {
            record('pescatarian', 'Dietary Type', 'Pescatarian', 'FAIL', `Contains meat/poultry ingredients (${found.join(', ')})`);
        } else {
            record('pescatarian', 'Dietary Type', 'Pescatarian', 'PASS', 'Plant, dairy, or seafood ingredients only');
        }
    }

    // 2. ALLERGIES & INTOLERANCES
    const allergyMappings = [
        { key: 'milk', label: 'Milk / Dairy Allergy', dict: DICTIONARIES.dairy },
        { key: 'lactose_intolerance', label: 'Lactose Intolerance', dict: DICTIONARIES.lactose },
        { key: 'eggs', label: 'Egg Allergy', dict: DICTIONARIES.egg },
        { key: 'peanuts', label: 'Peanut Allergy', dict: DICTIONARIES.peanuts },
        { key: 'tree_nuts', label: 'Tree Nut Allergy', dict: DICTIONARIES.treeNuts },
        { key: 'soy', label: 'Soy Allergy', dict: DICTIONARIES.soy },
        { key: 'wheat', label: 'Wheat Allergy', dict: DICTIONARIES.wheat },
        { key: 'gluten_celiac', label: 'Gluten / Celiac Intolerance', dict: DICTIONARIES.gluten },
        { key: 'fish', label: 'Fish Allergy', dict: DICTIONARIES.fish },
        { key: 'shellfish', label: 'Shellfish Allergy', dict: DICTIONARIES.shellfish },
        { key: 'sesame', label: 'Sesame Allergy', dict: DICTIONARIES.sesame },
        { key: 'mustard', label: 'Mustard Allergy', dict: DICTIONARIES.mustard },
        { key: 'sulphites', label: 'Sulphites Sensitivity', dict: DICTIONARIES.sulphites }
    ];

    allergyMappings.forEach(({ key, label, dict }) => {
        if (preferences[key]) {
            const found = findMatches(combinedText, dict);
            if (found.length > 0) {
                record(key, 'Allergies & Intolerances', label, 'FAIL', `ALLERGEN DETECTED: Contains ${found.join(', ')}`);
            } else {
                record(key, 'Allergies & Intolerances', label, 'PASS', `No ${label} triggers detected in ingredient declarations`);
            }
        }
    });

    // 3. HEALTH GOALS (Threshold Checks)
    if (preferences.high_calorie_avoid) {
        if (!hasNutritionData) {
            record('high_calorie_avoid', 'Health Goals', 'Avoid High Calorie', 'INSUFFICIENT_DATA', 'Not enough nutrition information was captured from the photos to verify calorie levels');
        } else if (nutrition.calories && nutrition.calories > DEFAULT_THRESHOLDS.highCalorieMax) {
            record('high_calorie_avoid', 'Health Goals', 'Avoid High Calorie', 'FAIL', `High calorie density detected (${nutrition.calories} kcal > threshold ${DEFAULT_THRESHOLDS.highCalorieMax} kcal)`);
        } else {
            record('high_calorie_avoid', 'Health Goals', 'Avoid High Calorie', 'PASS', `Calorie count (${nutrition.calories || 'moderate'} kcal) is within safe range`);
        }
    }

    if (preferences.low_calorie_prefer) {
        if (!hasNutritionData || nutrition.calories === undefined) {
            record('low_calorie_prefer', 'Health Goals', 'Low Calorie', 'INSUFFICIENT_DATA', 'Not enough nutrition information was captured from the photos to verify calorie levels');
        } else if (nutrition.calories <= DEFAULT_THRESHOLDS.lowCalorieMax) {
            record('low_calorie_prefer', 'Health Goals', 'Low Calorie', 'PASS', `Low calorie verified (${nutrition.calories} kcal <= ${DEFAULT_THRESHOLDS.lowCalorieMax} kcal)`);
        } else {
            record('low_calorie_prefer', 'Health Goals', 'Low Calorie', 'FAIL', `Exceeds low calorie threshold (${nutrition.calories} kcal > ${DEFAULT_THRESHOLDS.lowCalorieMax} kcal)`);
        }
    }

    if (preferences.diabetic_friendly_low_sugar) {
        if (!hasNutritionData || nutrition.sugar === undefined) {
            record('diabetic_friendly_low_sugar', 'Health Goals', 'Diabetic-Friendly / Low Sugar', 'INSUFFICIENT_DATA', 'Not enough nutrition information was captured from the photos to check sugar content');
        } else if (nutrition.sugar <= DEFAULT_THRESHOLDS.lowSugarMax) {
            record('diabetic_friendly_low_sugar', 'Health Goals', 'Diabetic-Friendly / Low Sugar', 'PASS', `Low sugar verified (${nutrition.sugar}g <= ${DEFAULT_THRESHOLDS.lowSugarMax}g)`);
        } else {
            record('diabetic_friendly_low_sugar', 'Health Goals', 'Diabetic-Friendly / Low Sugar', 'FAIL', `High sugar for diabetic diet (${nutrition.sugar}g > ${DEFAULT_THRESHOLDS.lowSugarMax}g)`);
        }
    }

    if (preferences.sugar_free) {
        if (combinedText.includes('sugar free') || combinedText.includes('zero sugar') || (nutrition.sugar !== undefined && nutrition.sugar <= DEFAULT_THRESHOLDS.sugarFreeMax)) {
            record('sugar_free', 'Health Goals', 'Sugar-Free', 'PASS', 'Zero or negligible sugar confirmed');
        } else if (!hasNutritionData) {
            record('sugar_free', 'Health Goals', 'Sugar-Free', 'INSUFFICIENT_DATA', 'Not enough nutrition information was captured from the photos to confirm sugar-free status');
        } else {
            record('sugar_free', 'Health Goals', 'Sugar-Free', 'FAIL', `Contains declared sugars (${nutrition.sugar || 'positive'}g)`);
        }
    }

    if (preferences.low_sodium) {
        if (!hasNutritionData || nutrition.sodium === undefined) {
            record('low_sodium', 'Health Goals', 'Low Sodium', 'INSUFFICIENT_DATA', 'Not enough nutrition information was captured from the photos to verify sodium content');
        } else if (nutrition.sodium <= DEFAULT_THRESHOLDS.lowSodiumMax) {
            record('low_sodium', 'Health Goals', 'Low Sodium', 'PASS', `Low sodium verified (${nutrition.sodium}mg <= ${DEFAULT_THRESHOLDS.lowSodiumMax}mg)`);
        } else {
            record('low_sodium', 'Health Goals', 'Low Sodium', 'FAIL', `High sodium detected (${nutrition.sodium}mg > ${DEFAULT_THRESHOLDS.lowSodiumMax}mg)`);
        }
    }

    if (preferences.low_fat) {
        if (!hasNutritionData || nutrition.fat === undefined) {
            record('low_fat', 'Health Goals', 'Low Fat', 'INSUFFICIENT_DATA', 'Not enough nutrition information was captured from the photos to verify fat content');
        } else if (nutrition.fat <= DEFAULT_THRESHOLDS.lowFatMax) {
            record('low_fat', 'Health Goals', 'Low Fat', 'PASS', `Low fat verified (${nutrition.fat}g <= ${DEFAULT_THRESHOLDS.lowFatMax}g)`);
        } else {
            record('low_fat', 'Health Goals', 'Low Fat', 'FAIL', `Fat content exceeds threshold (${nutrition.fat}g > ${DEFAULT_THRESHOLDS.lowFatMax}g)`);
        }
    }

    if (preferences.high_protein) {
        if (!hasNutritionData || nutrition.protein === undefined) {
            record('high_protein', 'Health Goals', 'High Protein', 'INSUFFICIENT_DATA', 'Not enough nutrition information was captured from the photos to verify protein content');
        } else if (nutrition.protein >= DEFAULT_THRESHOLDS.highProteinMin) {
            record('high_protein', 'Health Goals', 'High Protein', 'PASS', `High protein confirmed (${nutrition.protein}g >= ${DEFAULT_THRESHOLDS.highProteinMin}g)`);
        } else {
            record('high_protein', 'Health Goals', 'High Protein', 'FAIL', `Protein content (${nutrition.protein}g) is below high-protein threshold (${DEFAULT_THRESHOLDS.highProteinMin}g)`);
        }
    }

    if (preferences.high_fiber) {
        if (!hasNutritionData || nutrition.fiber === undefined) {
            record('high_fiber', 'Health Goals', 'High Fiber', 'INSUFFICIENT_DATA', 'Not enough nutrition information was captured from the photos to verify dietary fiber');
        } else if (nutrition.fiber >= DEFAULT_THRESHOLDS.highFiberMin) {
            record('high_fiber', 'Health Goals', 'High Fiber', 'PASS', `High dietary fiber confirmed (${nutrition.fiber}g >= ${DEFAULT_THRESHOLDS.highFiberMin}g)`);
        } else {
            record('high_fiber', 'Health Goals', 'High Fiber', 'FAIL', `Fiber (${nutrition.fiber}g) below high-fiber benchmark (${DEFAULT_THRESHOLDS.highFiberMin}g)`);
        }
    }

    if (preferences.low_carb_keto) {
        if (!hasNutritionData || nutrition.carbohydrates === undefined) {
            record('low_carb_keto', 'Health Goals', 'Low Carb / Keto-Friendly', 'INSUFFICIENT_DATA', 'Not enough nutrition information was captured from the photos to calculate net carbs');
        } else {
            const netCarbs = Math.max(0, nutrition.carbohydrates - (nutrition.fiber || 0));
            if (netCarbs <= DEFAULT_THRESHOLDS.ketoNetCarbsMax) {
                record('low_carb_keto', 'Health Goals', 'Low Carb / Keto-Friendly', 'PASS', `Keto friendly net carbs (${netCarbs}g <= ${DEFAULT_THRESHOLDS.ketoNetCarbsMax}g)`);
            } else {
                record('low_carb_keto', 'Health Goals', 'Low Carb / Keto-Friendly', 'FAIL', `Net carbs (${netCarbs}g) exceed keto limit (${DEFAULT_THRESHOLDS.ketoNetCarbsMax}g)`);
            }
        }
    }

    // 4. OTHER PREFERENCES
    if (preferences.organic_preferred) {
        const found = findMatches(combinedText, DICTIONARIES.organicKeywords);
        if (found.length > 0) {
            record('organic_preferred', 'Other Preferences', 'Organic Certified', 'PASS', `Organic declaration detected ("${found[0]}")`);
        } else {
            record('organic_preferred', 'Other Preferences', 'Organic Certified', 'FAIL', 'No recognized organic certification or claim found on packaging');
        }
    }

    if (preferences.no_artificial_colors_flavors) {
        const found = findMatches(combinedText, DICTIONARIES.artificialColors);
        if (found.length > 0) {
            record('no_artificial_colors_flavors', 'Other Preferences', 'No Artificial Colors/Flavors', 'FAIL', `Artificial additives detected (${found.join(', ')})`);
        } else {
            record('no_artificial_colors_flavors', 'Other Preferences', 'No Artificial Colors/Flavors', 'PASS', 'No synthetic food colors or artificial flavor additives found');
        }
    }

    if (preferences.no_preservatives) {
        const found = findMatches(combinedText, DICTIONARIES.preservatives);
        if (found.length > 0) {
            record('no_preservatives', 'Other Preferences', 'No Preservatives', 'FAIL', `Preservative additives detected (${found.join(', ')})`);
        } else {
            record('no_preservatives', 'Other Preferences', 'No Preservatives', 'PASS', 'No chemical preservatives detected');
        }
    }

    if (preferences.no_msg) {
        const found = findMatches(combinedText, DICTIONARIES.msg);
        if (found.length > 0) {
            record('no_msg', 'Other Preferences', 'No MSG', 'FAIL', `Monosodium glutamate / E621 detected`);
        } else {
            record('no_msg', 'Other Preferences', 'No MSG', 'PASS', 'No MSG / E621 detected');
        }
    }

    if (preferences.non_gmo) {
        const found = findMatches(combinedText, DICTIONARIES.nonGmoKeywords);
        if (found.length > 0) {
            record('non_gmo', 'Other Preferences', 'Non-GMO Verified', 'PASS', `Non-GMO claim detected ("${found[0]}")`);
        } else {
            record('non_gmo', 'Other Preferences', 'Non-GMO Verified', 'INSUFFICIENT_DATA', 'No explicit Non-GMO claim found on package');
        }
    }

    return results;
};

module.exports = {
    evaluatePreferences,
    DEFAULT_THRESHOLDS
};
