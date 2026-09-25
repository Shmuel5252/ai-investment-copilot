import { beforeEach, describe, expect, it, vi } from "vitest";
import { anthropic } from "@/lib/ai/client";
import { proposeObservedPrinciples, extractDeclaredPrinciples } from "@/lib/ai/strategy";
import { proposeDnaHypotheses } from "@/lib/ai/dna";
import { buildInvestorStatements } from "@/lib/ai/investor-statements";

// Request-shape contract for the three collection generators. Every
// assertion inspects the arguments the REAL production function passes to
// the (mocked) SDK — no schema is redefined here. Zero real API calls.
//
// Why this exists: two live runs got HTTP 200 with the collection field
// returned as a JSON *string*. Strict tool use makes the provider enforce
// the schema during generation, so a string-typed collection cannot be
// produced. This suite pins that the strict flag is actually sent, that
// every object satisfies strict mode's requirements, and that no schema
// path can ever legitimize a string collection.
vi.mock("@/lib/ai/client", () => ({
  anthropic: { messages: { create: vi.fn() } },
  CLAUDE_MODEL: "claude-sonnet-5",
}));

const create = anthropic.messages.create as unknown as ReturnType<typeof vi.fn>;

const ANSWERS = [{ id: "a1", questionText: "q", answerText: "t" }];

type Schema = { [k: string]: unknown };
const isSchema = (v: unknown): v is Schema => typeof v === "object" && v !== null && !Array.isArray(v);

// Keywords the API's strict mode supports and our schemas may use.
// Anything else (minLength, pattern, anyOf, oneOf, $ref, ...) is either
// unsupported (HTTP 400) or a route to a non-array collection, so a new
// keyword must be a conscious decision that updates this list.
const ALLOWED_KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "items", "description", "enum"]);
const SUPPORTED_TYPES = new Set(["object", "array", "string"]);

function strictViolations(schema: unknown, path = "$"): string[] {
  if (!isSchema(schema)) return [`${path}: not a schema object`];
  const violations: string[] = [];
  for (const keyword of Object.keys(schema)) {
    if (!ALLOWED_KEYWORDS.has(keyword)) violations.push(`${path}: keyword "${keyword}" is not allowed`);
  }
  const type = schema.type;
  if (typeof type !== "string" || !SUPPORTED_TYPES.has(type)) {
    violations.push(`${path}: type must be one supported string, got ${JSON.stringify(type)}`);
  }
  if (type === "object") {
    const properties = schema.properties;
    if (!isSchema(properties)) {
      violations.push(`${path}: object without properties`);
    } else {
      if (schema.additionalProperties !== false) violations.push(`${path}: additionalProperties must be false`);
      const required = Array.isArray(schema.required) ? [...(schema.required as string[])].sort() : null;
      if (JSON.stringify(required) !== JSON.stringify(Object.keys(properties).sort())) {
        violations.push(`${path}: required must list every declared property`);
      }
      for (const [name, child] of Object.entries(properties)) violations.push(...strictViolations(child, `${path}.${name}`));
    }
  } else if (type === "array") {
    violations.push(...strictViolations(schema.items, `${path}[]`));
  } else if (type === "string" && "enum" in schema) {
    if (!Array.isArray(schema.enum) || !schema.enum.every((e) => typeof e === "string")) {
      violations.push(`${path}: enum must contain only strings`);
    }
  }
  return violations;
}

// strictViolations is generic; only the caller knows which path is THE
// collection, so that rule (exactly type "array", never a string) lives here.
function contractViolations(root: unknown, collectionKey: string): string[] {
  const violations = strictViolations(root);
  const collection = isSchema(root) && isSchema(root.properties) ? root.properties[collectionKey] : undefined;
  if (!isSchema(collection) || collection.type !== "array") {
    violations.push(`$.${collectionKey}: the collection must be exactly type "array"`);
  }
  return violations;
}

const prop = (schema: unknown, name: string): Schema => {
  const value = isSchema(schema) && isSchema(schema.properties) ? schema.properties[name] : undefined;
  if (!isSchema(value)) throw new Error(`schema has no object property "${name}"`);
  return value;
};

interface SentRequest {
  tools: Schema[];
  tool_choice: Schema;
}

interface Case {
  name: string;
  key: "principles" | "hypotheses";
  toolName: string;
  call: () => Promise<unknown>;
  itemRequired: string[];
  nestedField: string;
  nestedItemType: "object" | "string";
}

const CASES: Case[] = [
  {
    name: "Strategy observed — proposeObservedPrinciples",
    key: "principles",
    toolName: "propose_observed_principles",
    call: () => proposeObservedPrinciples(buildInvestorStatements(ANSWERS, [])),
    itemRequired: ["statement", "evidence"],
    nestedField: "evidence",
    nestedItemType: "object",
  },
  {
    name: "Strategy declared — extractDeclaredPrinciples",
    key: "principles",
    toolName: "propose_declared_principles",
    call: () => extractDeclaredPrinciples(ANSWERS),
    itemRequired: ["statementText", "rationaleText", "citedAnswerIds"],
    nestedField: "citedAnswerIds",
    nestedItemType: "string",
  },
  {
    name: "DNA — proposeDnaHypotheses",
    key: "hypotheses",
    toolName: "propose_hypotheses",
    call: () => proposeDnaHypotheses(buildInvestorStatements(ANSWERS, [])),
    itemRequired: ["statement", "evidence"],
    nestedField: "evidence",
    nestedItemType: "object",
  },
];

describe.each(CASES)("strict tool contract — $name", (c) => {
  let request: SentRequest;
  let tool: Schema;
  let root: Schema;

  beforeEach(async () => {
    create.mockReset();
    create.mockResolvedValueOnce({ content: [{ type: "tool_use", input: { [c.key]: [] } }] });
    await c.call();
    expect(create).toHaveBeenCalledTimes(1);
    request = create.mock.calls[0]![0] as SentRequest;
    tool = request.tools[0]!;
    root = tool.input_schema as Schema;
  });

  it("1. strict mode is actually sent on the one tool in the request", () => {
    expect(request.tools).toHaveLength(1);
    expect(tool.strict).toBe(true);
  });

  it("2/5. the root schema is an object that forbids extra properties", () => {
    expect(root.type).toBe("object");
    expect(root.additionalProperties).toBe(false);
  });

  it("3/4. the collection is array-only, is the sole root property, and is required", () => {
    const collection = prop(root, c.key);
    expect(collection.type).toBe("array");
    expect(Array.isArray(collection.type)).toBe(false);
    expect(Object.keys(root.properties as Schema)).toEqual([c.key]);
    expect(root.required).toEqual([c.key]);
  });

  it("6/8. the item schema is object-shaped, strict, and requires exactly the fields the domain validator reads", () => {
    const item = (prop(root, c.key).items ?? null) as Schema;
    expect(item.type).toBe("object");
    expect(item.additionalProperties).toBe(false);
    expect([...(item.required as string[])].sort()).toEqual([...c.itemRequired].sort());
    expect(Object.keys(item.properties as Schema).sort()).toEqual([...c.itemRequired].sort());
  });

  it("7/8. the nested evidence/citation collection is an actual array with a strict element schema", () => {
    const item = prop(root, c.key).items as Schema;
    const nested = prop(item, c.nestedField);
    expect(nested.type).toBe("array");
    const element = nested.items as Schema;
    expect(element.type).toBe(c.nestedItemType);

    if (c.nestedItemType === "object") {
      expect(element.additionalProperties).toBe(false);
      expect([...(element.required as string[])].sort()).toEqual(["description", "stance", "statementId"]);
      expect(prop(element, "stance").enum).toEqual(["supporting", "contradicting"]);
    }
  });

  it("9. tool_choice still forces exactly this tool", () => {
    expect(request.tool_choice).toEqual({ type: "tool", name: c.toolName });
    expect(tool.name).toBe(c.toolName);
  });

  it("10. no schema path can produce a string collection, and every node satisfies strict-mode requirements", () => {
    // Whitelisted keywords only (so no anyOf/oneOf/$ref/type-arrays), every
    // object strict with all properties required, no unsupported
    // constraints, and the collection is exactly type "array".
    expect(contractViolations(root, c.key)).toEqual([]);
    // Acyclic (strict mode rejects recursive schemas) and plain JSON.
    expect(() => JSON.stringify(root)).not.toThrow();
  });
});

describe("the conformance checker itself has teeth", () => {
  const conforming = {
    type: "object",
    properties: {
      things: {
        type: "array",
        items: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false },
      },
    },
    required: ["things"],
    additionalProperties: false,
  };

  it("accepts a conforming schema", () => {
    expect(contractViolations(conforming, "things")).toEqual([]);
  });

  const clone = () => JSON.parse(JSON.stringify(conforming)) as Schema;
  const mutate = (fn: (s: Schema) => void) => {
    const s = clone();
    fn(s);
    return s;
  };
  const things = (s: Schema) => prop(s, "things");
  const thingItem = (s: Schema) => things(s).items as Schema;

  it.each([
    ["root missing additionalProperties:false", mutate((s) => delete s.additionalProperties)],
    ["nested item missing additionalProperties:false", mutate((s) => delete thingItem(s).additionalProperties)],
    ["a collection that also allows a string (type array)", mutate((s) => (things(s).type = ["array", "string"]))],
    ["a collection that is a string", mutate((s) => (things(s).type = "string"))],
    ["an anyOf alternative", mutate((s) => (things(s).anyOf = [{ type: "string" }]))],
    ["an unsupported constraint keyword", mutate((s) => (prop(thingItem(s), "a").minLength = 1))],
    ["a declared property not listed in required", mutate((s) => (thingItem(s).required = []))],
    ["an array without items", mutate((s) => delete things(s).items)],
  ])("flags: %s", (_name, schema) => {
    expect(contractViolations(schema, "things").length).toBeGreaterThan(0);
  });
});
