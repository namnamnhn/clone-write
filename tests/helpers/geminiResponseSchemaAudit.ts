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

export interface GeminiResponseSchemaComplexity {
    readonly schemaNodeCount: number;
    readonly maxDepth: number;
    readonly definitionCount: number;
    readonly serializedBytes: number;
    readonly hasObjectCycle: boolean;
    readonly hasReferenceCycle: boolean;
}

const schemaChildren = (node: Record<string, unknown>): readonly unknown[] => {
    const children: unknown[] = [];
    for (const mapKey of ['properties', '$defs'] as const) {
        const map = node[mapKey];
        if (typeof map === 'object' && map !== null && !Array.isArray(map)) {
            children.push(...Object.values(map as Record<string, unknown>));
        }
    }
    for (const listKey of ['anyOf', 'oneOf', 'prefixItems'] as const) {
        if (Array.isArray(node[listKey])) children.push(...node[listKey]);
    }
    if (node.items !== undefined) children.push(node.items);
    if (typeof node.additionalProperties === 'object' && node.additionalProperties !== null) {
        children.push(node.additionalProperties);
    }
    return children;
};

const containsReferenceCycle = (schema: Record<string, unknown>): boolean => {
    const definitions = schema.$defs;
    if (typeof definitions !== 'object' || definitions === null || Array.isArray(definitions)) return false;
    const definitionMap = definitions as Record<string, unknown>;
    const references = new Map<string, Set<string>>();
    Object.entries(definitionMap).forEach(([name, definition]) => {
        const found = new Set<string>();
        const collect = (value: unknown): void => {
            if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
            const node = value as Record<string, unknown>;
            if (typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/')) {
                found.add(node.$ref.slice('#/$defs/'.length));
            }
            schemaChildren(node).forEach(collect);
        };
        collect(definition);
        references.set(name, found);
    });
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (name: string): boolean => {
        if (visiting.has(name)) return true;
        if (visited.has(name)) return false;
        visiting.add(name);
        for (const target of references.get(name) ?? []) {
            if (definitionMap[target] !== undefined && visit(target)) return true;
        }
        visiting.delete(name);
        visited.add(name);
        return false;
    };
    return Object.keys(definitionMap).some(visit);
};

/** Internal maintenance metric only; it does not represent a documented Google hard limit. */
export const measureGeminiResponseSchemaComplexity = (schema: unknown): GeminiResponseSchemaComplexity => {
    let schemaNodeCount = 0;
    let maxDepth = 0;
    let hasObjectCycle = false;
    const ancestors = new Set<object>();
    const visit = (value: unknown, depth: number): void => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
        if (ancestors.has(value)) {
            hasObjectCycle = true;
            return;
        }
        schemaNodeCount += 1;
        maxDepth = Math.max(maxDepth, depth);
        ancestors.add(value);
        schemaChildren(value as Record<string, unknown>).forEach(child => visit(child, depth + 1));
        ancestors.delete(value);
    };
    visit(schema, 1);
    const record = typeof schema === 'object' && schema !== null && !Array.isArray(schema)
        ? schema as Record<string, unknown> : {};
    const definitions = record.$defs;
    const definitionCount = typeof definitions === 'object' && definitions !== null && !Array.isArray(definitions)
        ? Object.keys(definitions).length : 0;
    return {
        schemaNodeCount,
        maxDepth,
        definitionCount,
        serializedBytes: hasObjectCycle ? Number.POSITIVE_INFINITY : new TextEncoder().encode(JSON.stringify(schema)).byteLength,
        hasObjectCycle,
        hasReferenceCycle: containsReferenceCycle(record),
    };
};
