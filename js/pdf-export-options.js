/**
 * Canonical PDF export options for the field loading work sheet.
 *
 * This module is the only owner of PDF option defaults and normalization.
 * It intentionally has no DOM or window dependencies so the same immutable
 * configuration can be used by the UI, estimators and PDF renderer.
 */

export const PDF_EXPORT_SCHEMA_VERSION = '1.0';

export const PDF_TEMPLATE = Object.freeze({
    FIELD_LARGE: 'field-large',
    STANDARD: 'standard',
    ARCHIVE: 'archive'
});

export const PDF_ORIENTATION = 'landscape';

const TEMPLATE_DEFAULTS = Object.freeze({
    [PDF_TEMPLATE.FIELD_LARGE]: Object.freeze({
        includeCoordinateList: false,
        includeHighDensityZoom: true,
        exportJson: false
    }),
    [PDF_TEMPLATE.STANDARD]: Object.freeze({
        includeCoordinateList: true,
        includeHighDensityZoom: true,
        exportJson: false
    }),
    [PDF_TEMPLATE.ARCHIVE]: Object.freeze({
        includeCoordinateList: true,
        includeHighDensityZoom: true,
        exportJson: false
    })
});

export const PDF_EXPORT_DEFAULTS = Object.freeze({
    schemaVersion: PDF_EXPORT_SCHEMA_VERSION,
    template: PDF_TEMPLATE.STANDARD,
    orientation: PDF_ORIENTATION,
    ...TEMPLATE_DEFAULTS[PDF_TEMPLATE.STANDARD],
    selectedFurnaceIds: Object.freeze([])
});

function normalizeTemplate(value) {
    return Object.values(PDF_TEMPLATE).includes(value)
        ? value
        : PDF_TEMPLATE.STANDARD;
}

function normalizeBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

function normalizeSelectedFurnaceIds(value) {
    if (!Array.isArray(value)) return [];

    const unique = new Set();
    value.forEach(rawId => {
        let id = null;

        if (typeof rawId === 'number' && Number.isInteger(rawId) && rawId >= 0) {
            id = rawId;
        } else if (typeof rawId === 'string' && /^\d+$/.test(rawId)) {
            const parsed = Number(rawId);
            if (Number.isSafeInteger(parsed)) id = parsed;
        }

        if (id !== null) unique.add(id);
    });
    return [...unique];
}

/**
 * Normalize any unknown input into a complete canonical PdfExportOptions.
 *
 * The function is pure: it does not mutate or retain references from input.
 * Unknown fields are discarded and invalid values use explicit defaults.
 */
export function normalizePdfExportOptions(input = {}) {
    const source = input && typeof input === 'object' && !Array.isArray(input)
        ? input
        : {};
    const template = normalizeTemplate(source.template);
    const defaults = TEMPLATE_DEFAULTS[template];

    return {
        schemaVersion: PDF_EXPORT_SCHEMA_VERSION,
        template,
        orientation: PDF_ORIENTATION,
        includeCoordinateList: normalizeBoolean(
            source.includeCoordinateList,
            defaults.includeCoordinateList
        ),
        includeHighDensityZoom: normalizeBoolean(
            source.includeHighDensityZoom,
            defaults.includeHighDensityZoom
        ),
        exportJson: normalizeBoolean(source.exportJson, defaults.exportJson),
        selectedFurnaceIds: normalizeSelectedFurnaceIds(source.selectedFurnaceIds)
    };
}

/**
 * Resolve a template's defaults while allowing explicit canonical overrides.
 */
export function applyPdfTemplateDefaults(template, overrides = {}) {
    const normalizedTemplate = normalizeTemplate(template);
    const source = overrides && typeof overrides === 'object' && !Array.isArray(overrides)
        ? overrides
        : {};

    return normalizePdfExportOptions({
        ...source,
        template: normalizedTemplate
    });
}

export function getPdfTemplateDefaults(template) {
    return applyPdfTemplateDefaults(template);
}
