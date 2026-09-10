/**
 * Compares listing details against extracted package details.
 * @param {Object} extractedFields - JSON from extraction service.
 * @param {Object} listingDetails - Data provided by the officer (mrp, quantity, origin).
 * @returns {Object} Mismatch findings block.
 */
const checkMismatch = (extractedFields, listingDetails) => {
    const mismatches = [];

    // Check MRP
    if (listingDetails.mrp && extractedFields.mrp && extractedFields.mrp.value) {
        if (parseFloat(listingDetails.mrp) !== extractedFields.mrp.value) {
            mismatches.push({
                field: 'mrp',
                listedValue: listingDetails.mrp,
                extractedValue: extractedFields.mrp.value,
                description: 'Listed MRP does not match package MRP.'
            });
        }
    }

    // Check Quantity (supports either 'quantity' or 'netQuantity' key)
    const listingQty = listingDetails.quantity || listingDetails.netQuantity;
    if (listingQty && extractedFields.netQuantity && extractedFields.netQuantity.value) {
        const extQtyStr = `${extractedFields.netQuantity.value} ${extractedFields.netQuantity.unit || ''}`.trim();
        // Basic string inclusion/match for MVP
        if (!String(listingQty).toLowerCase().includes(extractedFields.netQuantity.value.toString())) {
            mismatches.push({
                field: 'quantity',
                listedValue: String(listingQty),
                extractedValue: extQtyStr,
                description: 'Listed quantity does not match package quantity.'
            });
        }
    }

    // Check Origin
    if (listingDetails.origin && extractedFields.countryOfOrigin) {
        if (listingDetails.origin.toLowerCase() !== extractedFields.countryOfOrigin.toLowerCase()) {
            mismatches.push({
                field: 'origin',
                listedValue: listingDetails.origin,
                extractedValue: extractedFields.countryOfOrigin,
                description: 'Listed origin does not match package origin.'
            });
        }
    }

    return {
        performed: true,
        mismatches: mismatches
    };
};

module.exports = { checkMismatch };
