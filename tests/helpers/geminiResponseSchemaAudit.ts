const GEMINI_RESPONSE_SCHEMA_KEYWORDS = new Set([
    '$id', '$defs', '$ref', '$anchor',
    'type', 'format', 'title', 'description', 'enum',
    'items', 'prefixItems', 'minItems', 'maxItems', 'minimum', 'maximum',
    'anyOf', 'oneOf', 'properties', 'additionalProperties', 'required', 'propertyOrdering',
]);

/** Audits the exact object supplied through GenerateContentConfig.responseJsonSchema. */
export const auditGeminiResponseSchema = (schema: unknown): readonly string[] => {
    const issues: string[] = [];
    const visitSchema = (value: unknown, path: string): void => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            issues.push(`${path}: schema node must be an object`);
            return;
        }
        const node = value as Record<string, unknown>;
        Object.keys(node).forEach((keyword) => {
            if (!GEMINI_RESPONSE_SCHEMA_KEYWORDS.has(keyword)) issues.push(`${path}: unsupported keyword ${keyword}`);
        });
        if ('$ref' in node) {
            Object.keys(node).filter(key => key !== '$ref' && !key.startsWith('$')).forEach((key) => {
                issues.push(`${path}: $ref has ordinary sibling ${key}`);
            });
        }
        if ('enum' in node) {
            if (!Array.isArray(node.enum)) {
                issues.push(`${path}.enum: must be an array`);
            } else {
                node.enum.forEach((member, index) => {
                    if (typeof member !== 'string' && !(typeof member === 'number' && Number.isFinite(member))) {
                        issues.push(`${path}.enum.${index}: must be a string or finite number`);
                    }
                });
            }
        }
        (['properties', '$defs'] as const).forEach((mapKey) => {
            const map = node[mapKey];
            if (map === undefined) return;
            if (typeof map !== 'object' || map === null || Array.isArray(map)) {
                issues.push(`${path}.${mapKey}: must be an object map`);
                return;
            }
            Object.entries(map as Record<string, unknown>).forEach(([dataKey, child]) => {
                visitSchema(child, `${path}.${mapKey}.${dataKey}`);
            });
        });
        (['anyOf', 'oneOf', 'prefixItems'] as const).forEach((listKey) => {
            const list = node[listKey];
            if (list === undefined) return;
            if (!Array.isArray(list)) {
                issues.push(`${path}.${listKey}: must be an array`);
                return;
            }
            list.forEach((child, index) => visitSchema(child, `${path}.${listKey}.${index}`));
        });
        if (node.items !== undefined) visitSchema(node.items, `${path}.items`);
        if (typeof node.additionalProperties === 'object' && node.additionalProperties !== null) {
            visitSchema(node.additionalProperties, `${path}.additionalProperties`);
        }
    };
    visitSchema(schema, 'responseJsonSchema');
    return issues;
};
